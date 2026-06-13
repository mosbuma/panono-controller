/**
 * Simplified PixFlow-style coarse-to-fine patch-match optical flow (pure TS).
 * Computes dense flow from imageL to imageR on overlap regions.
 */
import type { RgbaImage } from "@/lib/stitcher/opticalflow/rgba-image";

export type FlowField = Float32Array;

export type FlowDirection = "left" | "right";

const K_UPDATE_ALPHA = 0.9;
const K_PYR_SCALE = 0.5;
const K_MIN_SIZE = 24;

export function computeBidirectionalFlow(
  imageL: RgbaImage,
  imageR: RgbaImage,
  directionHint: FlowDirection = "left",
  downscale = 0.5
): { flowLtoR: FlowField; flowRtoL: FlowField } {
  const flowLtoR = computeOpticalFlow(imageL, imageR, directionHint, downscale);
  const flowRtoL = computeOpticalFlow(imageR, imageL, directionHint === "left" ? "right" : "left", downscale);
  return { flowLtoR, flowRtoL };
}

function computeOpticalFlow(
  src0: RgbaImage,
  src1: RgbaImage,
  hint: FlowDirection,
  downscale: number
): FlowField {
  const ext0 = extendHorizontal(src0);
  const ext1 = extendHorizontal(src1);
  const pad = Math.floor(ext0.width / 20);

  const dsW = Math.max(K_MIN_SIZE, Math.floor(ext0.width * downscale));
  const dsH = Math.max(K_MIN_SIZE, Math.floor(ext0.height * downscale));
  let i0 = resizeRgba(ext0, dsW, dsH);
  let i1 = resizeRgba(ext1, dsW, dsH);

  const gray0 = toGrayAlpha(i0);
  const gray1 = toGrayAlpha(i1);
  gaussianBlurInPlace(gray0.intensity, i0.width, i0.height, 5, 0.25);
  gaussianBlurInPlace(gray1.intensity, i1.width, i1.height, 5, 0.25);

  const pyr0 = buildPyramid(gray0, K_PYR_SCALE);
  const pyr1 = buildPyramid(gray1, K_PYR_SCALE);

  let flow: Float32Array | null = null;

  for (let level = pyr0.length - 1; level >= 0; level--) {
    const g0 = pyr0[level]!;
    const g1 = pyr1[level]!;
    if (!flow) {
      flow = new Float32Array(g0.width * g0.height * 2);
    } else if (flow.length !== g0.width * g0.height * 2) {
      const prev = pyr0[level + 1]!;
      flow = Float32Array.from(
        upscaleFlow(flow, prev.width, prev.height, g0.width, g0.height)
      );
      for (let i = 0; i < flow.length; i += 2) {
        flow[i] = (flow[i] ?? 0) / K_PYR_SCALE;
        flow[i + 1] = (flow[i + 1] ?? 0) / K_PYR_SCALE;
      }
    }
    flow = Float32Array.from(patchMatchLevel(g0, g1, flow, hint));
  }

  if (!flow) flow = new Float32Array(i0.width * i0.height * 2);

  flow = Float32Array.from(upscaleFlow(flow, i0.width, i0.height, ext0.width, ext0.height));
  for (let i = 0; i < flow.length; i += 2) {
    flow[i] = (flow[i] ?? 0) / downscale;
    flow[i + 1] = (flow[i + 1] ?? 0) / downscale;
  }

  gaussianBlurFlow(flow, ext0.width, ext0.height, 3, 1);

  const cropped = cropFlow(flow, ext0.width, ext0.height, pad);
  return cropped;
}

interface GrayAlpha {
  width: number;
  height: number;
  intensity: Float32Array;
  alpha: Float32Array;
}

function toGrayAlpha(img: RgbaImage): GrayAlpha {
  const n = img.width * img.height;
  const intensity = new Float32Array(n);
  const alpha = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    intensity[i] =
      (0.299 * img.data[o]! + 0.587 * img.data[o + 1]! + 0.114 * img.data[o + 2]!) / 255;
    alpha[i] = img.data[o + 3]! / 255;
  }
  return { width: img.width, height: img.height, intensity, alpha };
}

function buildPyramid(ga: GrayAlpha, scale: number): GrayAlpha[] {
  const pyramid: GrayAlpha[] = [ga];
  while (true) {
    const prev = pyramid[pyramid.length - 1]!;
    const nw = Math.max(K_MIN_SIZE, Math.floor(prev.width * scale));
    const nh = Math.max(K_MIN_SIZE, Math.floor(prev.height * scale));
    if (nw === prev.width && nh === prev.height) break;
    if (nw < K_MIN_SIZE || nh < K_MIN_SIZE) break;
    pyramid.push(downscaleGrayAlpha(prev, nw, nh));
  }
  return pyramid;
}

