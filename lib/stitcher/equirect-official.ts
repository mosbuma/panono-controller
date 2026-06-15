// Pure JS/sharp port of the official PanonoUPFConverter preview stitch
// (Stitching::PanoramaStitcher::composeEquirectangularImage). See
// docs/reference/stitching-insights.md for the reverse-engineered spec.
//
// Algorithm:
//   - equirect dir  d = (sin f cos t, cos f, sin f sin t),
//                   t = px * 2PI/(W-1),  f = py * PI/(H-1)   (+Y pole = top row)
//   - per camera     A = R_cam * G^T   (G = gravity correction)  ;  c = A . d
//   - project        u = fx*cx/cz + px0,  v = fy*cy/cz + py0      (cz > 0)
//   - label (seam)   choose the camera whose (u,v) is closest to its principal
//                    point and inside the image (hard, single-source)
//   - sample         bicubic (Catmull-Rom)
//
// The label decision and the sample use the same projection, so we fuse both
// passes into one (equivalent to the binary's composeLabelMap + compose without
// the optional label-map smoothing).

import sharp from "sharp";
import { gravityCorrectionMatrix, mat3Mul, type Mat3, type Vec3 } from "@/lib/stitcher/gravity";
import type { CameraImage, StitchContext } from "@/lib/stitcher/projection";
import { vignettingGain } from "@/lib/stitcher/vignetting";

export interface EquirectOptions {
  /** Border margin (pixels) excluded from each camera's usable region. */
  margin?: number;
  /** Background colour for uncovered pixels. */
  background?: [number, number, number];
  /** Interpolation kernel. */
  interpolation?: "bicubic" | "bilinear";
  /**
   * Apply accelerometer-based horizon (gravity) correction on top of the
   * calibration. The manifest rotation matrices already encode the capture pose
   * (level horizon), so this is off by default; enabling it double-corrects and
   * tilts the result.
   */
  useGravity?: boolean;
  /** Apply radial vignetting gain at sample time. Default false. */
  applyVignetting?: boolean;
  /**
   * Apply content-based per-camera exposure/white-balance normalization
   * (`computeExposureGains`). The shipped planes are already consistently
   * exposed and white-balanced per camera, so this content-driven per-channel
   * gain only introduces brightness steps and coloured seams that the official
   * converter does not have. Off by default.
   */
  applyExposure?: boolean;
  /**
   * Mirror the output horizontally. The default azimuth mapping already yields a
   * correctly-oriented (non-mirrored) equirect, so this is off by default and
   * only exposed for convention overrides.
   */
  flipOutput?: boolean;
}

interface PreparedCamera {
  img: CameraImage;
  /** A = R_cam * G^T, so c = A . d maps the panorama direction into the camera. */
  a: Mat3;
  fx: number;
  fy: number;
  px0: number;
  py0: number;
  w: number;
  h: number;
}

const DEFAULT_BG: [number, number, number] = [12, 14, 20];

function transpose3(m: Mat3): Mat3 {
  return [
    [m[0]![0]!, m[1]![0]!, m[2]![0]!],
    [m[0]![1]!, m[1]![1]!, m[2]![1]!],
    [m[0]![2]!, m[1]![2]!, m[2]![2]!],
  ];
}

function prepareCameras(images: CameraImage[], g: Mat3): PreparedCamera[] {
  const gT = transpose3(g);
  return images.map((img) => {
    const R = img.cam.rotationMatrix as Mat3;
    const K = img.cam.intrinsicMatrix as Mat3;
    // c = R_cam . (G^T d): rotate the sampling direction by inverse gravity,
    // then world->camera. (Eigen stores the binary's InfoStruct matrix
    // column-major, so its M^T read-back is the plain rotation applied here.)
    const a = mat3Mul(R, gT);
    return {
      img,
      a,
      fx: K[0]![0]!,
      fy: K[1]![1]!,
      px0: K[0]![2]!,
      py0: K[1]![2]!,
      w: img.width,
      h: img.height,
    };
  });
}

function cubicWeight(t: number): [number, number, number, number] {
  // Catmull-Rom (a = -0.5)
  const t2 = t * t;
  const t3 = t2 * t;
  return [
    -0.5 * t3 + t2 - 0.5 * t,
    1.5 * t3 - 2.5 * t2 + 1,
    -1.5 * t3 + 2 * t2 + 0.5 * t,
    -0.5 * t3 + 0.5 * t2,
  ];
}

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function sampleBicubic(
  rgb: Uint8Array,
  W: number,
  H: number,
  u: number,
  v: number,
  out: [number, number, number]
): void {
  const x = Math.floor(u);
  const y = Math.floor(v);
  const wx = cubicWeight(u - x);
  const wy = cubicWeight(v - y);
  let r = 0;
  let g = 0;
  let b = 0;
  for (let j = 0; j < 4; j++) {
    const sy = clampInt(y - 1 + j, 0, H - 1);
    const wyj = wy[j]!;
    let rr = 0;
    let gg = 0;
    let bb = 0;
    for (let i = 0; i < 4; i++) {
      const sx = clampInt(x - 1 + i, 0, W - 1);
      const o = (sy * W + sx) * 3;
      const wxi = wx[i]!;
      rr += rgb[o]! * wxi;
      gg += rgb[o + 1]! * wxi;
      bb += rgb[o + 2]! * wxi;
    }
    r += rr * wyj;
    g += gg * wyj;
    b += bb * wyj;
  }
  out[0] = r;
  out[1] = g;
  out[2] = b;
}

