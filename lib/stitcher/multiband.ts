/** Laplacian-pyramid multiband blending (Burt–Adelson style). */

export interface PyramidLevelSize {
  width: number;
  height: number;
}

export function pyramidLevelCount(width: number, height: number): number {
  const minDim = Math.min(width, height);
  return Math.max(2, Math.min(6, Math.floor(Math.log2(minDim)) - 3));
}

export function pyramidSizes(width: number, height: number, levels: number): PyramidLevelSize[] {
  const sizes: PyramidLevelSize[] = [{ width, height }];
  let w = width;
  let h = height;
  for (let i = 1; i < levels; i++) {
    w = Math.max(1, Math.floor(w / 2));
    h = Math.max(1, Math.floor(h / 2));
    sizes.push({ width: w, height: h });
  }
  return sizes;
}

function blurSeparable(src: Float32Array, width: number, height: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const k = [1, 4, 6, 4, 1];
  const norm = 16;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let i = -2; i <= 2; i++) {
        const sx = Math.max(0, Math.min(width - 1, x + i));
        sum += src[y * width + sx]! * k[i + 2]!;
      }
      tmp[y * width + x] = sum / norm;
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let j = -2; j <= 2; j++) {
        const sy = Math.max(0, Math.min(height - 1, y + j));
        sum += tmp[sy * width + x]! * k[j + 2]!;
      }
      out[y * width + x] = sum / norm;
    }
  }

  return out;
}

function downsampleHalf(src: Float32Array, width: number, height: number): Float32Array {
  const nw = Math.max(1, Math.floor(width / 2));
  const nh = Math.max(1, Math.floor(height / 2));
  const blurred = blurSeparable(src, width, height);
  const out = new Float32Array(nw * nh);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      out[y * nw + x] = blurred[(y * 2) * width + x * 2]!;
    }
  }
  return out;
}

function upsampleDouble(
  src: Float32Array,
  sw: number,
  sh: number,
  dw: number,
  dh: number
): Float32Array {
  const out = new Float32Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const sy = Math.min(sh - 1, Math.floor((y * sh) / dh));
      const sx = Math.min(sw - 1, Math.floor((x * sw) / dw));
      out[y * dw + x] = src[sy * sw + sx]!;
    }
  }
  return blurSeparable(out, dw, dh);
}

export function buildGaussianPyramid(
  src: Float32Array,
  sizes: PyramidLevelSize[]
): Float32Array[] {
  const levels: Float32Array[] = [src];
  let cur = src;
  for (let i = 1; i < sizes.length; i++) {
    const prev = sizes[i - 1]!;
    cur = downsampleHalf(cur, prev.width, prev.height);
    levels.push(cur);
  }
  return levels;
}

export function buildLaplacianPyramid(
  gaussian: Float32Array[],
  sizes: PyramidLevelSize[]
): Float32Array[] {
  const lap: Float32Array[] = [];
  for (let i = 0; i < gaussian.length - 1; i++) {
    const up = upsampleDouble(
      gaussian[i + 1]!,
      sizes[i + 1]!.width,
      sizes[i + 1]!.height,
      sizes[i]!.width,
      sizes[i]!.height
    );
    const cur = gaussian[i]!;
    const diff = new Float32Array(cur.length);
    for (let p = 0; p < cur.length; p++) {
      diff[p] = cur[p]! - up[p]!;
    }
    lap.push(diff);
  }
  lap.push(gaussian[gaussian.length - 1]!);
  return lap;
}

export function collapseLaplacianPyramid(
  lap: Float32Array[],
  sizes: PyramidLevelSize[]
): Float32Array {
  let cur = lap[lap.length - 1]!;
  for (let i = lap.length - 2; i >= 0; i--) {
    const up = upsampleDouble(
      cur,
      sizes[i + 1]!.width,
      sizes[i + 1]!.height,
      sizes[i]!.width,
      sizes[i]!.height
    );
    const next = new Float32Array(sizes[i]!.width * sizes[i]!.height);
    for (let p = 0; p < next.length; p++) {
      next[p] = up[p]! + lap[i]![p]!;
    }
    cur = next;
  }
  return cur;
}

export interface PyramidAccumulator {
  sizes: PyramidLevelSize[];
  r: Float32Array[];
  g: Float32Array[];
  b: Float32Array[];
  w: Float32Array[];
}

export function createPyramidAccumulator(sizes: PyramidLevelSize[]): PyramidAccumulator {
  const mk = () => sizes.map((s) => new Float32Array(s.width * s.height));
  return { sizes, r: mk(), g: mk(), b: mk(), w: mk() };
}

export function accumulateCameraPyramids(
  acc: PyramidAccumulator,
  lapR: Float32Array[],
  lapG: Float32Array[],
  lapB: Float32Array[],
  weightGauss: Float32Array[]
): void {
  for (let l = 0; l < acc.sizes.length; l++) {
    const wr = weightGauss[l]!;
    const ar = acc.r[l]!;
    const ag = acc.g[l]!;
    const ab = acc.b[l]!;
    const aw = acc.w[l]!;
    const lr = lapR[l]!;
    const lg = lapG[l]!;
    const lb = lapB[l]!;
    for (let i = 0; i < wr.length; i++) {
      const wt = wr[i]!;
      if (wt < 1e-6) continue;
      ar[i] += lr[i]! * wt;
      ag[i] += lg[i]! * wt;
      ab[i] += lb[i]! * wt;
      aw[i] += wt;
    }
  }
}

export function finalizePyramidAccumulator(acc: PyramidAccumulator): {
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
} {
  const norm = (levels: Float32Array[], weights: Float32Array[]): Float32Array[] =>
    levels.map((level, l) => {
      const w = weights[l]!;
      const out = new Float32Array(level.length);
      for (let i = 0; i < level.length; i++) {
        const wt = w[i]!;
        out[i] = wt > 1e-6 ? level[i]! / wt : 0;
      }
      return out;
    });

  const rLap = norm(acc.r, acc.w);
  const gLap = norm(acc.g, acc.w);
  const bLap = norm(acc.b, acc.w);

  return {
    r: collapseLaplacianPyramid(rLap, acc.sizes),
    g: collapseLaplacianPyramid(gLap, acc.sizes),
    b: collapseLaplacianPyramid(bLap, acc.sizes),
  };
}
