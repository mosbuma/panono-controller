import JSZip from "jszip";
import type { UpfManifest } from "@/lib/manifest";
import { computeExposureGains } from "@/lib/stitcher/exposure";
import { loadAllCameras } from "@/lib/stitcher/load-camera";
import type { CameraImage } from "@/lib/stitcher/projection";
import type { StitchContext } from "@/lib/stitcher/projection";
import { parseVignettingCoeffs } from "@/lib/stitcher/vignetting";
import type { StitchResolution } from "@/lib/stitcher/stitch";

export const STITCH_PRESETS: Record<StitchResolution, { width: number; height: number }> = {
  preview: { width: 2048, height: 1024 },
  full: { width: 4096, height: 2048 },
};

export interface LoadedUpf {
  manifest: UpfManifest;
  images: CameraImage[];
  ctx: StitchContext;
}

export async function loadUpfForStitch(buf: Buffer): Promise<LoadedUpf> {
  const zip = await JSZip.loadAsync(buf);
  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) throw new Error("manifest.json not found in UPF");

  const manifest = JSON.parse(await manifestFile.async("string")) as UpfManifest;
  const setId = manifest.defaultSetId ?? 0;
  const cameras =
    manifest.imageSets?.[setId]?.cameras ?? manifest.imageSets?.[0]?.cameras ?? [];
  if (!cameras.length) throw new Error("No cameras in manifest");

  const vignettingFile = zip.file("vignetting_coeffs.txt");
  const vignetting = vignettingFile
    ? parseVignettingCoeffs(await vignettingFile.async("string"))
    : null;

  const images = await loadAllCameras(zip, cameras);
  if (!images.length) throw new Error("No camera images loaded");

  const ctx: StitchContext = {
    vignetting,
    exposure: computeExposureGains(images),
  };

  return { manifest, images, ctx };
}

export function resolveStitchSize(
  resolution: StitchResolution,
  width?: number,
  height?: number
): { width: number; height: number } {
  const preset = STITCH_PRESETS[resolution];
  return {
    width: width ?? preset.width,
    height: height ?? preset.height,
  };
}
