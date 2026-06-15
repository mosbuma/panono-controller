import { stitchEquirectJpeg } from "@/lib/stitcher/equirect-official";
import { stitchUpfOpticalFlow } from "@/lib/stitcher/stitch-opticalflow";
import { loadUpfForStitch, resolveStitchSize } from "@/lib/stitcher/upf-loader";

export type StitchResolution = "preview" | "full";
// "calibrated" is the JS port of the official preview stitch
// (lib/stitcher/equirect-official.ts).
export type StitchMethod = "calibrated" | "opticalflow";

export interface StitchOptions {
  width?: number;
  height?: number;
  resolution?: StitchResolution;
  quality?: number;
  method?: StitchMethod;
  /** Horizon (gravity) correction. Default true. */
  useGravity?: boolean;
  /** Radial vignetting gain at sample time. Default false. */
  applyVignetting?: boolean;
  /** Content-based per-camera exposure/WB normalization. Default false. */
  applyExposure?: boolean;
}

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

  return stitchEquirectJpeg(images, ctx, width, height, ctx.gravity ?? null, quality, {
    useGravity: opts.useGravity,
    applyVignetting: opts.applyVignetting,
    applyExposure: opts.applyExposure,
  });
}
