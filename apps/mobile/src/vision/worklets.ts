/**
 * Pixel and tensor helpers that run inside the VisionCamera frame-processor worklet.
 * Everything here works on the raw RGB(A) pixel buffer of an upright frame, and all output
 * coordinates are normalized to that frame (0..1), matching @lulu/core's conventions.
 */
import type { Detection, HealthSample, Landmark } from '@lulu/core';

export interface PixelView {
  px: Uint8Array;
  width: number;
  height: number;
  bytesPerRow: number;
  bytesPerPixel: number;
  rIndex: number;
  bIndex: number;
  mirrored: boolean;
}

export function makePixelView(
  buffer: ArrayBuffer,
  width: number,
  height: number,
  bytesPerRow: number,
  pixelFormat: string,
  mirrored: boolean,
): PixelView {
  'worklet';
  const bytesPerPixel = pixelFormat === 'rgb-rgb-8-bit' ? 3 : 4;
  const bgra = pixelFormat === 'rgb-bgra-8-bit';
  return {
    px: new Uint8Array(buffer),
    width,
    height,
    bytesPerRow: bytesPerRow || width * bytesPerPixel,
    bytesPerPixel,
    rIndex: bgra ? 2 : 0,
    bIndex: bgra ? 0 : 2,
    mirrored,
  };
}

export interface Letterbox {
  input: Float32Array | Uint8Array;
  scale: number;
  padX: number;
  padY: number;
}

/** Resize the whole frame into an S×S model input, keeping aspect ratio with gray padding. */
export function letterbox(v: PixelView, S: number, asUint8: boolean): Letterbox {
  'worklet';
  const input = asUint8 ? new Uint8Array(S * S * 3) : new Float32Array(S * S * 3);
  const k = asUint8 ? 1 : 1 / 255;
  const scale = Math.min(S / v.width, S / v.height);
  const padX = (S - v.width * scale) / 2;
  const padY = (S - v.height * scale) / 2;
  const pad = 114 * k;
  let o = 0;
  for (let y = 0; y < S; y++) {
    const sy = Math.floor((y - padY) / scale);
    const rowOk = sy >= 0 && sy < v.height;
    const row = sy * v.bytesPerRow;
    for (let x = 0; x < S; x++) {
      let sx = Math.floor((x - padX) / scale);
      if (rowOk && sx >= 0 && sx < v.width) {
        if (v.mirrored) sx = v.width - 1 - sx;
        const i = row + sx * v.bytesPerPixel;
        input[o] = v.px[i + v.rIndex] * k;
        input[o + 1] = v.px[i + 1] * k;
        input[o + 2] = v.px[i + v.bIndex] * k;
      } else {
        input[o] = pad;
        input[o + 1] = pad;
        input[o + 2] = pad;
      }
      o += 3;
    }
  }
  return { input, scale, padX, padY };
}

function iouXYXY(a: number[], b: number[]): number {
  'worklet';
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[2], b[2]);
  const y2 = Math.min(a[3], b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return union <= 0 ? 0 : inter / union;
}

/**
 * Decode a YOLO11 detection head ([1, 4+C, N] or [1, N, 4+C]) into frame-normalized boxes.
 * `minScore[cls]` gives the per-class threshold; classes without one are ignored. Person boxes
 * use a low threshold on purpose: ByteTrack's second pass uses the low-confidence boxes.
 */
export function decodeYolo(
  out: Float32Array,
  shape: number[],
  S: number,
  lb: Letterbox,
  frameW: number,
  frameH: number,
  minScore: Record<number, number>,
): Detection[] {
  'worklet';
  const channelsFirst = shape[1] < shape[2];
  const C = channelsFirst ? shape[1] : shape[2];
  const N = channelsFirst ? shape[2] : shape[1];
  const numClasses = C - 4;
  const at = (i: number, c: number) => (channelsFirst ? out[c * N + i] : out[i * C + c]);

  const cand: { b: number[]; score: number; cls: number }[] = [];
  let maxCoord = 0;
  for (let i = 0; i < N; i++) {
    let best = 0;
    let cls = -1;
    for (let c = 0; c < numClasses; c++) {
      const s = at(i, 4 + c);
      if (s > best) {
        best = s;
        cls = c;
      }
    }
    const thr = minScore[cls];
    if (thr === undefined || best < thr) continue;
    const cx = at(i, 0);
    const cy = at(i, 1);
    const w = at(i, 2);
    const h = at(i, 3);
    maxCoord = Math.max(maxCoord, cx, cy);
    cand.push({ b: [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], score: best, cls });
  }
  // TFLite exports from Ultralytics emit 0..1 coordinates; ONNX-converted ones emit pixels.
  const k = maxCoord <= 2 ? S : 1;
  cand.sort((a, b) => b.score - a.score);
  const kept: { b: number[]; score: number; cls: number }[] = [];
  for (const c of cand) {
    let overlap = false;
    for (const kk of kept) {
      if (kk.cls === c.cls && iouXYXY(kk.b, c.b) > 0.5) {
        overlap = true;
        break;
      }
    }
    if (!overlap) kept.push(c);
    if (kept.length >= 30) break;
  }
  const dets: Detection[] = [];
  for (const c of kept) {
    const x1 = Math.max(0, (c.b[0] * k - lb.padX) / lb.scale / frameW);
    const y1 = Math.max(0, (c.b[1] * k - lb.padY) / lb.scale / frameH);
    const x2 = Math.min(1, (c.b[2] * k - lb.padX) / lb.scale / frameW);
    const y2 = Math.min(1, (c.b[3] * k - lb.padY) / lb.scale / frameH);
    if (x2 <= x1 || y2 <= y1) continue;
    dets.push({ box: { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }, score: c.score, cls: c.cls });
  }
  return dets;
}

