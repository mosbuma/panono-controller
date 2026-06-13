/**
 * Asymmetric bidirectional novel-view blending (MungoMeng/SC-AOF).
 */
import type { FlowField } from "@/lib/stitcher/opticalflow/flow-lite";
import { createRgba, type RgbaImage } from "@/lib/stitcher/opticalflow/rgba-image";

const K_COLOR_DIFF = 10;
const K_SOFTMAX = 10;
const K_FLOW_MAG = 100;

export function combineNovelViews(
  imageL: RgbaImage,
  imageR: RgbaImage,
  flowLtoR: FlowField,
  flowRtoL: FlowField,
  blend: Float32Array
): RgbaImage {
  const { width, height } = imageL;
  const out = createRgba(width, height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const o = i * 4;
      const blendR = blend[i]!;
      const blendL = 1 - blendR;

      const colorL = sampleNovelPoint(imageL, flowRtoL, blendR, x, y, width);
      const colorR = sampleNovelPoint(imageR, flowLtoR, blendL, x, y, width);

      if (colorL[3] === 0 || colorR[3] === 0) {
        out.data[o + 3] = 0;
        continue;
      }

      const fLtoR = flowAt(flowLtoR, width, x, y);
      const fRtoL = flowAt(flowRtoL, width, x, y);
      const flowMagLR = Math.hypot(fLtoR[0], fLtoR[1]) / width;
      const flowMagRL = Math.hypot(fRtoL[0], fRtoL[1]) / width;

      const colorDiff =
        (Math.abs(colorL[0] - colorR[0]) +
          Math.abs(colorL[1] - colorR[1]) +
          Math.abs(colorL[2] - colorR[2])) /
        255;
      const deghost = Math.tanh(colorDiff * K_COLOR_DIFF);

      const alphaL = colorL[3] / 255;
      const alphaR = colorR[3] / 255;
      const expL = Math.exp(K_SOFTMAX * blendL * alphaL * (1 + K_FLOW_MAG * flowMagRL));
      const expR = Math.exp(K_SOFTMAX * blendR * alphaR * (1 + K_FLOW_MAG * flowMagLR));
      const sumExp = expL + expR + 1e-5;
      const softmaxL = expL / sumExp;
      const softmaxR = expR / sumExp;

      out.data[o] = Math.round(
        colorL[0] * lerp(blendL, softmaxL, deghost) + colorR[0] * lerp(blendR, softmaxR, deghost)
      );
      out.data[o + 1] = Math.round(
        colorL[1] * lerp(blendL, softmaxL, deghost) + colorR[1] * lerp(blendR, softmaxR, deghost)
      );
      out.data[o + 2] = Math.round(
        colorL[2] * lerp(blendL, softmaxL, deghost) + colorR[2] * lerp(blendR, softmaxR, deghost)
      );
      out.data[o + 3] = 255;
    }
  }
  return out;
}

function sampleNovelPoint(
  src: RgbaImage,
  flow: FlowField,
  t: number,
  x: number,
  y: number,
  width: number
): [number, number, number, number] {
  const f = flowAt(flow, width, x, y);
  let sx = Math.round(x + f[0] * t);
  let sy = Math.round(y + f[1] * t);
  if (sx >= src.width) sx -= src.width;
  if (sx < 0) sx += src.width;
  sy = Math.max(0, Math.min(src.height - 1, sy));
  const o = (sy * src.width + sx) * 4;
  return [src.data[o]!, src.data[o + 1]!, src.data[o + 2]!, src.data[o + 3]!];
}

function flowAt(flow: FlowField, width: number, x: number, y: number): [number, number] {
  const o = (y * width + x) * 2;
  return [flow[o] ?? 0, flow[o + 1] ?? 0];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