function sampleBilinear(
  rgb: Uint8Array,
  W: number,
  H: number,
  u: number,
  v: number,
  out: [number, number, number]
): void {
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const x1 = clampInt(x0 + 1, 0, W - 1);
  const y1 = clampInt(y0 + 1, 0, H - 1);
  const cx0 = clampInt(x0, 0, W - 1);
  const cy0 = clampInt(y0, 0, H - 1);
  const tx = u - x0;
  const ty = v - y0;
  const o00 = (cy0 * W + cx0) * 3;
  const o10 = (cy0 * W + x1) * 3;
  const o01 = (y1 * W + cx0) * 3;
  const o11 = (y1 * W + x1) * 3;
  for (let c = 0; c < 3; c++) {
    const a = rgb[o00 + c]! + (rgb[o10 + c]! - rgb[o00 + c]!) * tx;
    const b = rgb[o01 + c]! + (rgb[o11 + c]! - rgb[o01 + c]!) * tx;
    out[c] = a + (b - a) * ty;
  }
}

/**
 * Stitch into an equirectangular RGB buffer (width x height x 3) using the
 * official label-map / hard-seam algorithm.
 */
export function stitchEquirectRgb(
  images: CameraImage[],
  ctx: StitchContext,
  width: number,
  height: number,
  gravity: Vec3 | null,
  opts: EquirectOptions = {}
): Buffer {
  const margin = opts.margin ?? 0;
  const bg = opts.background ?? DEFAULT_BG;
  const bicubic = (opts.interpolation ?? "bicubic") === "bicubic";
  const useGravity = opts.useGravity ?? false;
  const applyVignetting = opts.applyVignetting ?? false;
  const applyExposure = opts.applyExposure ?? false;
  const flipOutput = opts.flipOutput ?? false;
  const G = gravityCorrectionMatrix(useGravity ? gravity : null);
  const cams = prepareCameras(images, G);

  const out = Buffer.alloc(width * height * 3);
  const sample: [number, number, number] = [0, 0, 0];

  const lonStep = (2 * Math.PI) / (width - 1);
  const latStep = Math.PI / (height - 1);

  for (let py = 0; py < height; py++) {
    const phi = py * latStep;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    const rowOff = py * width * 3;

    for (let px = 0; px < width; px++) {
      const outX = flipOutput ? width - 1 - px : px;
      const theta = outX * lonStep;
      const dx = sinPhi * Math.cos(theta);
      const dy = cosPhi;
      const dz = sinPhi * Math.sin(theta);

      let bestDist2 = Infinity;
      let bestCam = -1;
      let bestU = 0;
      let bestV = 0;

      for (let ci = 0; ci < cams.length; ci++) {
        const cam = cams[ci]!;
        const a = cam.a;
        const cz = a[2]![0]! * dx + a[2]![1]! * dy + a[2]![2]! * dz;
        if (cz <= 0) continue;
        const cx = a[0]![0]! * dx + a[0]![1]! * dy + a[0]![2]! * dz;
        const cy = a[1]![0]! * dx + a[1]![1]! * dy + a[1]![2]! * dz;
        const u = (cam.fx * cx) / cz + cam.px0;
        const v = (cam.fy * cy) / cz + cam.py0;
        if (u < margin || v < margin || u > cam.w - 1 - margin || v > cam.h - 1 - margin) {
          continue;
        }
        const du = u - cam.px0;
        const dv = v - cam.py0;
        const dist2 = du * du + dv * dv;
        if (dist2 < bestDist2) {
          bestDist2 = dist2;
          bestCam = ci;
          bestU = u;
          bestV = v;
        }
      }

      const o = rowOff + px * 3;
      if (bestCam < 0) {
        out[o] = bg[0];
        out[o + 1] = bg[1];
        out[o + 2] = bg[2];
        continue;
      }

      const cam = cams[bestCam]!;
      const rgb = cam.img.rgb;
      if (bicubic) {
        sampleBicubic(rgb, cam.w, cam.h, bestU, bestV, sample);
      } else {
        sampleBilinear(rgb, cam.w, cam.h, bestU, bestV, sample);
      }

      let r = sample[0];
      let g = sample[1];
      let b = sample[2];

      if (applyVignetting && ctx.vignetting) {
        const [vgR, vgG, vgB] = vignettingGain(
          ctx.vignetting,
          bestU,
          bestV,
          cam.px0,
          cam.py0,
          cam.w,
          cam.h
        );
        r *= vgR;
        g *= vgG;
        b *= vgB;
      }
      if (applyExposure) {
        const exp = ctx.exposure[bestCam];
        if (exp) {
          r *= exp.r;
          g *= exp.g;
          b *= exp.b;
        }
      }

      out[o] = r < 0 ? 0 : r > 255 ? 255 : Math.round(r);
      out[o + 1] = g < 0 ? 0 : g > 255 ? 255 : Math.round(g);
      out[o + 2] = b < 0 ? 0 : b > 255 ? 255 : Math.round(b);
    }
  }

  return out;
}

/** Stitch and JPEG-encode. */
export async function stitchEquirectJpeg(
  images: CameraImage[],
  ctx: StitchContext,
  width: number,
  height: number,
  gravity: Vec3 | null,
  quality: number,
  opts: EquirectOptions = {}
): Promise<Buffer> {
  const raw = stitchEquirectRgb(images, ctx, width, height, gravity, opts);
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
}
