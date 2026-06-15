/**
 * Flat equirectangular thumbnail via calibrated multi-camera projection
 * (same math as lib/stitcher/stitch.ts at 360×180, without multiband blending).
 */
import JSZip from "jszip";
import type { ManifestCamera, UpfManifest } from "@/lib/manifest";
import { mergeChannelJpegs } from "@/lib/upf-client";
import {
  getFlatPreviewBlob,
  putFlatPreview,
  putPreviewUpf,
} from "@/lib/flat-preview-cache";
import { fetchUpfArrayBuffer } from "@/lib/fetch-upf-client";
import { computeExposureGains } from "@/lib/stitcher/exposure";
import {
  dirFromLonLat,
  projectSample,
  type CameraImage,
  type StitchContext,
} from "@/lib/stitcher/projection";
import { parseVignettingCoeffs } from "@/lib/stitcher/vignetting";

const THUMB_W = 360;
const THUMB_H = 180;

/** Softer seams for low-res gallery thumbs (server stitch uses defaults). */
const THUMB_BLEND = {
  borderFeather: 0.2,
  radialInner: 0.32,
  radialOuter: 0.58,
} as const;

async function loadCameraBlob(zip: JSZip, cam: ManifestCamera): Promise<Blob | null> {
  const files = cam.imageFilenames ?? [];
  if (!files.length) return null;
  if (files.length === 1) {
    const file = zip.file(files[0]);
    return file ? file.async("blob") : null;
  }
  return mergeChannelJpegs(zip, files);
}

async function bitmapToRgb(bmp: ImageBitmap): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unsupported");
  ctx.drawImage(bmp, 0, 0);
  const data = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
  const rgb = new Uint8Array(bmp.width * bmp.height * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    rgb[j] = data[i]!;
    rgb[j + 1] = data[i + 1]!;
    rgb[j + 2] = data[i + 2]!;
  }
  return rgb;
}

async function loadCameraImage(zip: JSZip, cam: ManifestCamera): Promise<CameraImage | null> {
  const blob = await loadCameraBlob(zip, cam);
  if (!blob) return null;
  const bmp = await createImageBitmap(blob);
  const width = cam.imageWidth || bmp.width;
  const height = cam.imageHeight || bmp.height;
  const rgb = await bitmapToRgb(bmp);
  bmp.close();
  return { cam, rgb, width, height };
}

function stitchFlatThumb(
  images: CameraImage[],
  ctx: StitchContext,
  width: number,
  height: number
): Uint8ClampedArray {
  const size = width * height;
  const accR = new Float64Array(size);
  const accG = new Float64Array(size);
  const accB = new Float64Array(size);
  const accW = new Float64Array(size);

  for (let py = 0; py < height; py++) {
    const latDeg = 90 - (py / height) * 180;
    for (let px = 0; px < width; px++) {
      const lonDeg = (px / width) * 360 - 180;
      const [dx, dy, dz] = dirFromLonLat(lonDeg, latDeg);
      const o = py * width + px;

      for (let ci = 0; ci < images.length; ci++) {
        const hit = projectSample(images[ci]!, ci, ctx, dx, dy, dz);
        if (!hit) continue;
        accR[o] += hit.r * hit.weight;
        accG[o] += hit.g * hit.weight;
        accB[o] += hit.b * hit.weight;
        accW[o] += hit.weight;
      }
    }
  }

  const out = new Uint8ClampedArray(size * 4);
  for (let i = 0; i < size; i++) {
    const w = accW[i]!;
    const o = i * 4;
    if (w > 1e-6) {
      out[o] = clampByte(accR[i]! / w);
      out[o + 1] = clampByte(accG[i]! / w);
      out[o + 2] = clampByte(accB[i]! / w);
      out[o + 3] = 255;
    } else {
      out[o] = 12;
      out[o + 1] = 14;
      out[o + 2] = 20;
      out[o + 3] = 255;
    }
  }
  return out;
}

function clampByte(v: number): number {
  return Math.min(255, Math.max(0, Math.round(v)));
}

