import type { ManifestCamera } from "@/lib/manifest";
import { pairwiseOpticalFlowBlend } from "@/lib/stitcher/opticalflow/pairwise-blend";
import { projectCameraToRgba, rgbaToRgbBuffer, type RgbaImage } from "@/lib/stitcher/opticalflow/rgba-image";
import type { CameraImage, StitchContext } from "@/lib/stitcher/projection";

export interface OrderedCamera {
  image: CameraImage;
  camIndex: number;
  yawDeg: number;
}

/** Camera forward yaw on the equatorial plane (degrees, −180…180). */
export function cameraYawDeg(cam: ManifestCamera): number {
  const R = cam.rotationMatrix;
  const wx = R[0]![2]!;
  const wz = R[2]![2]!;
  return (Math.atan2(wz, wx) * 180) / Math.PI;
}

export function orderCamerasByYaw(images: CameraImage[]): OrderedCamera[] {
  const ordered = images.map((image, camIndex) => ({
    image,
    camIndex,
    yawDeg: cameraYawDeg(image.cam),
  }));
  ordered.sort((a, b) => a.yawDeg - b.yawDeg);
  return ordered;
}

export interface SeamRefineOptions {
  width: number;
  height: number;
  flowScale?: number;
  /** Log progress callback (camera index, total). */
  onProgress?: (current: number, total: number) => void;
}

/**
 * Disney-style sequential pairwise seam refinement:
 * yaw-order 36 cameras, accumulate with optical-flow blending at each overlap.
 */
export function stitchSeamRefine(
  images: CameraImage[],
  ctx: StitchContext,
  opts: SeamRefineOptions
): RgbaImage {
  const ordered = orderCamerasByYaw(images);
  if (!ordered.length) throw new Error("No cameras to stitch");

  const { width, height, flowScale, onProgress } = opts;
  let acc = projectCameraToRgba(ordered[0]!.image, ordered[0]!.camIndex, ctx, width, height);

  for (let i = 1; i < ordered.length; i++) {
    onProgress?.(i, ordered.length);
    const { image, camIndex } = ordered[i]!;
    const next = projectCameraToRgba(image, camIndex, ctx, width, height);
    acc = pairwiseOpticalFlowBlend(next, acc, { flowScale });
  }

  onProgress?.(ordered.length, ordered.length);
  return acc;
}

export function seamRefineToRgbBuffer(panorama: RgbaImage): Buffer {
  return rgbaToRgbBuffer(panorama);
}
