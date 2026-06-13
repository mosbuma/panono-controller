/** Radial R/G/B vignetting compensation from Panono UPF `vignetting_coeffs.txt`. */
export interface VignettingCoeffs {
  count: number;
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
}

export function parseVignettingCoeffs(text: string): VignettingCoeffs | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return null;

  const count = parseInt(lines[0]!, 10);
  if (!Number.isFinite(count) || count < 2) return null;

  const r = new Float32Array(count);
  const g = new Float32Array(count);
  const b = new Float32Array(count);
  let filled = 0;

  for (let i = 1; i < lines.length && filled < count; i++) {
    const parts = lines[i]!.split(/\s+/).map(Number);
    if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) continue;
    r[filled] = parts[0]!;
    g[filled] = parts[1]!;
    b[filled] = parts[2]!;
    filled++;
  }

  if (filled < count) return null;
  return { count, r, g, b };
}

/** Interpolated per-channel gain (≥1 toward edges); multiply sample RGB to compensate. */
export function vignettingGain(
  coeffs: VignettingCoeffs,
  u: number,
  v: number,
  px: number,
  py: number,
  width: number,
  height: number
): [number, number, number] {
  const dist = Math.hypot(u - px, v - py);
  const maxR = Math.max(
    Math.hypot(px, py),
    Math.hypot(width - 1 - px, py),
    Math.hypot(px, height - 1 - py),
    Math.hypot(width - 1 - px, height - 1 - py),
    1
  );
  const t = Math.min(1, dist / maxR) * (coeffs.count - 1);
  const i0 = Math.floor(t);
  const i1 = Math.min(coeffs.count - 1, i0 + 1);
  const f = t - i0;
  return [
    coeffs.r[i0]! + (coeffs.r[i1]! - coeffs.r[i0]!) * f,
    coeffs.g[i0]! + (coeffs.g[i1]! - coeffs.g[i0]!) * f,
    coeffs.b[i0]! + (coeffs.b[i1]! - coeffs.b[i0]!) * f,
  ];
}