function downscaleGrayAlpha(src: GrayAlpha, nw: number, nh: number): GrayAlpha {
  const intensity = new Float32Array(nw * nh);
  const alpha = new Float32Array(nw * nh);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      const sx = (x / nw) * src.width;
      const sy = (y / nh) * src.height;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(src.width - 1, x0 + 1);
      const y1 = Math.min(src.height - 1, y0 + 1);
      const tx = sx - x0;
      const ty = sy - y0;
      const i = (idx: number) => src.intensity[idx]!;
      const a = (idx: number) => src.alpha[idx]!;
      const w00 = (1 - tx) * (1 - ty);
      const w10 = tx * (1 - ty);
      const w01 = (1 - tx) * ty;
      const w11 = tx * ty;
      const o0 = y0 * src.width + x0;
      const o1 = y0 * src.width + x1;
      const o2 = y1 * src.width + x0;
      const o3 = y1 * src.width + x1;
      const o = y * nw + x;
      intensity[o] = w00 * i(o0) + w10 * i(o1) + w01 * i(o2) + w11 * i(o3);
      alpha[o] = w00 * a(o0) + w10 * a(o1) + w01 * a(o2) + w11 * a(o3);
    }
  }
  return { width: nw, height: nh, intensity, alpha };
}

function patchMatchLevel(
  g0: GrayAlpha,
  g1: GrayAlpha,
  flowIn: Float32Array,
  hint: FlowDirection
): Float32Array {
  const { width, height } = g0;
  const flow = new Float32Array(width * height * 2);
  flow.set(flowIn.length === width * height * 2 ? flowIn : new Float32Array(width * height * 2));

  const searchDist = Math.max(4, Math.floor((K_MIN_SIZE * 20) / 100));
  const ortho = Math.max(1, Math.floor(searchDist / 8));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (g0.alpha[i]! <= K_UPDATE_ALPHA) continue;

      let bestErr = patchError(g0, g1, x, y, x, y) * 0.8;
      let bx = x;
      let by = y;

      const [sx0, sx1, sy0, sy1] = searchBox(hint, searchDist, ortho);
      for (let dy = sy0; dy <= sy1; dy++) {
        for (let dx = sx0; dx <= sx1; dx++) {
          const tx = x + dx;
          const ty = y + dy;
          if (tx < 0 || tx >= width || ty < 0 || ty >= height) continue;
          const err = patchError(g0, g1, x, y, tx, ty);
          if (err < bestErr) {
            bestErr = err;
            bx = tx;
            by = ty;
          }
        }
      }
      flow[i * 2] = bx - x;
      flow[i * 2 + 1] = by - y;
    }
  }
  return flow;
}

function searchBox(hint: FlowDirection, dist: number, ortho: number): [number, number, number, number] {
  switch (hint) {
    case "right":
      return [0, dist, -ortho, ortho];
    case "left":
      return [-dist, 0, -ortho, ortho];
    default:
      return [-dist, dist, -ortho, ortho];
  }
}

function patchError(
  g0: GrayAlpha,
  g1: GrayAlpha,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): number {
  const r = 2;
  let sad = 0;
  let alpha = 0;
  for (let dy = -r; dy <= r; dy++) {
    const sy0 = y0 + dy;
    if (sy0 < 0 || sy0 >= g0.height) continue;
    const sy1 = clamp(y1 + dy, 0, g1.height - 1);
    for (let dx = -r; dx <= r; dx++) {
      const sx0 = x0 + dx;
      if (sx0 < 0 || sx0 >= g0.width) continue;
      const sx1 = clamp(x1 + dx, 0, g1.width - 1);
      const i0 = sy0 * g0.width + sx0;
      const i1 = sy1 * g1.width + sx1;
      sad += Math.abs(g0.intensity[i0]! - g1.intensity[i1]!);
      alpha += g0.alpha[i0]! * g1.alpha[i1]!;
    }
  }
  if (alpha < 1e-4) return 1e6;
  sad /= alpha;
  const len = Math.hypot(x1 - x0, y1 - y0);
  sad *= 1 + len / Math.max(4, Math.floor((K_MIN_SIZE * 20) / 100));
  return sad;
}

function extendHorizontal(img: RgbaImage): RgbaImage {
  const pad = Math.floor(img.width / 20);
  const outW = img.width + 2 * pad;
  const data = new Uint8ClampedArray(outW * img.height * 4);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      copyPixel(data, outW, y, x + pad, img.data, img.width, y, x);
    }
    for (let x = 0; x < pad; x++) {
      copyPixel(data, outW, y, x, img.data, img.width, y, img.width - pad + x);
      copyPixel(data, outW, y, outW - pad + x, img.data, img.width, y, x);
    }
  }
  return { width: outW, height: img.height, data };
}

