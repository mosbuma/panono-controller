"use client";

import * as THREE from "three";
import JSZip from "jszip";
import type { ManifestCamera, UpfManifest } from "@/lib/manifest";
import { mergeChannelJpegs, readHorizonUp } from "@/lib/upf-client";
import { fetchUpfArrayBuffer } from "@/lib/fetch-upf-client";

const RADIUS = 500;

export interface ViewerOptions {
  /** Preview ~1 MB (512×384); full ~30 MB (2064×1552, merged RGB). */
  resolution?: "preview" | "full";
  /** Level horizon using LIS3DSH accelerometer data (experimental; off by default). */
  autoLevel?: boolean;
  /** Skip download when the preview UPF is already in IndexedDB. */
  preloaded?: ArrayBuffer;
}

export interface ViewerHandle {
  close: () => void;
}

/**
 * Opens a fullscreen 360 viewer for a Panono preview/UPF (a zip of per-camera
 * JPEGs + manifest.json). Each camera image is projected onto a sphere using
 * its intrinsic + rotation matrices; the rig has zero translation, so this is
 * a clean pure-rotation reprojection (no parallax).
 */
export async function openUpfViewer(
  upfUrl: string,
  label?: string,
  options: ViewerOptions = {}
): Promise<ViewerHandle> {
  const resolution = options.resolution ?? "preview";
  const autoLevel = options.autoLevel ?? false;
  const segU = resolution === "full" ? 24 : 16;
  const segV = resolution === "full" ? 18 : 12;
  const feather = resolution === "full" ? 0.1 : 0.12;

  const overlay = buildOverlay(label, resolution === "full" ? "full-res mesh" : "preview mesh");
  const { root, canvasWrap, status, levelToggle, close } = overlay;
  document.body.append(root);

  let scene: THREE.Scene | null = null;
  let levelQuat: THREE.Quaternion | null = null;

  try {
    let buf: ArrayBuffer;
    if (options.preloaded) {
      status.textContent = "Unpacking…";
      buf = options.preloaded;
    } else {
      status.textContent =
        resolution === "full" ? "Downloading full UPF…" : "Downloading…";
      buf = await fetchUpfArrayBuffer(upfUrl, (pct) => {
        status.textContent =
          pct != null
            ? `Downloading… ${pct}%`
            : resolution === "full"
              ? "Downloading full UPF…"
              : "Downloading…";
      });
    }

    status.textContent = "Unpacking…";
    const zip = await JSZip.loadAsync(buf);
    const manifestFile = zip.file("manifest.json");
    if (!manifestFile) throw new Error("manifest.json not found in UPF");
    const manifest = JSON.parse(await manifestFile.async("string")) as UpfManifest;

    const setId = manifest.defaultSetId ?? 0;
    const cameras =
      manifest.imageSets?.[setId]?.cameras ?? manifest.imageSets?.[0]?.cameras ?? [];
    if (!cameras.length) throw new Error("No cameras in manifest");

    if (autoLevel) {
      const up = await readHorizonUp(zip);
      if (up) {
        levelQuat = quaternionAlignToY(up[0], up[1], up[2]);
      }
    }

    status.textContent = `Loading ${cameras.length} images…`;
    scene = new THREE.Scene();
    if (levelQuat && levelToggle.checked) {
      scene.quaternion.copy(levelQuat);
    }

    let loaded = 0;
    await Promise.all(
      cameras.map(async (cam) => {
        const texture = await loadCameraTexture(zip, cam);
        if (!texture) return;
        const mesh = buildCameraMesh(cam, texture, segU, segV, feather);
        if (mesh) scene!.add(mesh);
        loaded++;
        status.textContent = `Loading ${loaded}/${cameras.length} images…`;
      })
    );

    status.textContent = "";
    const applyLevel = () => {
      if (!scene || !levelQuat) return;
      if (levelToggle.checked) scene.quaternion.copy(levelQuat);
      else scene.quaternion.identity();
    };
    levelToggle.onchange = applyLevel;
    if (!levelQuat) {
      levelToggle.disabled = true;
      levelToggle.checked = false;
    }

    startRenderer(canvasWrap, scene);
  } catch (err) {
    status.textContent = `Failed: ${err instanceof Error ? err.message : err}`;
    status.classList.add("viewer-error");
  }

  return { close };
}

