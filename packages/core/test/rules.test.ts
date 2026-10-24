import { describe, expect, it } from 'vitest';
import {
  classifyPosture,
  correlation,
  CryDetector,
  fractionInside,
  HealthMonitor,
  pointInPolygon,
  syntheticPose,
} from '../src';

const square = [
  { x: 0.2, y: 0.2 },
  { x: 0.8, y: 0.2 },
  { x: 0.8, y: 0.8 },
  { x: 0.2, y: 0.8 },
];

describe('geometry', () => {
  it('tests points against polygons', () => {
    expect(pointInPolygon({ x: 0.5, y: 0.5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 0.1, y: 0.5 }, square)).toBe(false);
  });
  it('measures how much of a box is inside a zone', () => {
    expect(fractionInside({ x: 0.3, y: 0.3, w: 0.2, h: 0.2 }, square)).toBe(1);
    expect(fractionInside({ x: 0.7, y: 0.3, w: 0.2, h: 0.2 }, square)).toBeCloseTo(0.6, 5);
    expect(fractionInside({ x: 0.85, y: 0.3, w: 0.1, h: 0.1 }, square)).toBe(0);
  });
});

describe('posture', () => {
  const lying = { x: 0.4, y: 0.3, w: 0.15, h: 0.3 };
  const sitting = { x: 0.4, y: 0.35, w: 0.2, h: 0.2 };
  it('classifies overhead postures', () => {
    expect(classifyPosture(syntheticPose(lying, 'back', 'overhead'), 'overhead').posture).toBe('lying_back');
    expect(classifyPosture(syntheticPose(lying, 'front', 'overhead'), 'overhead').posture).toBe('lying_front');
    expect(classifyPosture(syntheticPose(sitting, 'upright', 'overhead'), 'overhead').posture).toBe('upright');
  });
  it('classifies side-view postures', () => {
    expect(classifyPosture(syntheticPose({ x: 0.3, y: 0.5, w: 0.4, h: 0.15 }, 'back', 'side'), 'side').posture).toBe('lying_back');
    expect(classifyPosture(syntheticPose({ x: 0.4, y: 0.3, w: 0.15, h: 0.4 }, 'upright', 'side'), 'side').posture).toBe('upright');
  });
  it('returns unknown when the torso is hidden', () => {
    const lm = syntheticPose(lying, 'back', 'overhead').map((p, i) => (i >= 11 ? { ...p, v: 0.1 } : p));
    expect(classifyPosture(lm, 'overhead').posture).toBe('unknown');
  });
});

describe('CryDetector', () => {
  it('ignores isolated loud windows', () => {
    const c = new CryDetector();
    const events = [];
    for (let i = 0; i < 60; i++) events.push(...c.update({ t: i * 0.5, cry: i % 10 === 0 ? 0.9 : 0.05 }));
    expect(events).toEqual([]);
  });

  it('alerts once per episode, then reports the end', () => {
    const c = new CryDetector();
    const events = [];
    for (let i = 0; i < 200; i++) {
      const t = i * 0.5;
      const crying = t >= 10 && t < 60;
      events.push(...c.update({ t, cry: crying ? (i % 7 === 0 ? 0.2 : 0.8) : 0.02 }));
    }
    expect(events.map((e) => e.type)).toEqual(['cry_detected', 'cry_stopped']);
    expect(events[0].t).toBeLessThan(13);
    expect(events[1].data?.durationSec).toBeGreaterThan(45);
  });

  it('reminds parents while crying continues', () => {
    const c = new CryDetector({ remindEvery: 60 });
    const events = [];
    for (let i = 0; i < 300; i++) events.push(...c.update({ t: i * 0.5, cry: 0.9 }));
    expect(events.filter((e) => e.type === 'cry_detected').length).toBe(3);
  });
});

describe('HealthMonitor', () => {
  const thumb = (seed: number) => Array.from({ length: 256 }, (_, i) => 100 + 60 * Math.sin(i * 0.3 + seed));

  it('flags a covered lens after 5 s and recovery after', () => {
    const h = new HealthMonitor();
    const types: string[] = [];
    for (let i = 0; i < 100; i++) {
      const t = i * 0.5;
      const covered = t >= 10 && t < 30;
      types.push(...h.update(t, covered ? { mean: 8, std: 2 } : { mean: 110, std: 40, thumb: thumb(0) }, 0, 0).map((e) => e.type));
    }
    expect(types).toEqual(['camera_blocked', 'camera_ok']);
  });

  it('flags a camera that was bumped and now sees a different view', () => {
    const h = new HealthMonitor();
    const types: string[] = [];
    for (let i = 0; i < 40; i++) {
      const t = i * 0.5;
      const moved = t >= 10;
      types.push(...h.update(t, { mean: 110, std: 40, thumb: thumb(moved ? 2 : 0) }, t === 10 ? 0.4 : 0, 1).map((e) => e.type));
    }
    expect(types).toEqual(['camera_moved']);
  });

  it('does not call a person walking through a moved camera', () => {
    const h = new HealthMonitor();
    const types: string[] = [];
    for (let i = 0; i < 120; i++) {
      const t = i * 0.5;
      types.push(...h.update(t, { mean: 110, std: 40, thumb: thumb(t > 10 && t < 50 ? 2 : 0) }, 0, t > 10 && t < 50 ? 1 : 0).map((e) => e.type));
    }
    expect(types).toEqual([]);
  });

  it('computes correlation robustly', () => {
    expect(correlation([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
    expect(correlation([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1);
  });
});