function cropFlow(flow: Float32Array, extW: number, height: number, pad: number): Float32Array {
  const width = extW - 2 * pad;
  const out = new Float32Array(width * height * 2);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const si = (y * extW + x + pad) * 2;
      const di = (y * width + x) * 2;
      out[di] = flow[si]!;
      out[di + 1] = flow[si + 1]!;
    }
  }
  return out;
}

function resizeRgba(src: RgbaImage, nw: number, nh: number): RgbaImage {
  const data = new Uint8ClampedArray(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      const sx = (x / nw) * src.width;
      const sy = (y / nh) * src.height;
      bilinearSampleRgba(src, sx, sy, data, nw, y, x);
    }
  }
  return { width: nw, height: nh, data };
}

function bilinearSampleRgba(
  src: RgbaImage,
  u: number,
  v: number,
  dst: Uint8ClampedArray,
  dstW: number,
  y: number,
  x: number
): void {
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const x1 = Math.min(src.width - 1, x0 + 1);
  const y1 = Math.min(src.height - 1, y0 + 1);
  const tx = u - x0;
  const ty = v - y0;
  const o = (y * dstW + x) * 4;
  for (let c = 0; c < 4; c++) {
    const c00 = src.data[(y0 * src.width + x0) * 4 + c]!;
    const c10 = src.data[(y0 * src.width + x1) * 4 + c]!;
    const c01 = src.data[(y1 * src.width + x0) * 4 + c]!;
    const c11 = src.data[(y1 * src.width + x1) * 4 + c]!;
    dst[o + c] = Math.round(
      (1 - tx) * (1 - ty) * c00 + tx * (1 - ty) * c10 + (1 - tx) * ty * c01 + tx * ty * c11
    );
  }
}

function upscaleFlow(
  flow: Float32Array,
  sw: number,
  sh: number,
  dw: number,
  dh: number
): Float32Array {
  const out = new Float32Array(dw * dh * 2);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const sx = (x / dw) * sw;
      const sy = (y / dh) * sh;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(sw - 1, x0 + 1);
      const y1 = Math.min(sh - 1, y0 + 1);
      const tx = sx - x0;
      const ty = sy - y0;
      const di = (y * dw + x) * 2;
      for (let c = 0; c < 2; c++) {
        const f = (ox: number, oy: number) => flow[(oy * sw + ox) * 2 + c]!;
        out[di + c] =
          (1 - tx) * (1 - ty) * f(x0, y0) +
          tx * (1 - ty) * f(x1, y0) +
          (1 - tx) * ty * f(x0, y1) +
          tx * ty * f(x1, y1);
      }
    }
  }
  return out;
}

function gaussianBlurInPlace(
  data: Float32Array,
  width: number,
  height: number,
  ksize: number,
  sigma: number
): void {
  void sigma;
  const r = Math.floor(ksize / 2);
  const tmp = new Float32Array(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let n = 0;
      for (let dx = -r; dx <= r; dx++) {
        sum += data[y * width + clamp(x + dx, 0, width - 1)]!;
        n++;
      }
      tmp[y * width + x] = sum / n;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let n = 0;
      for (let dy = -r; dy <= r; dy++) {
        sum += tmp[clamp(y + dy, 0, height - 1) * width + x]!;
        n++;
      }
      data[y * width + x] = sum / n;
    }
  }
}

function gaussianBlurFlow(
  flow: Float32Array,
  width: number,
  height: number,
  ksize: number,
  sigma: number
): void {
  gaussianBlurInPlace(flow, width * 2, height, ksize, sigma);
  const tmp = new Float32Array(flow.length);
  for (let i = 0; i < flow.length; i++) tmp[i] = flow[i]!;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const r = Math.floor(ksize / 2);
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const px = clamp(x + dx, 0, width - 1);
          const py = clamp(y + dy, 0, height - 1);
          const o = (py * width + px) * 2;
          sx += tmp[o]!;
          sy += tmp[o + 1]!;
          n++;
        }
      }
      const o = (y * width + x) * 2;
      flow[o] = sx / n;
      flow[o + 1] = sy / n;
    }
  }
}

function copyPixel(
  dst: Uint8ClampedArray,
  dstW: number,
  dy: number,
  dx: number,
  src: Uint8ClampedArray,
  srcW: number,
  sy: number,
  sx: number
): void {
  const so = (sy * srcW + sx) * 4;
  const doff = (dy * dstW + dx) * 4;
  dst[doff] = src[so]!;
  dst[doff + 1] = src[so + 1]!;
  dst[doff + 2] = src[so + 2]!;
  dst[doff + 3] = src[so + 3]!;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
