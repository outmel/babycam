/** Shared types. All coordinates are normalized to 0..1 of the (upright) frame, origin top-left. */

export type Severity = 'info' | 'warning' | 'alert';

export type EventType =
  | 'cry_detected'
  | 'cry_stopped'
  | 'zone_edge'
  | 'zone_exit'
  | 'sat_up'
  | 'rolled_over'
  | 'hazard_near'
  | 'child_stirring'
  | 'child_settled'
  | 'camera_blocked'
  | 'camera_dark'
  | 'camera_moved'
  | 'camera_ok'
  | 'camera_offline'
  | 'camera_online'
  | 'battery_low'
  | 'analysis_paused'
  | 'analysis_resumed';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

/** One object-detector output. `cls` is a COCO class index. */
export interface Detection {
  box: Box;
  score: number;
  cls: number;
}

/** MediaPipe-style landmark. `v` is visibility in 0..1 (already sigmoided). */
export interface Landmark {
  x: number;
  y: number;
  v: number;
}

/** 33 MediaPipe Pose landmarks for the person inside `box`. */
export interface Pose {
  box: Box;
  landmarks: Landmark[];
}

/** Cheap image statistics used for camera-health checks. */
export interface HealthSample {
  /** Mean luminance 0..255. */
  mean: number;
  /** Luminance standard deviation 0..255. */
  std: number;
  /** Optional 16x16 grayscale thumbnail (256 values, 0..255) for "camera moved" checks. */
  thumb?: number[];
}

export interface FrameObservation {
  /** Seconds since the session started. */
  t: number;
  detections: Detection[];
  poses?: Pose[];
  health?: HealthSample;
  /** Peak accelerometer change (in g) since the previous frame, if available. */
  motion?: number;
}

export interface AudioObservation {
  t: number;
  /** Probability-like crying score 0..1 for a ~1 s window. */
  cry: number;
}

export interface Zone {
  id: string;
  name: string;
  /** Polygon, normalized coordinates, at least 3 points. */
  points: Point[];
}

export type CameraMount = 'overhead' | 'side';

export interface LuluEvent {
  type: EventType;
  severity: Severity;
  /** Seconds since session start (same clock as observations). */
  t: number;
  message: string;
  /** Anonymous track label such as "A" when the event concerns one child. */
  track?: string;
  data?: Record<string, unknown>;
}

/** What the camera screen draws over the preview. */
export interface TrackSnapshot {
  id: number;
  label: string;
  box: Box;
  isChild: boolean;
  zoneId?: string;
  posture?: string;
}
