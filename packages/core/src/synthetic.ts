/**
 * Helpers for generating synthetic observations, used by the unit tests and by the harness's
 * built-in demo clips. Synthetic data checks the decision logic. It says nothing about model
 * accuracy, which is what real recorded traces are for.
 */
import type { Box, CameraMount, Landmark } from './types';

/** Small, fast, seedable PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(r: () => number): number {
  const u = Math.max(r(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

/** Body-frame landmark layout: [u along body head→feet, v lateral, + = person's left]. */
const CANONICAL: [number, number][] = [
  [0.08, 0], [0.06, 0.03], [0.06, 0.06], [0.06, 0.09], [0.06, -0.03], [0.06, -0.06], [0.06, -0.09],
  [0.07, 0.14], [0.07, -0.14], [0.11, 0.04], [0.11, -0.04],
  [0.25, 0.3], [0.25, -0.3], [0.4, 0.38], [0.4, -0.38], [0.52, 0.36], [0.52, -0.36],
  [0.56, 0.37], [0.56, -0.37], [0.56, 0.34], [0.56, -0.34], [0.54, 0.32], [0.54, -0.32],
  [0.6, 0.18], [0.6, -0.18], [0.78, 0.2], [0.78, -0.2], [0.93, 0.2], [0.93, -0.2],
  [0.96, 0.2], [0.96, -0.2], [0.98, 0.24], [0.98, -0.24],
];

const FACE = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

export type SyntheticPosture = 'back' | 'front' | 'upright';

export function syntheticPose(
  box: Box,
  posture: SyntheticPosture,
  mount: CameraMount,
  noise = 0,
  r: () => number = Math.random,
): Landmark[] {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  return CANONICAL.map(([u, v], i) => {
    let x: number;
    let y: number;
    if (mount === 'overhead') {
      const mirror = posture === 'front' ? -1 : 1;
      const uu = posture === 'upright' ? (u < 0.2 ? 0.35 + u : u <= 0.6 ? 0.45 + ((u - 0.25) * 0.1) / 0.35 : 0.6 + (u - 0.6) * 0.9) : u;
      x = cx + mirror * v * box.w;
      y = box.y + uu * box.h;
    } else if (posture === 'upright') {
      x = cx + v * box.w * 0.6;
      y = box.y + u * box.h;
    } else {
      x = box.x + u * box.w;
      y = cy + v * box.h * 0.4;
    }
    const vis = posture === 'front' && FACE.has(i) ? 0.15 : 0.95;
    return {
      x: x + gaussian(r) * noise * box.w,
      y: y + gaussian(r) * noise * box.h,
      v: Math.min(1, Math.max(0, vis + gaussian(r) * noise)),
    };
  });
}
