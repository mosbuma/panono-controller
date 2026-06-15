/**
 * Reconstruct full-resolution RGB from Panono full-UPF channel JPEGs,
 * reproducing the official Panono UPF Converter (v1.1.0) per-camera output.
 *
 * Verified against the official converter's output on the reference demo set
 * (`reference/demo-image`): mean absolute error ≈6 levels and contrast (per-
 * channel std) matches within ~1 level. The pipeline per camera is:
 *   1. Recombine the four half-res channel JPEGs (_red, _green0, _green1,
 *      _blue) into the full Bayer mosaic and bilinear-demosaic it. The
 *      `imageFormat` is `RAW_GR_8bit_...` => the mosaic is GRBG:
 *        (2x,   2y  ) = G (green0)   (2x+1, 2y  ) = R (red)
 *        (2x,   2y+1) = B (blue)     (2x+1, 2y+1) = G (green1)
 *   2. Emit the demosaiced bytes directly.
 *
 * Crucially the shipped channel planes are **already display-referred**
 * (white-balanced AND gamma-encoded by the camera). Re-applying an sRGB OETF
 * (the previous approach) double-gammas them and roughly doubles contrast
 * (std ≈57 vs the official ≈40, MAE ≈26). Treating them as already-encoded and
 * passing the demosaiced bytes through matches the official output (MAE ≈6).
 *
 * A small, stable residual warm white balance remains (the official is ~3
 * levels redder / ~9 bluer). `REFERENCE_WHITE_GAIN` (fit on the demo set, MAE
 * 6.0→4.66) can be supplied via `whiteGain`; it is off by default because it
 * was fit to a single reference capture and may not generalise across devices.
 *
 * The manifest `blackLevel`, `colorMatrix` and `whiteBalance` are NOT applied:
 * black level and white balance are already baked into the planes, and the
 * colour matrix worsens R/B when applied to the already-demosaiced planes.
 */

import { finishImage } from "./finish-image";

/**
 * Residual per-channel display-space white-balance gain fit against the
 * official output on `reference/demo-image` (stable across all 36 cameras,
 * std ≈0.02). Opt in via `DemosaicOptions.whiteGain`.
 */
export const REFERENCE_WHITE_GAIN = [1.028, 1.001, 0.922] as const;

export interface BayerPlanes {
  red: Uint8Array;
  green0: Uint8Array;
  /** Optional second green plane; falls back to green0 when absent. */
  green1?: Uint8Array;
  blue: Uint8Array;
  /** Per-plane (half) dimensions. */
  width: number;
  height: number;
}

export interface DemosaicOptions {
  /**
   * Optional per-channel display-space gain (a small residual white balance).
   * Identity by default. `REFERENCE_WHITE_GAIN` matches the demo reference best
   * but is fit to a single capture, so it is opt-in.
   */
  whiteGain?: readonly [number, number, number];
  /**
   * Apply the finishing chain (local contrast + unsharp + adaptive
   * autoContrast) that approximates the official converter's `imageImprovement`
   * (see lib/finish-image.ts). Off by default: it adds perceptual crispness but
   * lowers numeric fidelity to the reference (~2x slower).
   */
  finish?: boolean;
}

export interface DemosaicResult {
  /** Interleaved RGB, length = width * height * 3. */
  rgb: Uint8Array;
  /** Full image width (2 * plane width). */
  width: number;
  /** Full image height (2 * plane height). */
  height: number;
}

/**
 * Recombine the half-res GRBG planes into the full mosaic and bilinear-
 * demosaic, emitting the demosaiced (already display-referred) bytes. Output is
 * 2x the plane dimensions.
 */
