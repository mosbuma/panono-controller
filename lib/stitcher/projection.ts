import type { ManifestCamera } from "@/lib/manifest";
import type { ExposureGains } from "@/lib/stitcher/exposure";
import type { VignettingCoeffs } from "@/lib/stitcher/vignetting";
import { vignettingGain } from "@/lib/stitcher/vignetting";

export interface CameraImage {
  cam: ManifestCamera;
  rgb: Uint8Array;
  width: number;
  height: number;
}

export interface StitchBlendOptions {
  /** Edge fade in normalized image coords (default 0.12). */
  borderFeather?: number;
  /** Radial falloff inner edge (default 0.38). */
  radialInner?: number;
  /** Radial falloff outer edge (default 0.52). */
  radialOuter?: number;
}

export interface StitchContext {
  vignetting: VignettingCoeffs | null;
  exposure: ExposureGains[];
  blend?: StitchBlendOptions;
}

export function dirFromLonLat(lonDeg: number, latDeg: number): [number, number, number] {
  const phi = ((90 - latDeg) * Math.PI) / 180;
  const theta = (lonDeg * Math.PI) / 180;
  return [
    Math.sin(phi) * Math.cos(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.sin(theta),
  ];
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function projectSample(
  c: CameraImage,
  camIndex: number,
  ctx: StitchContext,
  dx: number,
  dy: number,
  dz: number
): { r: number; g: number; b: number; weight: number } | null {
  const R = c.cam.rotationMatrix;
  const cx = R[0]![0]! * dx + R[0]![1]! * dy + R[0]![2]! * dz;
  const cy = R[1]![0]! * dx + R[1]![1]! * dy + R[1]![2]! * dz;
  const cz = R[2]![0]! * dx + R[2]![1]! * dy + R[2]![2]! * dz;
  if (cz <= 0.05) return null;

  const K = c.cam.intrinsicMatrix;
  const fx = K[0]![0]!;
  const fy = K[1]![1]!;
  const px = K[0]![2]!;
  const py = K[1]![2]!;
  const u = (fx * cx) / cz + px;
  const v = (fy * cy) / cz + py;
  const W = c.width;
  const H = c.height;
  if (u < 0 || v < 0 || u >= W - 1 || v >= H - 1) return null;

  const du = (u - px) / W;
  const dv = (v - py) / H;
  const radial = Math.hypot(du, dv);
  const radialInner = ctx.blend?.radialInner ?? 0.38;
  const radialOuter = ctx.blend?.radialOuter ?? 0.52;
  const borderFeather = ctx.blend?.borderFeather ?? 0.12;
  const radialW = 1 - smoothstep(radialInner, radialOuter, radial);
  const borderW =
    smoothstep(0, borderFeather, Math.min(u / W, 1 - u / W)) *
    smoothstep(0, borderFeather, Math.min(v / H, 1 - v / H));
  const weight = cz * radialW * borderW;
  if (weight < 1e-4) return null;

  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const tx = u - x0;
  const ty = v - y0;
  const rgb = c.rgb;
  const sample = (x: number, y: number) => {
    const o = (y * W + x) * 3;
    return [rgb[o]!, rgb[o + 1]!, rgb[o + 2]!] as [number, number, number];
  };
  const c00 = sample(x0, y0);
  const c10 = sample(x0 + 1, y0);
  const c01 = sample(x0, y0 + 1);
  const c11 = sample(x0 + 1, y0 + 1);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  let r = lerp(lerp(c00[0], c10[0], tx), lerp(c01[0], c11[0], tx), ty);
  let g = lerp(lerp(c00[1], c10[1], tx), lerp(c01[1], c11[1], tx), ty);
  let b = lerp(lerp(c00[2], c10[2], tx), lerp(c01[2], c11[2], tx), ty);

  if (ctx.vignetting) {
    const [vgR, vgG, vgB] = vignettingGain(ctx.vignetting, u, v, px, py, W, H);
    r *= vgR;
    g *= vgG;
    b *= vgB;
  }

  const exp = ctx.exposure[camIndex];
  if (exp) {
    r *= exp.r;
    g *= exp.g;
    b *= exp.b;
  }

  return { r, g, b, weight };
}

export function projectCameraToEquirect(
  c: CameraImage,
  camIndex: number,
  ctx: StitchContext,
  width: number,
  height: number
): { r: Float32Array; g: Float32Array; b: Float32Array; w: Float32Array } {
  const size = width * height;
  const r = new Float32Array(size);
  const g = new Float32Array(size);
  const b = new Float32Array(size);
  const w = new Float32Array(size);

  for (let py = 0; py < height; py++) {
    const latDeg = 90 - (py / height) * 180;
    for (let px = 0; px < width; px++) {
      const lonDeg = (px / width) * 360 - 180;
      const [dx, dy, dz] = dirFromLonLat(lonDeg, latDeg);
      const hit = projectSample(c, camIndex, ctx, dx, dy, dz);
      if (!hit) continue;
      const o = py * width + px;
      r[o] = hit.r;
      g[o] = hit.g;
      b[o] = hit.b;
      w[o] = hit.weight;
    }
  }

  return { r, g, b, w };
}
