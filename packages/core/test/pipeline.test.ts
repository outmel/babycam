import { describe, expect, it } from 'vitest';
import { defaultConfig, Pipeline, syntheticPose } from '../src';
import type { Box, Detection, FrameObservation, LuluEvent, Zone } from '../src';

const crib: Zone = {
  id: 'crib',
  name: 'crib',
  points: [
    { x: 0.25, y: 0.2 },
    { x: 0.75, y: 0.2 },
    { x: 0.75, y: 0.85 },
    { x: 0.25, y: 0.85 },
  ],
};

const det = (box: Box, cls = 0, score = 0.85): Detection => ({ box, score, cls });

function run(frames: (t: number) => Omit<FrameObservation, 't'>, seconds: number, cfg = {}): LuluEvent[] {
  const p = new Pipeline(defaultConfig({ zones: [crib], ...cfg }));
  const out: LuluEvent[] = [];
  for (let t = 0; t <= seconds; t += 0.2) out.push(...p.processFrame({ t, ...frames(t) }));
  return out;
}

describe('Pipeline zones', () => {
  it('warns at the edge, then alerts when the child leaves', () => {
    const events = run((t) => {
      // Still in the middle until 10 s, then crawls right and out over ~10 s.
      const x = t < 10 ? 0.42 : Math.min(0.42 + (t - 10) * 0.05, 0.95);
      return { detections: [det({ x, y: 0.4, w: 0.16, h: 0.2 })] };
    }, 30);
    const types = events.map((e) => e.type).filter((t) => t.startsWith('zone'));
    expect(types).toEqual(['zone_edge', 'zone_exit']);
    expect(events.find((e) => e.type === 'zone_exit')?.message).toContain('Child A');
  });

  it('stays quiet when a caregiver lifts the child out', () => {
    const events = run((t) => {
      const child = t < 10 ? 0.42 : Math.min(0.42 + (t - 10) * 0.05, 0.95);
      const dets = [det({ x: child, y: 0.4, w: 0.16, h: 0.2 })];
      // Adult arrives at 6 s and stays right beside the child, partly outside the crib.
      if (t >= 6) dets.push(det({ x: child + 0.12, y: 0.15, w: 0.3, h: 0.7 }));
      return { detections: dets };
    }, 30);
    expect(events.filter((e) => e.type === 'zone_exit' || e.type === 'zone_edge')).toEqual([]);
  });

  it('treats someone only partly inside the zone as an adult', () => {
    const events = run(() => ({ detections: [det({ x: 0.6, y: 0.1, w: 0.35, h: 0.8 })] }), 20);
    expect(events.filter((e) => e.type.startsWith('zone'))).toEqual([]);
  });

  it('alerts when a child at the edge disappears from view', () => {
    const events = run((t) => {
      if (t < 8) return { detections: [det({ x: 0.42, y: 0.4, w: 0.16, h: 0.2 })] };
      if (t < 12) return { detections: [det({ x: 0.42 + (t - 8) * 0.06, y: 0.4, w: 0.16, h: 0.2 })] };
      return { detections: [] };
    }, 20);
    const exit = events.find((e) => e.type === 'zone_exit');
    expect(exit?.data?.vanished).toBe(true);
  });
});

describe('Pipeline posture', () => {
  it('alerts on sitting up and rolling over, once each', () => {
    const events = run((t) => {
      const lying: Box = { x: 0.43, y: 0.35, w: 0.14, h: 0.3 };
      const sitting: Box = { x: 0.4, y: 0.4, w: 0.2, h: 0.2 };
      let box = lying;
      let posture: 'back' | 'front' | 'upright' = 'back';
      if (t >= 10 && t < 20) {
        box = sitting;
        posture = 'upright';
      } else if (t >= 30) posture = 'front';
      return { detections: [det(box)], poses: [{ box, landmarks: syntheticPose(box, posture, 'overhead') }] };
    }, 45);
    expect(events.filter((e) => e.type === 'sat_up' || e.type === 'rolled_over').map((e) => e.type)).toEqual([
      'sat_up',
      'rolled_over',
    ]);
  });
});

describe('Pipeline hazards', () => {
  it('needs the object for several frames before alerting', () => {
    const child: Box = { x: 0.42, y: 0.4, w: 0.16, h: 0.2 };
    const flicker = run((t) => {
      const dets = [det(child)];
      if (Math.round(t * 5) % 15 === 0 && t > 5) dets.push(det({ x: 0.6, y: 0.45, w: 0.05, h: 0.05 }, 76, 0.6));
      return { detections: dets };
    }, 20);
    expect(flicker.filter((e) => e.type === 'hazard_near')).toEqual([]);

    const steady = run((t) => {
      const dets = [det(child)];
      if (t > 5) dets.push(det({ x: 0.6, y: 0.45, w: 0.05, h: 0.05 }, 76, 0.6));
      return { detections: dets };
    }, 20);
    const hz = steady.filter((e) => e.type === 'hazard_near');
    expect(hz.length).toBe(1);
    expect(hz[0].message).toBe('Scissors spotted near Child A');
  });
});

describe('Pipeline activity', () => {
  it('reports settled after stillness and stirring after movement', () => {
    const events = run((t) => {
      const wiggle = t > 120 && t < 140 ? Math.sin(t * 3) * 0.04 : 0;
      return { detections: [det({ x: 0.42 + wiggle, y: 0.4, w: 0.16, h: 0.2 })] };
    }, 150);
    expect(events.filter((e) => e.severity === 'info').map((e) => e.type)).toEqual(['child_settled', 'child_stirring']);
  });
});
