import fs from "fs";
import { stitchUpfBuffer } from "../lib/stitcher/stitch";

async function main() {
  const upfPath = process.argv[2] ?? "/tmp/full.upf";
  if (!fs.existsSync(upfPath)) {
    console.error("UPF not found:", upfPath);
    process.exit(1);
  }
  const buf = fs.readFileSync(upfPath);
  const w = Number(process.argv[3] ?? 512);
  const h = Number(process.argv[4] ?? 256);

  const t0 = Date.now();
  const jpeg = await stitchUpfBuffer(buf, {
    width: w,
    height: h,
    quality: 85,
    method: "opticalflow",
  });
  const out = `/tmp/test-oflow-${w}x${h}.jpg`;
  fs.writeFileSync(out, jpeg);
  console.log(`Wrote ${out} (${jpeg.length} bytes) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
