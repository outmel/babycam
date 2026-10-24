/**
 * Camera-mode controller. Feeds model outputs into the shared @lulu/core Pipeline, turns its
 * events into rows in the offline queue, reports heartbeats and battery, and hands the camera
 * over to WebRTC when a caregiver opens live view.
 */
import {
  defaultConfig,
  Pipeline,
  serializeTrace,
  type LuluEvent,
  type TraceItem,
  type TrackSnapshot,
} from '@lulu/core';
import * as Battery from 'expo-battery';
import { File, Paths } from 'expo-file-system';
import { Accelerometer } from 'expo-sensors';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useRef, useState } from 'react';

import { CryListener } from '@/audio/cryListener';
import { enqueueEvent, newClientId, onQueueChange, pendingCount, startQueueSync } from '@/lib/eventQueue';
import { LiveHost } from '@/lib/liveView';
import { supabase } from '@/lib/supabase';
import type { CameraRow, CameraStatus } from '@/lib/types';
import type { FrameResult } from '@/vision/useFrameAnalysis';
import type { TfliteModel } from 'react-native-fast-tflite';

const HEARTBEAT_MS = 30_000;

export interface MonitorState {
  analysis: CameraStatus['analysis'];
  tracks: TrackSnapshot[];
  crying: boolean;
  cryLevel: number;
  fps: number;
  inferenceMs: number;
  recent: LuluEvent[];
  pendingUploads: number;
  viewers: number;
  recording: boolean;
  micError: string | null;
}

