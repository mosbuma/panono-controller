import { projectCameraToEquirect, type CameraImage, type StitchContext } from "@/lib/stitcher/projection";

/** RGBA image (8-bit per channel), row-major. */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export function createRgba(width: number, height: number, fill = 0): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  if (fill !== 0) data.fill(fill);
  return { width, height, data };
}

export function cloneRgba(src: RgbaImage): RgbaImage {
  return { width: src.width, height: src.height, data: new Uint8ClampedArray(src.data) };
}

/** Project one camera onto equirect with alpha from sample weight. */
export function projectCameraToRgba(
  cam: CameraImage,
  camIndex: number,
  ctx: StitchContext,
  width: number,
  height: number
): RgbaImage {
  const { r, g, b, w } = projectCameraToEquirect(cam, camIndex, ctx, width, height);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const wi = w[i]!;
    if (wi < 1e-4) continue;
    const o = i * 4;
    data[o] = clampByte(r[i]!);
    data[o + 1] = clampByte(g[i]!);
    data[o + 2] = clampByte(b[i]!);
    data[o + 3] = clampByte(Math.min(255, wi * 80));
  }
  return { width, height, data };
}

/** Saturated add (OpenCV-style) for compositing partial panoramas. */
export function addRgba(a: RgbaImage, b: RgbaImage): RgbaImage {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error("addRgba: size mismatch");
  }
  const out = createRgba(a.width, a.height);
  for (let i = 0; i < out.data.length; i++) {
    out.data[i] = Math.min(255, a.data[i]! + b.data[i]!);
  }
  return out;
}

export function rgbaToRgbBuffer(img: RgbaImage, bg: [number, number, number] = [12, 14, 20]): Buffer {
  const { width, height, data } = img;
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0, j = 0; i < width * height; i++, j += 3) {
    const o = i * 4;
    if (data[o + 3]! > 0) {
      raw[j] = data[o]!;
      raw[j + 1] = data[o + 1]!;
      raw[j + 2] = data[o + 2]!;
    } else {
      raw[j] = bg[0];
      raw[j + 1] = bg[1];
      raw[j + 2] = bg[2];
    }
  }
  return raw;
}

function clampByte(v: number): number {
  return Math.min(255, Math.max(0, Math.round(v)));
}