async function loadCameraTexture(
  zip: JSZip,
  cam: ManifestCamera
): Promise<THREE.Texture | null> {
  const files = cam.imageFilenames ?? [];
  if (!files.length) return null;

  if (files.length === 1) {
    const file = zip.file(files[0]);
    if (!file) return null;
    const blob = await file.async("blob");
    return loadTexture(URL.createObjectURL(blob));
  }

  const merged = await mergeChannelJpegs(zip, files);
  if (!merged) return null;
  return loadTexture(URL.createObjectURL(merged));
}

/** Rotate sensor-frame up vector to Three.js Y-up. */
function quaternionAlignToY(ux: number, uy: number, uz: number): THREE.Quaternion {
  const from = new THREE.Vector3(ux, uy, uz).normalize();
  const to = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  const dot = from.dot(to);
  if (dot > 0.9999) return q.identity();
  if (dot < -0.9999) return q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
  q.setFromUnitVectors(from, to);
  return q;
}

function loadTexture(objectUrl: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      objectUrl,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        resolve(tex);
      },
      undefined,
      () => reject(new Error("texture load failed"))
    );
  });
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Build a curved mesh patch for one camera. For each image pixel (u,v) the
 * world ray direction is R^T * K^-1 * [u,v,1] (rig translation is zero), placed
 * at sphere radius and textured with the camera image.
 */
function buildCameraMesh(
  cam: ManifestCamera,
  texture: THREE.Texture,
  segU: number,
  segV: number,
  feather: number
): THREE.Mesh | null {
  const K = cam.intrinsicMatrix;
  const R = cam.rotationMatrix;
  if (!K || !R) return null;
  const fx = K[0][0];
  const fy = K[1][1];
  const cx = K[0][2];
  const cy = K[1][2];
  const W = cam.imageWidth;
  const H = cam.imageHeight;

  const cols = segU + 1;
  const rows = segV + 1;
  const positions = new Float32Array(cols * rows * 3);
  const uvs = new Float32Array(cols * rows * 2);
  const colors = new Float32Array(cols * rows * 4);

  let p = 0;
  let t = 0;
  let c = 0;
  let cxSum = 0;
  let cySum = 0;
  let czSum = 0;

  for (let iy = 0; iy < rows; iy++) {
    const v = (iy / segV) * H;
    for (let ix = 0; ix < cols; ix++) {
      const u = (ix / segU) * W;

      const rc0 = (u - cx) / fx;
      const rc1 = (v - cy) / fy;
      const rc2 = 1;
      const wx = R[0][0] * rc0 + R[1][0] * rc1 + R[2][0] * rc2;
      const wy = R[0][1] * rc0 + R[1][1] * rc1 + R[2][1] * rc2;
      const wz = R[0][2] * rc0 + R[1][2] * rc1 + R[2][2] * rc2;
      const len = Math.hypot(wx, wy, wz) || 1;
      const nx = wx / len;
      const ny = wy / len;
      const nz = wz / len;

      positions[p++] = nx * RADIUS;
      positions[p++] = ny * RADIUS;
      positions[p++] = nz * RADIUS;
      cxSum += nx;
      cySum += ny;
      czSum += nz;

      uvs[t++] = u / W;
      uvs[t++] = 1 - v / H;

      // Radial falloff from principal point + border feather for softer seams.
      const du = (u - cx) / W;
      const dv = (v - cy) / H;
      const radial = Math.hypot(du, dv);
      const radialAlpha = 1 - smoothstep(0.38, 0.52, radial);
      const borderU = smoothstep(0, feather, Math.min(u / W, 1 - u / W));
      const borderV = smoothstep(0, feather, Math.min(v / H, 1 - v / H));
      const alpha = radialAlpha * borderU * borderV;
      colors[c++] = 1;
      colors[c++] = 1;
      colors[c++] = 1;
      colors[c++] = alpha;
    }
  }

  const indices: number[] = [];
  for (let iy = 0; iy < segV; iy++) {
    for (let ix = 0; ix < segU; ix++) {
      const a = iy * cols + ix;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      indices.push(a, d, b, b, d, e);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geom.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geom.setAttribute("color", new THREE.BufferAttribute(colors, 4));
  geom.setIndex(indices);

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.DoubleSide,
    transparent: true,
    vertexColors: true,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geom, material);
  const n = cols * rows;
  mesh.userData.viewDir = new THREE.Vector3(cxSum / n, cySum / n, czSum / n);
  return mesh;
}

function startRenderer(container: HTMLElement, scene: THREE.Scene): () => void {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.append(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 2000);
  camera.position.set(0, 0, 0);

  let lon = 0;
  let lat = 0;
  let dragging = false;
  let px = 0;
  let py = 0;

  const onResize = () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h || 1;
    camera.updateProjectionMatrix();
  };
  onResize();
  const ro = new ResizeObserver(onResize);
  ro.observe(container);

  const el = renderer.domElement;
  el.style.cursor = "grab";
  const down = (e: PointerEvent) => {
    dragging = true;
    px = e.clientX;
    py = e.clientY;
    el.style.cursor = "grabbing";
    el.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    if (!dragging) return;
    lon -= (e.clientX - px) * 0.12;
    lat += (e.clientY - py) * 0.12;
    lat = Math.max(-85, Math.min(85, lat));
    px = e.clientX;
    py = e.clientY;
  };
  const up = (e: PointerEvent) => {
    dragging = false;
    el.style.cursor = "grab";
    try {
      el.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    camera.fov = Math.max(25, Math.min(95, camera.fov + e.deltaY * 0.05));
    camera.updateProjectionMatrix();
  };
  el.addEventListener("pointerdown", down);
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("wheel", wheel, { passive: false });

  const viewDir = new THREE.Vector3();
  let raf = 0;
  const target = new THREE.Vector3();
  const animate = () => {
    raf = requestAnimationFrame(animate);
    const phi = THREE.MathUtils.degToRad(90 - lat);
    const theta = THREE.MathUtils.degToRad(lon);
    viewDir.set(
      Math.sin(phi) * Math.cos(theta),
      Math.cos(phi),
      Math.sin(phi) * Math.sin(theta)
    );
    target.copy(viewDir);
    camera.lookAt(target);

    // Painter's order: draw patches facing away from the viewer first.
    scene.children.sort((a, b) => {
      const da = (a as THREE.Mesh).userData.viewDir as THREE.Vector3 | undefined;
      const db = (b as THREE.Mesh).userData.viewDir as THREE.Vector3 | undefined;
      if (!da || !db) return 0;
      return da.dot(viewDir) - db.dot(viewDir);
    });

    renderer.render(scene, camera);
  };
  animate();

  const dispose = () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    el.removeEventListener("pointerdown", down);
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("wheel", wheel);
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
    renderer.dispose();
    el.remove();
  };
  (container as HTMLElement & { __dispose?: () => void }).__dispose = dispose;
  return dispose;
}