export function demosaicBayerPlanes(
  planes: BayerPlanes,
  opts: DemosaicOptions = {}
): DemosaicResult {
  const { red, green0, blue, width: w, height: h } = planes;
  const green1 = planes.green1 ?? green0;

  const W = w * 2;
  const H = h * 2;

  const gain = opts.whiteGain;
  const gr = gain ? gain[0] : 1;
  const gg = gain ? gain[1] : 1;
  const gb = gain ? gain[2] : 1;

  // GRBG mosaic accessor with edge clamping.
  //   (even X, even Y) = G (green0)   (odd X, even Y) = R (red)
  //   (even X, odd  Y) = B (blue)     (odd X, odd  Y) = G (green1)
  const m = (X: number, Y: number): number => {
    const cx = X < 0 ? 0 : X >= W ? W - 1 : X;
    const cy = Y < 0 ? 0 : Y >= H ? H - 1 : Y;
    const px = cx >> 1;
    const py = cy >> 1;
    const idx = py * w + px;
    const oddX = cx & 1;
    const oddY = cy & 1;
    if (!oddX && !oddY) return green0[idx]!; // G (top-left)
    if (oddX && !oddY) return red[idx]!; // R
    if (!oddX && oddY) return blue[idx]!; // B
    return green1[idx]!; // G (bottom-right)
  };

  const out = new Uint8Array(W * H * 3);

  for (let Y = 0; Y < H; Y++) {
    const oddY = Y & 1;
    for (let X = 0; X < W; X++) {
      const oddX = X & 1;
      const o = (Y * W + X) * 3;
      let rv: number;
      let gv: number;
      let bv: number;

      if (!oddX && !oddY) {
        // G site on GR row: horizontal neighbours R, vertical B
        gv = m(X, Y);
        rv = (m(X - 1, Y) + m(X + 1, Y)) / 2;
        bv = (m(X, Y - 1) + m(X, Y + 1)) / 2;
      } else if (oddX && !oddY) {
        // R site
        rv = m(X, Y);
        gv = (m(X - 1, Y) + m(X + 1, Y) + m(X, Y - 1) + m(X, Y + 1)) / 4;
        bv = (m(X - 1, Y - 1) + m(X + 1, Y - 1) + m(X - 1, Y + 1) + m(X + 1, Y + 1)) / 4;
      } else if (!oddX && oddY) {
        // B site
        bv = m(X, Y);
        gv = (m(X - 1, Y) + m(X + 1, Y) + m(X, Y - 1) + m(X, Y + 1)) / 4;
        rv = (m(X - 1, Y - 1) + m(X + 1, Y - 1) + m(X - 1, Y + 1) + m(X + 1, Y + 1)) / 4;
      } else {
        // G site on BG row: horizontal neighbours B, vertical R
        gv = m(X, Y);
        bv = (m(X - 1, Y) + m(X + 1, Y)) / 2;
        rv = (m(X, Y - 1) + m(X, Y + 1)) / 2;
      }

      // Planes are already display-referred: optional residual gain, then emit.
      let rr = rv * gr + 0.5;
      let gg2 = gv * gg + 0.5;
      let bb = bv * gb + 0.5;
      rr = rr < 0 ? 0 : rr > 255 ? 255 : rr;
      gg2 = gg2 < 0 ? 0 : gg2 > 255 ? 255 : gg2;
      bb = bb < 0 ? 0 : bb > 255 ? 255 : bb;

      out[o] = rr | 0;
      out[o + 1] = gg2 | 0;
      out[o + 2] = bb | 0;
    }
  }

  if (opts.finish) finishImage(out, W, H);

  return { rgb: out, width: W, height: H };
}

export function findChannelFilenames(filenames: string[]): {
  red?: string;
  green0?: string;
  green1?: string;
  blue?: string;
} {
  const find = (tag: string) => filenames.find((f) => f.includes(tag));
  return {
    red: find("_red"),
    green0: find("_green0"),
    green1: find("_green1"),
    blue: find("_blue"),
  };
}

export function hasBayerChannels(filenames: string[]): boolean {
  const ch = findChannelFilenames(filenames);
  return Boolean(ch.red && ch.green0 && ch.blue);
}