export interface Crop {
  input: Float32Array;
  x0: number;
  y0: number;
  size: number;
}

/** Square crop around a person box (with margin), resized to S×S floats in 0..1. */
export function cropForPose(v: PixelView, box: { x: number; y: number; w: number; h: number }, S: number): Crop {
  'worklet';
  const cx = (box.x + box.w / 2) * v.width;
  const cy = (box.y + box.h / 2) * v.height;
  const size = Math.max(box.w * v.width, box.h * v.height) * 1.25;
  const x0 = cx - size / 2;
  const y0 = cy - size / 2;
  const input = new Float32Array(S * S * 3);
  const step = size / S;
  let o = 0;
  for (let y = 0; y < S; y++) {
    const sy = Math.floor(y0 + y * step);
    const rowOk = sy >= 0 && sy < v.height;
    const row = sy * v.bytesPerRow;
    for (let x = 0; x < S; x++) {
      let sx = Math.floor(x0 + x * step);
      if (rowOk && sx >= 0 && sx < v.width) {
        if (v.mirrored) sx = v.width - 1 - sx;
        const i = row + sx * v.bytesPerPixel;
        input[o] = v.px[i + v.rIndex] / 255;
        input[o + 1] = v.px[i + 1] / 255;
        input[o + 2] = v.px[i + v.bIndex] / 255;
      }
      o += 3;
    }
  }
  return { input, x0, y0, size };
}

function sigmoid(x: number): number {
  'worklet';
  return 1 / (1 + Math.exp(-x));
}

/** MediaPipe pose landmark output (33 × [x, y, z, visibility, presence] in input pixels). */
export function decodePose(out: Float32Array, S: number, crop: Crop, frameW: number, frameH: number): Landmark[] {
  'worklet';
  const lms: Landmark[] = [];
  for (let k = 0; k < 33; k++) {
    const lx = out[k * 5] / S;
    const ly = out[k * 5 + 1] / S;
    lms.push({
      x: (crop.x0 + lx * crop.size) / frameW,
      y: (crop.y0 + ly * crop.size) / frameH,
      v: sigmoid(out[k * 5 + 3]),
    });
  }
  return lms;
}

export function poseScore(raw: number): number {
  'worklet';
  return raw >= 0 && raw <= 1 ? raw : sigmoid(raw);
}

/** Luminance mean/std and a 16×16 grayscale thumbnail for camera-health checks. */
export function lumaStats(v: PixelView): HealthSample {
  'worklet';
  const G = 16;
  const thumb: number[] = new Array(G * G);
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let gy = 0; gy < G; gy++) {
    for (let gx = 0; gx < G; gx++) {
      let cell = 0;
      for (let sy = 0; sy < 2; sy++) {
        for (let sx = 0; sx < 2; sx++) {
          const x = Math.floor(((gx + 0.25 + sx * 0.5) / G) * v.width);
          const y = Math.floor(((gy + 0.25 + sy * 0.5) / G) * v.height);
          const i = y * v.bytesPerRow + x * v.bytesPerPixel;
          const l = 0.299 * v.px[i + v.rIndex] + 0.587 * v.px[i + 1] + 0.114 * v.px[i + v.bIndex];
          cell += l;
          sum += l;
          sumSq += l * l;
          n++;
        }
      }
      thumb[gy * G + gx] = Math.round(cell / 4);
    }
  }
  const mean = sum / n;
  return { mean, std: Math.sqrt(Math.max(0, sumSq / n - mean * mean)), thumb };
}
