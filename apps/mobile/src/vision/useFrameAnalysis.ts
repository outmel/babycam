/**
 * VisionCamera frame output that runs YOLO11n and MediaPipe Pose on the camera phone and hands
 * plain results (boxes, landmarks, image stats) to the JS thread. Frames never leave the
 * worklet: nothing is stored, encoded or uploaded.
 */
import type { Detection, HealthSample, Pose } from '@lulu/core';
import { useMemo } from 'react';
import { NitroModules } from 'react-native-nitro-modules';
import type { TfliteModel } from 'react-native-fast-tflite';
import { CommonResolutions, useFrameOutput } from 'react-native-vision-camera';
import { createSynchronizable, scheduleOnRN } from 'react-native-worklets';

import { cropForPose, decodePose, decodeYolo, letterbox, lumaStats, makePixelView, poseScore } from './worklets';

export interface FrameResult {
  detections: Detection[];
  poses: Pose[];
  health: HealthSample;
  inferenceMs: number;
}

interface Options {
  yolo: TfliteModel | undefined;
  pose: TfliteModel | undefined;
  /** Analyze at most one frame per this many milliseconds (battery and heat). */
  intervalMs: number;
  /** Per-class score thresholds, e.g. {0: 0.1, 76: 0.4}. */
  classThresholds: Record<number, number>;
  onResult: (r: FrameResult) => void;
}

export function useFrameAnalysis({ yolo, pose, intervalMs, classThresholds, onResult }: Options) {
  const lastRun = useMemo(() => createSynchronizable(0), []);
  const boxedYolo = useMemo(() => (yolo ? NitroModules.box(yolo) : undefined), [yolo]);
  const boxedPose = useMemo(() => (pose ? NitroModules.box(pose) : undefined), [pose]);
  const yoloShape = yolo?.inputs[0]?.shape ?? [1, 320, 320, 3];
  const yoloSize = yoloShape[1] ?? 320;
  const yoloUint8 = yolo?.inputs[0]?.dataType === 'uint8';
  const yoloOutShape = yolo?.outputs[0]?.shape ?? [1, 84, 2100];
  const poseSize = pose?.inputs[0]?.shape?.[1] ?? 256;
  const poseOutputs = pose?.outputs.map((o) => o.shape.reduce((a, b) => a * b, 1)) ?? [];
  const landmarksOut = poseOutputs.indexOf(195);
  const presenceOut = poseOutputs.indexOf(1);

  return useFrameOutput({
    targetResolution: CommonResolutions.VGA_4_3,
    pixelFormat: 'rgb',
    enablePhysicalBufferRotation: true,
    enablePreviewSizedOutputBuffers: true,
    dropFramesWhileBusy: true,
    onFrame(frame) {
      'worklet';
      const now = Date.now();
      if (now - lastRun.getDirty() < intervalMs || !frame.hasPixelBuffer) {
        frame.dispose();
        return;
      }
      lastRun.setBlocking(now);
      try {
        const v = makePixelView(frame.getPixelBuffer(), frame.width, frame.height, frame.bytesPerRow, frame.pixelFormat, frame.isMirrored);
        const health = lumaStats(v);
        let detections: Detection[] = [];
        const poses: Pose[] = [];
        if (boxedYolo) {
          const lb = letterbox(v, yoloSize, yoloUint8);
          const out = boxedYolo.unbox().runSync([lb.input.buffer as ArrayBuffer]);
          detections = decodeYolo(new Float32Array(out[0]), yoloOutShape, yoloSize, lb, v.width, v.height, classThresholds);
        }
        if (boxedPose && landmarksOut >= 0) {
          // Pose for up to two of the most confident people; children in a crib or on a mat.
          const people = detections.filter((d) => d.cls === 0 && d.score >= 0.4).sort((a, b) => b.score - a.score).slice(0, 2);
          const model = boxedPose.unbox();
          for (const p of people) {
            const crop = cropForPose(v, p.box, poseSize);
            const out = model.runSync([crop.input.buffer as ArrayBuffer]);
            if (presenceOut >= 0 && poseScore(new Float32Array(out[presenceOut])[0]) < 0.5) continue;
            poses.push({ box: p.box, landmarks: decodePose(new Float32Array(out[landmarksOut]), poseSize, crop, v.width, v.height) });
          }
        }
        scheduleOnRN(onResult, { detections, poses, health, inferenceMs: Date.now() - now });
      } finally {
        frame.dispose();
      }
    },
  });
}