export function useMonitor(camera: CameraRow, yamnet: TfliteModel | undefined, modelsSummary: string) {
  const startedAt = useRef(Date.now());
  const pipeline = useRef<Pipeline | null>(null);
  pipeline.current ??= new Pipeline(
    defaultConfig({ zones: camera.zones, mount: camera.settings.mount ?? 'overhead', features: camera.settings.features }),
  );
  const motionPeak = useRef(0);
  const frameTimes = useRef<number[]>([]);
  const trace = useRef<TraceItem[] | null>(null);
  const cameraStopped = useRef<(() => void) | null>(null);
  const batteryLowSent = useRef(false);
  const [cameraActive, setCameraActive] = useState(true);
  const [state, setState] = useState<MonitorState>({
    analysis: 'starting',
    tracks: [],
    crying: false,
    cryLevel: 0,
    fps: 0,
    inferenceMs: 0,
    recent: [],
    pendingUploads: pendingCount(),
    viewers: 0,
    recording: false,
    micError: null,
  });
  const stateRef = useRef(state);
  stateRef.current = state;

  const now = () => (Date.now() - startedAt.current) / 1000;

  const emit = useCallback(
    (events: LuluEvent[]) => {
      if (!events.length) return;
      for (const e of events) {
        void enqueueEvent({
          household_id: camera.household_id,
          camera_id: camera.id,
          client_id: newClientId(),
          type: e.type,
          severity: e.severity,
          message: e.message,
          track: e.track ?? null,
          data: e.data ?? {},
          occurred_at: new Date(startedAt.current + e.t * 1000).toISOString(),
        });
      }
      setState((s) => ({ ...s, recent: [...[...events].reverse(), ...s.recent].slice(0, 20) }));
    },
    [camera.household_id, camera.id],
  );

  // Keep the pipeline in sync with zone/mount edits.
  useEffect(() => {
    pipeline.current?.setZones(camera.zones);
  }, [camera.zones]);
  useEffect(() => {
    pipeline.current?.setMount(camera.settings.mount ?? 'overhead');
  }, [camera.settings.mount]);

  const onFrame = useCallback(
    (r: FrameResult) => {
      const t = now();
      const motion = motionPeak.current;
      motionPeak.current = 0;
      const obs = { t, detections: r.detections, poses: r.poses, health: r.health, motion };
      const events = pipeline.current!.processFrame(obs);
      trace.current?.push({ kind: 'frame', ...obs });
      emit(events);
      const ft = frameTimes.current;
      ft.push(t);
      while (ft.length && t - ft[0] > 5) ft.shift();
      setState((s) => ({
        ...s,
        analysis: 'running',
        tracks: pipeline.current!.snapshot(),
        fps: ft.length / 5,
        inferenceMs: r.inferenceMs,
      }));
    },
    [emit],
  );

  // Microphone → YAMNet → pipeline.
  const cry = useRef<CryListener | null>(null);
  const startMic = useCallback(async () => {
    if (!yamnet || cry.current) return;
    if (!(await CryListener.requestPermission())) {
      setState((s) => ({ ...s, micError: 'Microphone permission is off, so crying cannot be detected.' }));
      return;
    }
    const listener = new CryListener(yamnet, (score, level) => {
      const t = now();
      trace.current?.push({ kind: 'audio', t, cry: score });
      emit(pipeline.current!.processAudio({ t, cry: score }));
      setState((s) => ({ ...s, crying: pipeline.current!.isCrying, cryLevel: level }));
    });
    cry.current = listener;
    try {
      await listener.start();
      setState((s) => ({ ...s, micError: null }));
    } catch (e) {
      cry.current = null;
      setState((s) => ({ ...s, micError: e instanceof Error ? e.message : String(e) }));
    }
  }, [yamnet, emit]);
  const stopMic = useCallback(async () => {
    const l = cry.current;
    cry.current = null;
    await l?.stop();
  }, []);

  useEffect(() => {
    void startMic();
    return () => void stopMic();
  }, [startMic, stopMic]);

  // Accelerometer: remember the largest jolt between frames for the "camera moved" check.
  useEffect(() => {
    let last: number | null = null;
    Accelerometer.setUpdateInterval(100);
    const sub = Accelerometer.addListener(({ x, y, z }) => {
      const m = Math.sqrt(x * x + y * y + z * z);
      if (last !== null) motionPeak.current = Math.max(motionPeak.current, Math.abs(m - last));
      last = m;
    });
    return () => sub.remove();
  }, []);

  // Offline queue + heartbeat + battery.
  useEffect(() => {
    const stopSync = startQueueSync();
    const unsub = onQueueChange((n) => setState((s) => ({ ...s, pendingUploads: n })));
    const beat = async () => {
      const [level, bstate] = await Promise.all([Battery.getBatteryLevelAsync(), Battery.getBatteryStateAsync()]);
      const charging = bstate === Battery.BatteryState.CHARGING || bstate === Battery.BatteryState.FULL;
      if (level >= 0 && level < 0.2 && !charging && !batteryLowSent.current) {
        batteryLowSent.current = true;
        emit([{ type: 'battery_low', severity: 'warning', t: now(), message: `Camera battery at ${Math.round(level * 100)}%. Plug it in to keep monitoring.` }]);
      }
      if (charging) batteryLowSent.current = false;
      const s = stateRef.current;
      await supabase.rpc('camera_heartbeat', {
        p_camera: camera.id,
        p_status: {
          battery: level,
          charging,
          analysis: s.analysis,
          models: modelsSummary,
          fps: Math.round(s.fps * 10) / 10,
          people: s.tracks.length,
        } satisfies CameraStatus,
      });
    };
    void beat();
    const timer = setInterval(() => void beat(), HEARTBEAT_MS);
    return () => {
      stopSync();
      unsub();
      clearInterval(timer);
    };
  }, [camera.id, emit, modelsSummary]);

  // Live view: give camera + mic to WebRTC while someone watches, then take them back.
  useEffect(() => {
    const host = new LiveHost(camera.id, {
      position: () => camera.settings.position ?? 'back',
      pauseAnalysis: async () => {
        await stopMic();
        await new Promise<void>((resolve) => {
          cameraStopped.current = resolve;
          setCameraActive(false);
          setTimeout(resolve, 1500);
        });
        setState((s) => ({ ...s, analysis: 'paused_live', tracks: [] }));
        emit([{ type: 'analysis_paused', severity: 'info', t: now(), message: 'Live view opened. Alerts pause while someone is watching.' }]);
      },
      resumeAnalysis: () => {
        setCameraActive(true);
        void startMic();
        setState((s) => ({ ...s, analysis: 'starting' }));
        emit([{ type: 'analysis_resumed', severity: 'info', t: now(), message: 'Live view closed. Alerts are back on.' }]);
      },
      onViewersChanged: (n) => setState((s) => ({ ...s, viewers: n })),
    });
    host.start().catch((e) => console.warn('Live view unavailable', e));
    return () => host.stop();
  }, [camera.id, camera.settings.position, emit, startMic, stopMic]);

  const onCameraStopped = useCallback(() => {
    cameraStopped.current?.();
    cameraStopped.current = null;
  }, []);

  const startRecording = useCallback(() => {
    trace.current = [];
    setState((s) => ({ ...s, recording: true }));
  }, []);

  const stopRecording = useCallback(async () => {
    const items = trace.current ?? [];
    trace.current = null;
    setState((s) => ({ ...s, recording: false }));
    if (!items.length) return;
    const t0 = items[0].t;
    const clip = `device-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`;
    const body = serializeTrace({
      header: {
        kind: 'header',
        version: 1,
        clip,
        source: 'device',
        mount: camera.settings.mount ?? 'overhead',
        zones: camera.zones,
        durationSec: items[items.length - 1].t - t0,
        note: `Recorded on ${camera.name}`,
      },
      items: items.map((i) => ({ ...i, t: Math.round((i.t - t0) * 1000) / 1000 })),
    });
    const file = new File(Paths.cache, `${clip}.jsonl`);
    await file.write(body);
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType: 'application/x-ndjson' });
  }, [camera.name, camera.settings.mount, camera.zones]);

  const resetView = useCallback(() => pipeline.current?.resetCameraReference(), []);

  return { state, cameraActive, onFrame, onCameraStopped, startRecording, stopRecording, resetView };
}
