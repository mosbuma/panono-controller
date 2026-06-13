import type { ManifestCamera } from "@/lib/manifest";

export interface CameraImage {
  cam: ManifestCamera;
  rgb: Uint8Array;
  width: number;
  height: number;
}

export interface ExposureGains {
  r: number;
  g: number;
  b: number;
}

/** Per-camera RGB gains so central-region medians match the panorama average. */
export function computeExposureGains(images: CameraImage[]): ExposureGains[] {
  const medians: [number, number, number][] = images.map((img) =>
    medianCentralRgb(img, 0.35)
  );

  const target: [number, number, number] = [0, 0, 0];
  for (const m of medians) {
    target[0] += m[0];
    target[1] += m[1];
    target[2] += m[2];
  }
  const n = Math.max(1, medians.length);
  target[0] /= n;
  target[1] /= n;
  target[2] /= n;

  return medians.map(([mr, mg, mb]) => ({
    r: mr > 1 ? target[0] / mr : 1,
    g: mg > 1 ? target[1] / mg : 1,
    b: mb > 1 ? target[2] / mb : 1,
  }));
}

function medianCentralRgb(img: CameraImage, radiusFrac: number): [number, number, number] {
  const K = img.cam.intrinsicMatrix;
  const px = K[0]![2]!;
  const py = K[1]![2]!;
  const W = img.width;
  const H = img.height;
  const maxR = Math.min(W, H) * radiusFrac;

  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const rgb = img.rgb;
  const x0 = Math.max(0, Math.floor(px - maxR));
  const x1 = Math.min(W - 1, Math.ceil(px + maxR));
  const y0 = Math.max(0, Math.floor(py - maxR));
  const y1 = Math.min(H - 1, Math.ceil(py + maxR));

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (Math.hypot(x - px, y - py) > maxR) continue;
      const o = (y * W + x) * 3;
      rs.push(rgb[o]!);
      gs.push(rgb[o + 1]!);
      bs.push(rgb[o + 2]!);
    }
  }

  if (!rs.length) return [128, 128, 128];
  return [median(rs), median(gs), median(bs)];
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
