import sharp from "sharp";
import { stitchSeamRefine, seamRefineToRgbBuffer } from "@/lib/stitcher/opticalflow/seam-refine";
import type { StitchOptions, StitchResolution } from "@/lib/stitcher/stitch";
import { loadUpfForStitch, resolveStitchSize } from "@/lib/stitcher/upf-loader";

export async function stitchUpfOpticalFlow(
  buf: Buffer,
  opts: StitchOptions = {}
): Promise<Buffer> {
  const resolution = opts.resolution ?? "preview";
  const { width, height } = resolveStitchSize(resolution, opts.width, opts.height);
  const quality = opts.quality ?? 90;
  const flowScale = width >= 2048 ? 0.35 : width >= 1024 ? 0.5 : 0.75;

  const { images, ctx } = await loadUpfForStitch(buf);
  const panorama = stitchSeamRefine(images, ctx, { width, height, flowScale });
  const raw = seamRefineToRgbBuffer(panorama);

  return sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
}

export type { StitchResolution };
