/**
 * Backend UPF → per-camera JPEG converter.
 *
 * Decodes the half-res Bayer channel planes from a Panono `.upf`, runs the
 * verified colour pipeline (see lib/merge-bayer-channels.ts:
 * GRBG demosaic → black-level linearise → colourMatrix → sRGB), and writes one
 * full-resolution JPEG per camera to disk. Mirrors the official converter's
 * per-camera output.
 *
 * Usage:
 *   npx tsc scripts/upf-to-jpegs.ts --outDir /tmp/b --module commonjs \
 *     --target es2020 --esModuleInterop --skipLibCheck
 *   node /tmp/b/scripts/upf-to-jpegs.js <input.upf> <output-dir>
 */
import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import sharp from "sharp";
import { demosaicBayerPlanes, findChannelFilenames } from "../lib/merge-bayer-channels";
import type { UpfManifest, ManifestCamera } from "../lib/manifest";

async function grayPlane(
  zip: JSZip,
  name: string
): Promise<{ data: Uint8Array; width: number; height: number }> {
  const file = zip.file(name);
  if (!file) throw new Error(`Missing plane ${name}`);
  const buf = await file.async("nodebuffer");
  const { data, info } = await sharp(buf)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
}

async function convertCamera(
  zip: JSZip,
  cam: ManifestCamera,
  outPath: string
): Promise<void> {
  const ch = findChannelFilenames(cam.imageFilenames ?? []);
  if (!ch.red || !ch.green0 || !ch.blue) {
    throw new Error(`Camera ${cam.id}: missing Bayer channel planes`);
  }

  const [r, g0, b] = await Promise.all([
    grayPlane(zip, ch.red),
    grayPlane(zip, ch.green0),
    grayPlane(zip, ch.blue),
  ]);
  const g1 = ch.green1 ? await grayPlane(zip, ch.green1) : null;

  const { rgb, width, height } = demosaicBayerPlanes(
    {
      red: r.data,
      green0: g0.data,
      green1: g1?.data,
      blue: b.data,
      width: r.width,
      height: r.height,
    },
    { blackLevel: cam.blackLevel, colorMatrix: cam.colorMatrix }
  );

  await sharp(Buffer.from(rgb), { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 92, mozjpeg: true })
    .toFile(outPath);
}

async function main(): Promise<void> {
  const [, , inputUpf, outDir] = process.argv;
  if (!inputUpf || !outDir) {
    console.error("Usage: node upf-to-jpegs.js <input.upf> <output-dir>");
    process.exit(1);
  }

  const buf = await fs.readFile(inputUpf);
  const zip = await JSZip.loadAsync(buf);
  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) throw new Error("manifest.json not found in UPF");
  const manifest = JSON.parse(await manifestFile.async("string")) as UpfManifest;

  const setId = manifest.defaultSetId ?? 0;
  const cameras = (
    manifest.imageSets?.[setId]?.cameras ?? manifest.imageSets?.[0]?.cameras ?? []
  )
    .slice()
    .sort((a, b) => a.id - b.id);
  if (!cameras.length) throw new Error("No cameras in manifest");

  await fs.mkdir(outDir, { recursive: true });

  let done = 0;
  for (const cam of cameras) {
    const out = path.join(outDir, `img${cam.id}.jpg`);
    await convertCamera(zip, cam, out);
    done++;
    process.stdout.write(`\rConverted ${done}/${cameras.length}`);
  }
  process.stdout.write("\n");
  console.log(`Wrote ${done} JPEGs to ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
