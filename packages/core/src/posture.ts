/**
 * Rough body-position classification from MediaPipe Pose landmarks.
 *
 * This is an awareness signal, not a safe-sleep guarantee. It needs the shoulders and hips to be
 * visible, so a child under a blanket comes back as 'unknown' and raises no position alerts.
 */
import type { CameraMount, Landmark } from './types';

export type Posture = 'unknown' | 'lying_back' | 'lying_front' | 'upright';

export const LM = {
  nose: 0,
  leftEye: 2,
  rightEye: 5,
  leftShoulder: 11,
  rightShoulder: 12,
  leftHip: 23,
  rightHip: 24,
} as const;

export interface PostureReading {
  posture: Posture;
  /** Angle of the hip→shoulder line away from image-vertical, degrees. */
  torsoAngle: number;
  /** Torso length divided by shoulder width (foreshortening cue for overhead cameras). */
  torsoRatio: number;
  /** Mean visibility of nose and eyes. */
  faceVisibility: number;
  /** >0 when the chest faces the camera, <0 when the back does (from left/right shoulder order). */
  facing: number;
}

const MIN_VIS = 0.5;

function mid(a: Landmark, b: Landmark) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function classifyPosture(lm: Landmark[], mount: CameraMount): PostureReading {
  const unknown: PostureReading = { posture: 'unknown', torsoAngle: NaN, torsoRatio: NaN, faceVisibility: 0, facing: 0 };
  if (lm.length < 25) return unknown;
  const ls = lm[LM.leftShoulder];
  const rs = lm[LM.rightShoulder];
  const lh = lm[LM.leftHip];
  const rh = lm[LM.rightHip];
  const shouldersVis = Math.min(ls.v, rs.v);
  const hipsVis = Math.max(lh.v, rh.v);
  if (shouldersVis < MIN_VIS || hipsVis < MIN_VIS) return unknown;

  const sh = mid(ls, rs);
  const hip = lh.v >= MIN_VIS && rh.v >= MIN_VIS ? mid(lh, rh) : lh.v > rh.v ? lh : rh;
  const up = { x: sh.x - hip.x, y: sh.y - hip.y };
  const torsoLen = Math.hypot(up.x, up.y);
  const shoulderWidth = Math.hypot(ls.x - rs.x, ls.y - rs.y);
  const torsoRatio = torsoLen / Math.max(shoulderWidth, 1e-6);
  // Image y grows downward, so an upright torso has shoulders above hips (up.y < 0).
  const torsoAngle = (Math.atan2(Math.abs(up.x), -up.y) * 180) / Math.PI;
  const faceVisibility = (lm[LM.nose].v + lm[LM.leftEye].v + lm[LM.rightEye].v) / 3;
  // Cross product of "up" and (left shoulder - right shoulder): positive when the person's left
  // shoulder is on the image's right, i.e. they face the camera.
  const s = { x: ls.x - rs.x, y: ls.y - rs.y };
  const facing = Math.sign(up.x * s.y - up.y * s.x);

  let upright: boolean;
  if (mount === 'side') {
    upright = torsoAngle < 35;
  } else {
    // Looking down from above, sitting up foreshortens the torso to less than shoulder width.
    upright = torsoRatio < 0.6;
  }

  let posture: Posture;
  if (upright) posture = 'upright';
  else if (faceVisibility < 0.3 || (facing < 0 && faceVisibility < 0.6)) posture = 'lying_front';
  else posture = 'lying_back';

  return { posture, torsoAngle, torsoRatio, faceVisibility, facing };
}
