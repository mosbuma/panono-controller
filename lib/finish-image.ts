/**
 * Post-demosaic finishing that approximates the official Panono converter's
 * `ImageAdjustment::imageImprovement` chain (reverse-engineered from the
 * binary; see docs/reference/CONVERTER.md).
 *
 * The official order is:
 *   decode(γ2.4) → denoise → localContrast → sharpen → encode(sRGB)+WB → autoContrast
 * with recovered parameters (at 2064px width):
 *   localContrast(radius = max(10, w/2064·150), amount 0.1)
 *   sharpen(radius = max(1, w/2064·3), amount 0.9, threshold 1024/16-bit)
 *
 * We reproduce the two perceptually dominant unsharp-mask steps — **local
 * contrast** and **unsharp sharpen** (`out = in + amount·(in − blur(in))`) —
 * plus a faithful port of the converter's adaptive **`autoContrast`** (exact
 * histogram + expf black-point operator, reverse-engineered from
 * `ImageLib::Contrast::autoContrast_internal<uchar,3>`; see
 * docs/reference/CONVERTER.md §4b). We still omit `denoise` (NL-means-ish).
 *
 * Pure JS (typed arrays) so it runs identically in Node and the browser.
 */

export interface FinishOptions {
  /** Local-contrast (large-radius unsharp) amount. Default 0.1. */
  localContrastAmount?: number;
  /** Sharpen (small-radius unsharp) amount. Default 0.9. */
  sharpenAmount?: number;
  /** Sharpen threshold in 8-bit levels (skip tiny differences). Default 4. */
  sharpenThreshold?: number;
  /** Reference width the radii are defined at. Default 2064. */
  referenceWidth?: number;
  /** Run the adaptive autoContrast black-point pass. Default true. */
  autoContrast?: boolean;
  /** autoContrast low/high clip fractions. Default 0.01 each (official). */
  autoContrastClipLow?: number;
  autoContrastClipHigh?: number;
  /** autoContrast exponent weight k (official arg = 16). */
  autoContrastK?: number;
}

/** In-place separable box blur (one pass) on a single channel plane. */
function boxBlurPass(
  src: Float32Array,
  dst: Float32Array,
  width: number,
  height: number,
  radius: number
): void {
  const r = radius;
  const norm = 1 / (2 * r + 1);
  // Horizontal.
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let acc = 0;
    for (let i = -r; i <= r; i++) {
      const x = i < 0 ? 0 : i >= width ? width - 1 : i;
      acc += src[row + x]!;
    }
    for (let x = 0; x < width; x++) {
      dst[row + x] = acc * norm;
      const xOut = x - r;
      const xIn = x + r + 1;
      const ai = xIn >= width ? width - 1 : xIn;
      const ao = xOut < 0 ? 0 : xOut;
      acc += src[row + ai]! - src[row + ao]!;
    }
  }
  // Vertical (read dst, write src as scratch then swap by copying back).
  for (let x = 0; x < width; x++) {
    let acc = 0;
    for (let i = -r; i <= r; i++) {
      const y = i < 0 ? 0 : i >= height ? height - 1 : i;
      acc += dst[y * width + x]!;
    }
    for (let y = 0; y < height; y++) {
      src[y * width + x] = acc * norm;
      const yOut = y - r;
      const yIn = y + r + 1;
      const ai = yIn >= height ? height - 1 : yIn;
      const ao = yOut < 0 ? 0 : yOut;
      acc += dst[ai * width + x]! - dst[ao * width + x]!;
    }
  }
}

/** Approximate a Gaussian blur of the given radius with 3 box-blur passes. */
function gaussianApprox(
  plane: Float32Array,
  width: number,
  height: number,
  radius: number
): Float32Array {
  const r = Math.max(1, Math.round(radius / 3));
  const scratch = new Float32Array(plane.length);
  // src=plane is mutated in place by each pass (vertical writes back to src).
  for (let p = 0; p < 3; p++) boxBlurPass(plane, scratch, width, height, r);
  return plane;
}

