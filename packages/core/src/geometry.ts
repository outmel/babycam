import type { Box, Point } from './types';

export function iou(a: Box, b: Box): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union <= 0 ? 0 : inter / union;
}

export function center(b: Box): Point {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/** Ray-casting point-in-polygon test. */
export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Fraction of a 5x5 grid of sample points inside the box that also fall inside the polygon. */
export function fractionInside(box: Box, poly: Point[]): number {
  const n = 5;
  let hits = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const p = { x: box.x + ((i + 0.5) / n) * box.w, y: box.y + ((j + 0.5) / n) * box.h };
      if (pointInPolygon(p, poly)) hits++;
    }
  }
  return hits / (n * n);
}

/** Distance between the closest edges of two boxes (0 when they overlap). */
export function boxGap(a: Box, b: Box): number {
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w));
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));
  return Math.hypot(dx, dy);
}

export function clampBox(b: Box): Box {
  const x = Math.min(Math.max(b.x, 0), 1);
  const y = Math.min(Math.max(b.y, 0), 1);
  return { x, y, w: Math.max(0, Math.min(b.w, 1 - x)), h: Math.max(0, Math.min(b.h, 1 - y)) };
}