function buildOverlay(label: string | undefined, tag: string) {
  const root = document.createElement("div");
  root.className = "viewer-overlay";

  const canvasWrap = document.createElement("div");
  canvasWrap.className = "viewer-canvas";

  const bar = document.createElement("div");
  bar.className = "viewer-bar";

  const title = document.createElement("div");
  title.className = "viewer-title";
  title.textContent = label ? `360° · ${label} (${tag})` : `360° viewer (${tag})`;

  const status = document.createElement("div");
  status.className = "viewer-status";

  const levelLabel = document.createElement("label");
  levelLabel.className = "viewer-level";
  const levelToggle = document.createElement("input");
  levelToggle.type = "checkbox";
  levelToggle.checked = false;
  levelLabel.append(levelToggle, " Level horizon (experimental)");

  const hint = document.createElement("div");
  hint.className = "viewer-hint";
  hint.textContent = "drag to look · scroll to zoom";

  const closeBtn = document.createElement("button");
  closeBtn.className = "viewer-close";
  closeBtn.textContent = "✕";

  bar.append(title, status, levelLabel, hint, closeBtn);
  root.append(canvasWrap, bar);

  const close = () => {
    const d = (canvasWrap as HTMLElement & { __dispose?: () => void }).__dispose;
    if (d) d();
    root.remove();
    window.removeEventListener("keydown", onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };
  window.addEventListener("keydown", onKey);
  closeBtn.onclick = close;

  return { root, canvasWrap, status, levelToggle, close };
}
