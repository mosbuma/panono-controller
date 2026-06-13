import sharp from "sharp";
import {
  accumulateCameraPyramids,
  buildGaussianPyramid,
  buildLaplacianPyramid,
  createPyramidAccumulator,
  finalizePyramidAccumulator,
  pyramidLevelCount,
  pyramidSizes,
} from "@/lib/stitcher/multiband";
import {
  dirFromLonLat,
  projectCameraToEquirect,
  projectSample,
  type CameraImage,
  type StitchContext,
} from "@/lib/stitcher/projection";
import { stitchUpfOpticalFlow } from "@/lib/stitcher/stitch-opticalflow";
import { loadUpfForStitch, resolveStitchSize } from "@/lib/stitcher/upf-loader";

export type StitchResolution = "preview" | "full";
export type StitchMethod = "calibrated" | "opticalflow";

export interface StitchOptions {
  width?: number;
  height?: number;
  resolution?: StitchResolution;
  quality?: number;
  method?: StitchMethod;
}

const MULTIBAND_MIN_WIDTH = 512;

export async function stitchUpfBuffer(buf: Buffer, opts: StitchOptions = {}): Promise<Buffer> {
  const method = opts.method ?? "calibrated";
  if (method === "opticalflow") {
    return stitchUpfOpticalFlow(buf, opts);
  }
  return stitchUpfCalibrated(buf, opts);
}

async function stitchUpfCalibrated(buf: Buffer, opts: StitchOptions): Promise<Buffer> {
  const resolution = opts.resolution ?? "preview";
  const { width, height } = resolveStitchSize(resolution, opts.width, opts.height);
  const quality = opts.quality ?? 90;

  const { images, ctx } = await loadUpfForStitch(buf);

  const useMultiband = width >= MULTIBAND_MIN_WIDTH;
  const { r, g, b } = useMultiband
    ? stitchMultiband(images, ctx, width, height)
    : stitchSpatial(images, ctx, width, height);

  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const o = i * 3;
    const w = r[i]! !== 0 || g[i]! !== 0 || b[i]! !== 0;
    if (w) {
      raw[o] = clampByte(r[i]!);
      raw[o + 1] = clampByte(g[i]!);
      raw[o + 2] = clampByte(b[i]!);
    } else {
      raw[o] = 12;
      raw[o + 1] = 14;
      raw[o + 2] = 20;
    }
  }

  return sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
}

function stitchSpatial(
  images: CameraImage[],
  ctx: StitchContext,
  width: number,
  height: number
): { r: Float32Array; g: Float32Array; b: Float32Array } {
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

  const r = new Float32Array(size);
  const g = new Float32Array(size);
  const b = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const w = accW[i]!;
    if (w > 1e-6) {
      r[i] = accR[i]! / w;
      g[i] = accG[i]! / w;
      b[i] = accB[i]! / w;
    }
  }
  return { r, g, b };
}

function stitchMultiband(
  images: CameraImage[],
  ctx: StitchContext,
  width: number,
  height: number
): { r: Float32Array; g: Float32Array; b: Float32Array } {
  const levels = pyramidLevelCount(width, height);
  const sizes = pyramidSizes(width, height, levels);
  const acc = createPyramidAccumulator(sizes);

  for (let ci = 0; ci < images.length; ci++) {
    const projected = projectCameraToEquirect(images[ci]!, ci, ctx, width, height);
    const gR = buildGaussianPyramid(projected.r, sizes);
    const gG = buildGaussianPyramid(projected.g, sizes);
    const gB = buildGaussianPyramid(projected.b, sizes);
    const gW = buildGaussianPyramid(projected.w, sizes);
    const lR = buildLaplacianPyramid(gR, sizes);
    const lG = buildLaplacianPyramid(gG, sizes);
    const lB = buildLaplacianPyramid(gB, sizes);
    accumulateCameraPyramids(acc, lR, lG, lB, gW);
  }

  return finalizePyramidAccumulator(acc);
}

function clampByte(v: number): number {
  return Math.min(255, Math.max(0, Math.round(v)));
}
