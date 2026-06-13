import { computeBidirectionalFlow } from "@/lib/stitcher/opticalflow/flow-lite";
import { combineNovelViews } from "@/lib/stitcher/opticalflow/novel-view";
import { cloneRgba, type RgbaImage } from "@/lib/stitcher/opticalflow/rgba-image";
import {
  countOverlapPixels,
  gatherFinal,
  MAP_OVERLAP,
  prepareStitchTool,
  setMergedMiddle,
} from "@/lib/stitcher/opticalflow/stitch-tool";

export interface PairwiseBlendOptions {
  /** Flow computed at this scale (0.25–1). Lower = faster. */
  flowScale?: number;
  /** Skip optical flow when overlap is smaller than this pixel count. */
  minOverlapPixels?: number;
}

const DEFAULT_OPTS: Required<PairwiseBlendOptions> = {
  flowScale: 0.5,
  minOverlapPixels: 64,
};

/**
 * Blend imageL (new view) into imageR (accumulated panorama) using
 * asymmetric bidirectional optical flow in the overlap region.
 */
export function pairwiseOpticalFlowBlend(
  imageL: RgbaImage,
  imageR: RgbaImage,
  opts: PairwiseBlendOptions = {}
): RgbaImage {
  const o = { ...DEFAULT_OPTS, ...opts };
  const tool = prepareStitchTool(imageL, imageR);
  const overlap = countOverlapPixels(tool.map);

  if (overlap < o.minOverlapPixels) {
    return alphaCompositePreferL(imageL, imageR);
  }

  const flowScale = imageL.width >= 1024 ? o.flowScale : Math.min(1, o.flowScale * 1.5);

  const { flowLtoR, flowRtoL } = computeBidirectionalFlow(
    tool.overlappedL,
    tool.overlappedR,
    "left",
    flowScale
  );

  const merged = combineNovelViews(
    tool.overlappedL,
    tool.overlappedR,
    flowLtoR,
    flowRtoL,
    tool.blend
  );

  setMergedMiddle(tool, merged);
  return gatherFinal(tool);
}

function alphaCompositePreferL(a: RgbaImage, b: RgbaImage): RgbaImage {
  const out = cloneRgba(b);
  for (let i = 0; i < a.width * a.height; i++) {
    const o = i * 4;
    const aa = a.data[o + 3]! / 255;
    if (aa <= 0) continue;
    const ba = b.data[o + 3]! / 255;
    const outA = aa + ba * (1 - aa);
    if (outA <= 0) continue;
    for (let c = 0; c < 3; c++) {
      out.data[o + c] = Math.round(
        (a.data[o + c]! * aa + b.data[o + c]! * ba * (1 - aa)) / outA
      );
    }
    out.data[o + 3] = Math.round(outA * 255);
  }
  return out;
}

/** Count overlap between two RGBA layers (for diagnostics). */
export function measureOverlap(a: RgbaImage, b: RgbaImage): number {
  let n = 0;
  for (let i = 0; i < a.width * a.height; i++) {
    if (a.data[i * 4 + 3]! > 0 && b.data[i * 4 + 3]! > 0) n++;
  }
  return n;
}

export { MAP_OVERLAP };
