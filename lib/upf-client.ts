import JSZip from "jszip";

const ACCEL_RECORD_BYTES = 16;
const ACCEL_SAMPLES = 50;

/** Merge separate R/G0/G1/B channel JPEGs into one RGB blob. */
export async function mergeChannelJpegs(
  zip: JSZip,
  filenames: string[]
): Promise<Blob | null> {
  const find = (tag: string) => filenames.find((f) => f.includes(tag));
  const redName = find("_red");
  const g0Name = find("_green0");
  const g1Name = find("_green1");
  const blueName = find("_blue");
  if (!redName || !g0Name || !g1Name || !blueName) return null;

  const [redF, g0F, g1F, blueF] = [redName, g0Name, g1Name, blueName].map((n) =>
    zip.file(n)
  );
  if (!redF || !g0F || !g1F || !blueF) return null;

  const [rBmp, g0Bmp, g1Bmp, bBmp] = await Promise.all(
    [redF, g0F, g1F, blueF].map(async (f) =>
      createImageBitmap(await f.async("blob"))
    )
  );

  const w = rBmp.width;
  const h = rBmp.height;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const tmp = document.createElement("canvas");
  tmp.width = w;
  tmp.height = h;
  const tctx = tmp.getContext("2d");
  if (!tctx) return null;

  const out = ctx.createImageData(w, h);
  const rPx = grayChannel(tctx, rBmp);
  const g0Px = grayChannel(tctx, g0Bmp);
  const g1Px = grayChannel(tctx, g1Bmp);
  const bPx = grayChannel(tctx, bBmp);

  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    out.data[p] = rPx[i];
    out.data[p + 1] = Math.round((g0Px[i] + g1Px[i]) / 2);
    out.data[p + 2] = bPx[i];
    out.data[p + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  rBmp.close();
  g0Bmp.close();
  g1Bmp.close();
  bBmp.close();

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.92));
}

function grayChannel(tctx: CanvasRenderingContext2D, bmp: ImageBitmap): Uint8Array {
  tctx.drawImage(bmp, 0, 0);
  const data = tctx.getImageData(0, 0, bmp.width, bmp.height).data;
  const gray = new Uint8Array(bmp.width * bmp.height);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    gray[j] = data[i]; // channels are equal in grayscale JPEG
  }
  return gray;
}

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
