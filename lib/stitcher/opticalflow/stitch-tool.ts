/**
 * Port of MungoMeng/Panorama-OpticalFlow StitchTool (overlap map + blend weights + gather).
 * Map codes: L-only=100, R-only=50, overlap=150, empty=0.
 */
import { cloneRgba, createRgba, type RgbaImage } from "@/lib/stitcher/opticalflow/rgba-image";

export const MAP_L = 100;
export const MAP_R = 50;
export const MAP_OVERLAP = 150;

export interface StitchToolState {
  imageL: RgbaImage;
  imageR: RgbaImage;
  map: Uint8Array;
  blend: Float32Array;
  overlappedL: RgbaImage;
  overlappedR: RgbaImage;
  mergedMiddle: RgbaImage | null;
}

export function prepareStitchTool(imageL: RgbaImage, imageR: RgbaImage): StitchToolState {
  const { width, height } = imageL;
  const map = new Uint8Array(width * height);
  matchImages(imageL, imageR, map);

  const mapMask = new Uint8Array(width * height);
  for (let i = 0; i < map.length; i++) {
    mapMask[i] = map[i]! >= 140 ? 1 : 0;
  }

  const overlappedL = maskRgba(imageL, mapMask);
  const overlappedR = maskRgba(imageR, mapMask);
  const blend = generateBlend(map, width, height);

  return {
    imageL: cloneRgba(imageL),
    imageR: cloneRgba(imageR),
    map,
    blend,
    overlappedL,
    overlappedR,
    mergedMiddle: null,
  };
}

function matchImages(imageL: RgbaImage, imageR: RgbaImage, map: Uint8Array): void {
  const { width, height, data: lData } = imageL;
  const rData = imageR.data;
  for (let i = 0; i < width * height; i++) {
    const lo = i * 4 + 3;
    const la = lData[lo]! > 0 ? 100 : 0;
    const ra = rData[lo]! > 0 ? 50 : 0;
    map[i] = la + ra;
  }
}

function maskRgba(src: RgbaImage, mask: Uint8Array): RgbaImage {
  const out = cloneRgba(src);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) {
      const o = i * 4;
      out.data[o] = 0;
      out.data[o + 1] = 0;
      out.data[o + 2] = 0;
      out.data[o + 3] = 0;
    }
  }
  return out;
}

function generateBlend(map: Uint8Array, width: number, height: number): Float32Array {
  const length = Math.floor(width / 5);
  const extW = width + 2 * length;
  const extMap = new Uint8Array(extW * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      extMap[y * extW + x + length] = map[y * width + x]!;
    }
    for (let x = 0; x < length; x++) {
      extMap[y * extW + x] = map[y * width + width - length + x]!;
      extMap[y * extW + extW - length + x] = map[y * width + x]!;
    }
  }

  const blend = new Float32Array(width * height);
  const mergedDis = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const mx = x + length;
      const mv = extMap[y * extW + mx]!;
      const o = y * width + x;
      if (mv === MAP_L) blend[o] = 0;
      else if (mv === MAP_R) blend[o] = 1;
      else if (mv === MAP_OVERLAP) {
        blend[o] = countBlend(extMap, extW, height, mx, y, mergedDis, o, width, height);
      } else blend[o] = 0.5;
    }
  }

  blurBlendInPlace(blend, mergedDis, width, height);
  return blend;
}

function countBlend(
  map: Uint8Array,
  mapW: number,
  mapH: number,
  x: number,
  y: number,
  mergedDis: Float32Array,
  outIdx: number,
  imgW: number,
  imgH: number
): number {
  const step = imgW <= imgH ? Math.max(1, Math.floor(imgW / 200)) : Math.max(1, Math.floor(imgH / 200));
  let minL = imgW * 10;
  let minR = imgW * 10;

  for (let i = 0; i < imgW / 2; i += step) {
    const dirs: [number, number][] = [
      [i, 0],
      [-i, 0],
      [0, i],
      [0, -i],
      [i, i],
      [-i, -i],
      [i, -i],
      [-i, i],
    ];
    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= mapW || ny < 0 || ny >= mapH) continue;
      const v = map[ny * mapW + nx]!;
      const dist = dx !== 0 && dy !== 0 ? i * Math.SQRT2 : i;
      if (v === MAP_L && dist < minL) minL = dist;
      if (v === MAP_R && dist < minR) minR = dist;
    }
  }

  const blend = minL / (minR + minL + 1e-6);
  mergedDis[outIdx] = minL < minR ? minL : minR;
  return blend;
}