export async function buildFlatPreviewBlob(
  imageId: string,
  previewUpfUrl: string
): Promise<Blob> {
  const upfBuf = await fetchUpfArrayBuffer(previewUpfUrl);
  void putPreviewUpf(
    imageId,
    previewUpfUrl,
    new Blob([upfBuf], { type: "application/zip" })
  );
  const zip = await JSZip.loadAsync(upfBuf);
  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) throw new Error("manifest.json missing");

  const manifest = JSON.parse(await manifestFile.async("string")) as UpfManifest;
  const setId = manifest.defaultSetId ?? 0;
  const cameras = (
    manifest.imageSets?.[setId]?.cameras ?? manifest.imageSets?.[0]?.cameras ?? []
  )
    .slice()
    .sort((a, b) => a.id - b.id);

  const loaded = (
    await Promise.all(cameras.map((cam) => loadCameraImage(zip, cam)))
  ).filter((img): img is CameraImage => img != null);

  if (!loaded.length) throw new Error("No camera images loaded");

  const vignettingFile = zip.file("vignetting_coeffs.txt");
  const vignetting = vignettingFile
    ? parseVignettingCoeffs(await vignettingFile.async("string"))
    : null;

  const ctx: StitchContext = {
    vignetting,
    exposure: computeExposureGains(loaded),
    blend: THUMB_BLEND,
  };

  const canvas = document.createElement("canvas");
  canvas.width = THUMB_W;
  canvas.height = THUMB_H;
  const canvasCtx = canvas.getContext("2d");
  if (!canvasCtx) throw new Error("Canvas unsupported");

  const pixels = stitchFlatThumb(loaded, ctx, THUMB_W, THUMB_H);
  const imageData = canvasCtx.createImageData(THUMB_W, THUMB_H);
  imageData.data.set(pixels);
  canvasCtx.putImageData(imageData, 0, 0);

  const jpeg = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Canvas toBlob failed"))),
      "image/jpeg",
      0.82
    );
  });
  return jpeg;
}

export async function loadCachedFlatPreviewUrl(
  imageId: string,
  previewUrl: string
): Promise<string | null> {
  const blob = await getFlatPreviewBlob(imageId, previewUrl);
  return blob ? URL.createObjectURL(blob) : null;
}

type PreviewJob = { imageId: string; previewUrl: string };

let queue: PreviewJob[] = [];
let running = false;
let cancelled = false;

export function stopFlatPreviewGeneration(): void {
  cancelled = true;
  queue = [];
}

export function enqueueFlatPreviews(jobs: PreviewJob[]): void {
  cancelled = false;
  queue = jobs.filter((j) => j.previewUrl);
  if (!running && queue.length) void drainPreviewQueue();
}

const readyListeners = new Set<(imageId: string, objectUrl: string) => void>();
const startListeners = new Set<(imageId: string) => void>();

export function onFlatPreviewReady(
  cb: (imageId: string, objectUrl: string) => void
): () => void {
  readyListeners.add(cb);
  return () => readyListeners.delete(cb);
}

export function onFlatPreviewStart(cb: (imageId: string) => void): () => void {
  startListeners.add(cb);
  return () => startListeners.delete(cb);
}

function emitReady(imageId: string, objectUrl: string): void {
  for (const cb of readyListeners) cb(imageId, objectUrl);
}

function emitStart(imageId: string): void {
  for (const cb of startListeners) cb(imageId);
}

async function drainPreviewQueue(): Promise<void> {
  running = true;
  while (queue.length && !cancelled) {
    const job = queue.shift()!;
    emitStart(job.imageId);
    try {
      const jpeg = await buildFlatPreviewBlob(job.imageId, job.previewUrl);
      await putFlatPreview(job.imageId, job.previewUrl, jpeg);
      emitReady(job.imageId, URL.createObjectURL(jpeg));
    } catch {
      /* leave placeholder on failure */
    }
    await new Promise((r) => setTimeout(r, 0));
  }
  running = false;
}
