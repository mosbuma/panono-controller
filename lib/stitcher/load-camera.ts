import JSZip from "jszip";
import sharp from "sharp";
import type { ManifestCamera } from "@/lib/manifest";
import type { CameraImage } from "@/lib/stitcher/exposure";

export async function loadCameraRgb(
  zip: JSZip,
  cam: ManifestCamera
): Promise<{ rgb: Uint8Array; width: number; height: number } | null> {
  const files = cam.imageFilenames ?? [];
  const previewName = files.find((f) => !/_red|_green|_blue/i.test(f));
  if (previewName) {
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

  const find = (tag: string) => files.find((f) => f.includes(tag));
  const names = [find("_red"), find("_green0"), find("_green1"), find("_blue")];
  if (names.some((n) => !n)) return null;

  const [rBuf, g0Buf, g1Buf, bBuf] = await Promise.all(
    names.map(async (n) => {
      const f = zip.file(n!);
      return f ? f.async("nodebuffer") : null;
    })
  );
  if (!rBuf || !g0Buf || !g1Buf || !bBuf) return null;

  const [r, g0, g1, b] = await Promise.all(
    [rBuf, g0Buf, g1Buf, bBuf].map((buf) => grayRaw(buf))
  );
  const width = r.width;
  const height = r.height;
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < width * height; i++, j += 3) {
    rgb[j] = r.data[i]!;
    rgb[j + 1] = Math.round((g0.data[i]! + g1.data[i]!) / 2);
    rgb[j + 2] = b.data[i]!;
  }
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