/** Unsharp mask in place on interleaved RGB: out = in + amount·(in − blur). */
function unsharp(
  rgb: Uint8Array,
  width: number,
  height: number,
  radius: number,
  amount: number,
  threshold: number
): void {
  const n = width * height;
  for (let c = 0; c < 3; c++) {
    const plane = new Float32Array(n);
    for (let i = 0; i < n; i++) plane[i] = rgb[i * 3 + c]!;
    const orig = Float32Array.from(plane);
    const blur = gaussianApprox(plane, width, height, radius);
    for (let i = 0; i < n; i++) {
      const o = orig[i]!;
      const diff = o - blur[i]!;
      if (diff <= threshold && diff >= -threshold) continue;
      let v = o + amount * diff;
      v = v < 0 ? 0 : v > 255 ? 255 : v;
      rgb[i * 3 + c] = (v + 0.5) | 0;
    }
  }
}

/**
 * Adaptive auto-contrast, an exact port of the official converter's
 * `Contrast::autoContrast_internal<uchar,3>` (binary 0x47c110).
 *
 * Builds per-pixel min- and max-channel histograms, finds the `clipLow` dark
 * point `lo` and `clipHigh` bright point `hi`, then applies a single global
 * affine to every channel:
 *
 *   span   = max(hi - lo, 1)
 *   weight = exp(-k · (lo/span)²)          // k = 16; damps the lift when the
 *   offset = lo · weight                   //   black point is high vs. range
 *   scale  = (255 - offset) ≥ 1 ? 255/(255 - offset) : 255
 *   out    = round((v - offset) · scale)   // clamped to [0, 255]
 *
 * It is a black-point removal with adaptive strength (scale ≥ 1, white point
 * fixed at 255); it never reduces contrast.
 */
export function autoContrast(
  rgb: Uint8Array,
  width: number,
  height: number,
  clipLow = 0.01,
  clipHigh = 0.01,
  k = 16
): void {
  const n = width * height;
  if (n === 0) return;

  const histMin = new Int32Array(256);
  const histMax = new Int32Array(256);
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    const r = rgb[o]!;
    const g = rgb[o + 1]!;
    const b = rgb[o + 2]!;
    const mn = r < g ? (r < b ? r : b) : g < b ? g : b;
    const mx = r > g ? (r > b ? r : b) : g > b ? g : b;
    histMin[mn]!++;
    histMax[mx]!++;
  }

  const loCount = Math.trunc(clipLow * n);
  const hiCount = Math.trunc(clipHigh * n);

  let cum = 0;
  let lo = 0;
  for (let i = 0; i < 256; i++) {
    cum += histMin[i]!;
    lo = i;
    if (cum >= loCount) break;
  }
  cum = 0;
  let hi = 0;
  for (let i = 255; i >= 0; i--) {
    cum += histMax[i]!;
    hi = i;
    if (cum >= hiCount) break;
  }

  const span = Math.max(hi - lo, 1);
  const ratio = lo / span;
  const weight = Math.exp(-k * ratio * ratio);
  const offset = lo * weight;
  const denom = 255 - offset;
  const scale = denom >= 1 ? 255 / denom : 255;

  if (offset === 0 && scale === 1) return;

  for (let i = 0; i < n * 3; i++) {
    let v = (rgb[i]! - offset) * scale + 0.5;
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    rgb[i] = v | 0;
  }
}

/**
 * Apply the finishing chain in place to an interleaved 8-bit RGB buffer.
 */
export function finishImage(
  rgb: Uint8Array,
  width: number,
  height: number,
  opts: FinishOptions = {}
): void {
  const refW = opts.referenceWidth ?? 2064;
  const scale = width / refW;
  const lcAmount = opts.localContrastAmount ?? 0.1;
  const shAmount = opts.sharpenAmount ?? 0.9;
  const shThreshold = opts.sharpenThreshold ?? 4;

  const lcRadius = Math.max(10, Math.round(scale * 150));
  const shRadius = Math.max(1, Math.round(scale * 3));

  // Local contrast (large radius), then sharpen (small radius).
  unsharp(rgb, width, height, lcRadius, lcAmount, 0);
  unsharp(rgb, width, height, shRadius, shAmount, shThreshold);

  // Adaptive black-point auto-contrast (official final step).
  if (opts.autoContrast !== false) {
    autoContrast(
      rgb,
      width,
      height,
      opts.autoContrastClipLow ?? 0.01,
      opts.autoContrastClipHigh ?? 0.01,
      opts.autoContrastK ?? 16
    );
  }
}
