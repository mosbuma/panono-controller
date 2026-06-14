/**
 * Reconstruct full-resolution sRGB from Panono full-UPF channel JPEGs,
 * reproducing the official Panono UPF Converter (v1.1.0) colour pipeline.
 *
 * Verified against the official converter's per-camera output using the
 * reference demo set (`reference/demo-image`). Per camera the pipeline is:
 *   1. Recombine the four half-res channel JPEGs (_red, _green0, _green1,
 *      _blue) into the full Bayer mosaic and bilinear-demosaic it. The
 *      `imageFormat` is `RAW_GR_8bit_...` => the mosaic is GRBG:
 *        (2x,   2y  ) = G (green0)   (2x+1, 2y  ) = R (red)
 *        (2x,   2y+1) = B (blue)     (2x+1, 2y+1) = G (green1)
 *   2. Linearise: subtract the per-camera `blackLevel` and normalise by
 *      (255 - blackLevel), clamped to >= 0.
 *   3. Apply the per-camera 3x3 `colorMatrix` (rows sum to 1, neutral-
 *      preserving) to the linear RGB.
 *   4. Clamp to [0, 1] and apply the standard sRGB transfer function (OETF):
 *        out = v <= 0.0031308 ? 12.92*v : 1.055*v^(1/2.4) - 0.055
 *
 * Note: the channel planes are already white-balanced by the camera, so the
 * manifest `whiteBalance` gains must NOT be re-applied (doing so over-corrects
 * red/blue and produces a magenta/pink cast).
 */

const SRGB_THRESHOLD = 0.0031308;
const SRGB_LINEAR_SCALE = 12.92;
const SRGB_ALPHA = 1.055;
const SRGB_OFFSET = 0.055;
const SRGB_GAMMA = 2.4;

const SRGB_LUT_SIZE = 4096;

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
  /** Per-camera black level (sensor pedestal) from the manifest. Default 0. */
  blackLevel?: number;
  /**
   * Per-camera 3x3 colour-correction matrix from the manifest, applied to the
   * linear RGB. When omitted, no colour correction is applied (identity).
   */
  colorMatrix?: number[][];
}

export interface DemosaicResult {
  /** Interleaved sRGB, length = width * height * 3. */
  rgb: Uint8Array;
  /** Full image width (2 * plane width). */
  width: number;
  /** Full image height (2 * plane height). */
  height: number;
}

function srgbEncode(v01: number): number {
  const v = v01 < 0 ? 0 : v01 > 1 ? 1 : v01;
  if (v <= SRGB_THRESHOLD) return SRGB_LINEAR_SCALE * v;
  return SRGB_ALPHA * Math.pow(v, 1 / SRGB_GAMMA) - SRGB_OFFSET;
}

/** Fine LUT mapping linear [0,1] -> sRGB-encoded 8-bit. */
function buildSrgbLut(): Uint8Array {
  const lut = new Uint8Array(SRGB_LUT_SIZE);
  for (let i = 0; i < SRGB_LUT_SIZE; i++) {
    const out = srgbEncode(i / (SRGB_LUT_SIZE - 1)) * 255 + 0.5;
    lut[i] = out > 255 ? 255 : out < 0 ? 0 : out;
  }
  return lut;
}

/** LUT: raw 8-bit -> linearised value in [0,1] after black-level subtraction. */
function buildLinearLut(blackLevel: number): Float32Array {
  const bl = blackLevel > 0 && blackLevel < 255 ? blackLevel : 0;
  const scale = 255 - bl;
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const v = (i - bl) / scale;
    lut[i] = v < 0 ? 0 : v;
  }
  return lut;
}

const SRGB_LUT = buildSrgbLut();

/**
 * Recombine the half-res GRBG planes into the full mosaic, bilinear-demosaic,
 * linearise (black level), apply the colour matrix and sRGB encoding. Output is
 * 2x the plane dimensions.
 */
export function demosaicBayerPlanes(
  planes: BayerPlanes,
  opts: DemosaicOptions = {}
): DemosaicResult {
  const { red, green0, blue, width: w, height: h } = planes;
  const green1 = planes.green1 ?? green0;

  const linLut = buildLinearLut(opts.blackLevel ?? 0);

  // Colour-correction matrix (row-major). Identity when absent.
  const cm = opts.colorMatrix;
  const m00 = cm?.[0]?.[0] ?? 1, m01 = cm?.[0]?.[1] ?? 0, m02 = cm?.[0]?.[2] ?? 0;
  const m10 = cm?.[1]?.[0] ?? 0, m11 = cm?.[1]?.[1] ?? 1, m12 = cm?.[1]?.[2] ?? 0;
  const m20 = cm?.[2]?.[0] ?? 0, m21 = cm?.[2]?.[1] ?? 0, m22 = cm?.[2]?.[2] ?? 1;

  const W = w * 2;
  const H = h * 2;

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
  const maxIdx = SRGB_LUT_SIZE - 1;

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

      // Linearise (black level + normalise).
      const lr = linLut[Math.round(rv)]!;
      const lg = linLut[Math.round(gv)]!;
      const lb = linLut[Math.round(bv)]!;

      // Colour-correction matrix.
      let cr = m00 * lr + m01 * lg + m02 * lb;
      let cg = m10 * lr + m11 * lg + m12 * lb;
      let cb = m20 * lr + m21 * lg + m22 * lb;

      // Clamp to [0,1] and sRGB-encode via LUT.
      cr = cr < 0 ? 0 : cr > 1 ? 1 : cr;
      cg = cg < 0 ? 0 : cg > 1 ? 1 : cg;
      cb = cb < 0 ? 0 : cb > 1 ? 1 : cb;

      out[o] = SRGB_LUT[(cr * maxIdx) | 0]!;
      out[o + 1] = SRGB_LUT[(cg * maxIdx) | 0]!;
      out[o + 2] = SRGB_LUT[(cb * maxIdx) | 0]!;
    }
  }

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
