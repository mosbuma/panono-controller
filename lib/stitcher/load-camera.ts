import JSZip from "jszip";
import sharp from "sharp";
import type { ManifestCamera } from "@/lib/manifest";
import type { CameraImage } from "@/lib/stitcher/exposure";
import {
  demosaicBayerPlanes,
  findChannelFilenames,
  hasBayerChannels,
} from "@/lib/merge-bayer-channels";

export async function loadCameraRgb(
  zip: JSZip,
  cam: ManifestCamera
): Promise<{ rgb: Uint8Array; width: number; height: number } | null> {
  const files = cam.imageFilenames ?? [];
  const previewName = files.find((f) => !/_red|_green|_blue/i.test(f));
  if (previewName && !hasBayerChannels(files)) {
    const file = zip.file(previewName);
    if (!file) return null;
    const buf = await file.async("nodebuffer");
    const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({
      resolveWithObject: true,
    });
    return {
      rgb: new Uint8Array(data),
      width: info.width,
      height: info.height,
    };
  }

  if (!hasBayerChannels(files)) return null;

  const ch = findChannelFilenames(files);
  const [rBuf, g0Buf, bBuf, g1Buf] = await Promise.all(
    [ch.red!, ch.green0!, ch.blue!, ch.green1].map(async (n) => {
      if (!n) return null;
      const f = zip.file(n);
      return f ? f.async("nodebuffer") : null;
    })
  );
  if (!rBuf || !g0Buf || !bBuf) return null;

  const [r, g0, b] = await Promise.all([rBuf, g0Buf, bBuf].map((buf) => grayRaw(buf!)));
  const g1 = g1Buf ? await grayRaw(g1Buf) : null;
  const { rgb, width, height } = demosaicBayerPlanes(
    {
      red: r.data,
      green0: g0.data,
      green1: g1?.data,
      blue: b.data,
      width: r.width,
      height: r.height,
    }
  );
  return { rgb, width, height };
}

async function grayRaw(
  buf: Buffer
): Promise<{ data: Uint8Array; width: number; height: number }> {
  const { data, info } = await sharp(buf).grayscale().raw().toBuffer({
    resolveWithObject: true,
  });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
}

export async function loadAllCameras(zip: JSZip, cameras: ManifestCamera[]): Promise<CameraImage[]> {
  const images: CameraImage[] = [];
  for (const cam of cameras) {
    const loaded = await loadCameraRgb(zip, cam);
    if (loaded) images.push({ cam, ...loaded });
  }
  return images;
}