function blurBlendInPlace(
  blend: Float32Array,
  mergedDis: Float32Array,
  width: number,
  height: number
): void {
  const step = width <= height ? Math.max(1, Math.floor(width / 200)) : Math.max(1, Math.floor(height / 200));
  const k = Math.max(3, Math.floor(height / 130));
  const tmp = new Float32Array(blend.length);

  for (let y = 0; y + step < height; y += step) {
    for (let x = 0; x + step < width; x += step) {
      if (mergedDis[y * width + x]! <= step) continue;
      boxBlurBlock(blend, tmp, x, y, step, step, width, k);
    }
  }
  boxBlurFull(blend, tmp, width, height, Math.max(3, Math.floor(height / 400)));
}

function boxBlurBlock(
  src: Float32Array,
  tmp: Float32Array,
  x0: number,
  y0: number,
  bw: number,
  bh: number,
  width: number,
  k: number
): void {
  const r = Math.floor(k / 2);
  for (let y = y0; y < y0 + bh; y++) {
    for (let x = x0; x < x0 + bw; x++) {
      let sum = 0;
      let n = 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const sx = Math.max(x0, Math.min(x0 + bw - 1, x + dx));
          const sy = Math.max(y0, Math.min(y0 + bh - 1, y + dy));
          sum += src[sy * width + sx]!;
          n++;
        }
      }
      tmp[y * width + x] = sum / n;
    }
  }
  for (let y = y0; y < y0 + bh; y++) {
    for (let x = x0; x < x0 + bw; x++) {
      src[y * width + x] = tmp[y * width + x]!;
    }
  }
}

function boxBlurFull(
  src: Float32Array,
  tmp: Float32Array,
  width: number,
  height: number,
  k: number
): void {
  boxBlurBlock(src, tmp, 0, 0, width, height, width, k);
}

export function setMergedMiddle(state: StitchToolState, merged: RgbaImage): void {
  state.mergedMiddle = cloneRgba(merged);
}

export function gatherFinal(state: StitchToolState): RgbaImage {
  const { imageL, imageR, map, mergedMiddle } = state;
  if (!mergedMiddle) throw new Error("gatherFinal: mergedMiddle not set");
  const { width, height } = imageL;
  const result = createRgba(width, height);

  const midAlpha = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    midAlpha[i] = mergedMiddle.data[i * 4 + 3]! > 0 ? 75 : 0;
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const o = i * 4;
      const m = map[i]! + midAlpha[i]!;

      if (m === 100) copyPx(result, o, imageL, o);
      else if (m === 50) copyPx(result, o, imageR, o);
      else if (m === 225 || m === 125 || m === 175) copyPx(result, o, mergedMiddle, o);
      else if (m === 150) {
        const pick = searchNeighbor(map, width, height, x, y);
        if (pick === "L") copyPx(result, o, imageL, o);
        else if (pick === "R") copyPx(result, o, imageR, o);
        else {
          result.data[o] = 0;
          result.data[o + 1] = 0;
          result.data[o + 2] = 0;
          result.data[o + 3] = 0;
        }
      }
    }
  }
  return result;
}

function copyPx(dst: RgbaImage, doff: number, src: RgbaImage, soff: number): void {
  dst.data[doff] = src.data[soff]!;
  dst.data[doff + 1] = src.data[soff + 1]!;
  dst.data[doff + 2] = src.data[soff + 2]!;
  dst.data[doff + 3] = src.data[soff + 3]!;
}

function searchNeighbor(
  map: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number
): "L" | "R" | null {
  for (let i = 1; i < 100; i++) {
    const probes: [number, number][] = [
      [x + i, y],
      [x - i, y],
      [x, y + i],
      [x, y - i],
      [x - i, y - i],
      [x - i, y + i],
      [x + i, y - i],
      [x + i, y + i],
    ];
    for (const [px, py] of probes) {
      if (px < 0 || px >= width || py < 0 || py >= height) continue;
      const v = map[py * width + px]!;
      if (v === MAP_L) return "L";
      if (v === MAP_R) return "R";
    }
  }
  return null;
}

export function countOverlapPixels(map: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < map.length; i++) {
    if (map[i] === MAP_OVERLAP) n++;
  }
  return n;
}
