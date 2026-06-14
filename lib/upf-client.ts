import JSZip from "jszip";
import {
  demosaicBayerPlanes,
  findChannelFilenames,
  hasBayerChannels,
} from "@/lib/merge-bayer-channels";

const ACCEL_RECORD_BYTES = 16;
const ACCEL_SAMPLES = 50;

function grayChannel(tctx: CanvasRenderingContext2D, bmp: ImageBitmap): Uint8Array {
  // The canvas MUST be at least the bitmap size, otherwise getImageData reads
  // out-of-bounds (transparent black) and the plane decodes to all zeros.
  // Setting width/height also clears any previous plane.
  tctx.canvas.width = bmp.width;
  tctx.canvas.height = bmp.height;
  tctx.drawImage(bmp, 0, 0);
  const data = tctx.getImageData(0, 0, bmp.width, bmp.height).data;
  const gray = new Uint8Array(bmp.width * bmp.height);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    gray[j] = data[i]!;
  }
  return gray;
}

async function loadGrayPlane(
  zip: JSZip,
  name: string,
  tctx: CanvasRenderingContext2D
): Promise<{ data: Uint8Array; width: number; height: number }> {
  const file = zip.file(name);
  if (!file) throw new Error(`Missing ${name}`);
  const bmp = await createImageBitmap(await file.async("blob"));
  const data = grayChannel(tctx, bmp);
  const width = bmp.width;
  const height = bmp.height;
  bmp.close();
  return { data, width, height };
}

/**
 * Demosaic the half-res _red / _green0 / _green1 / _blue Bayer planes into a
 * full-resolution (2x) sRGB blob, applying the per-camera black level and
 * colour-correction matrix.
 */
export async function mergeChannelJpegs(
  zip: JSZip,
  filenames: string[],
  color?: { blackLevel?: number; colorMatrix?: number[][] }
): Promise<Blob | null> {
  const ch = findChannelFilenames(filenames);
  if (!ch.red || !ch.green0 || !ch.blue) return null;

  const tmp = document.createElement("canvas");
  tmp.width = 1;
  tmp.height = 1;
  const tctx = tmp.getContext("2d");
  if (!tctx) return null;

  const [r, g0, b, g1] = await Promise.all([
    loadGrayPlane(zip, ch.red, tctx),
    loadGrayPlane(zip, ch.green0, tctx),
    loadGrayPlane(zip, ch.blue, tctx),
    ch.green1 ? loadGrayPlane(zip, ch.green1, tctx) : Promise.resolve(null),
  ]);

  const w = r.width;
  const h = r.height;
  if (g0.width !== w || b.width !== w || g0.height !== h || b.height !== h) {
    return null;
  }

  const { rgb, width: W, height: H } = demosaicBayerPlanes(
    {
      red: r.data,
      green0: g0.data,
      green1: g1?.data,
      blue: b.data,
      width: w,
      height: h,
    },
    { blackLevel: color?.blackLevel, colorMatrix: color?.colorMatrix }
  );

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const img = ctx.createImageData(W, H);
  for (let i = 0, p = 0; i < W * H; i++, p += 4) {
    img.data[p] = rgb[i * 3]!;
    img.data[p + 1] = rgb[i * 3 + 1]!;
    img.data[p + 2] = rgb[i * 3 + 2]!;
    img.data[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.92));
}

export { hasBayerChannels };

/**
 * Read LIS3DSH accelerometer tail samples and return the measured "up" vector
 * (opposite to gravity) in the Panono sensor frame, normalized.
 */
export async function readHorizonUp(zip: JSZip): Promise<[number, number, number] | null> {
  const file = zip.file("LIS3DSH_ACCELEROMETER.dat");
  if (!file) return null;

  const buf = await file.async("arraybuffer");
  const b = new DataView(buf);
  const count = Math.floor(buf.byteLength / ACCEL_RECORD_BYTES);
  if (count < 4) return null;

  const start = Math.max(0, count - ACCEL_SAMPLES);
  let ax = 0;
  let ay = 0;
  let az = 0;
  let n = 0;
  for (let i = start; i < count; i++) {
    const o = i * ACCEL_RECORD_BYTES;
    ax += b.getFloat32(o + 4, true);
    ay += b.getFloat32(o + 8, true);
    az += b.getFloat32(o + 12, true);
    n++;
  }
  ax /= n;
  ay /= n;
  az /= n;
  const len = Math.hypot(ax, ay, az);
  if (len < 1) return null;
  return [ax / len, ay / len, az / len];
}
