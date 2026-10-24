import { DEFAULT_HAZARD_CLASSES, EVENT_META } from '@lulu/core';
import { useKeepAwake } from 'expo-keep-awake';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCameraPermission } from 'react-native-vision-camera';

import { CameraStage } from '@/components/CameraStage';
import { Overlay } from '@/components/Overlay';
import { Banner, Button, Pill, Row, T } from '@/components/ui';
import { severityColor, Space, useTheme } from '@/constants/theme';
import { useMonitor } from '@/camera/useMonitor';
import { useCameras } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import type { CameraRow } from '@/lib/types';
import { describeModels, useLuluModels } from '@/vision/models';
import { useFrameAnalysis } from '@/vision/useFrameAnalysis';

const CLASS_THRESHOLDS: Record<number, number> = {
  0: 0.1,
  ...Object.fromEntries(Object.keys(DEFAULT_HAZARD_CLASSES).map((k) => [Number(k), 0.4])),
};

export default function CameraScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { householdId } = useSession();
  const { cameras, loading } = useCameras(householdId);
  const camera = cameras.find((c) => c.id === id);
  const permission = useCameraPermission();
  const t = useTheme();

  if (loading) return <View style={{ flex: 1, backgroundColor: '#000' }} />;
  if (!camera) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.background, padding: Space.xl, gap: Space.lg }}>
        <Banner tone="alert" text="This camera was removed or you no longer have access." />
        <Button title="Back" onPress={() => router.replace('/camera')} />
      </SafeAreaView>
    );
  }
  if (!permission.hasPermission) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.background, padding: Space.xl, gap: Space.lg, justifyContent: 'center' }}>
        <T variant="title">Camera access</T>
        <T variant="muted">Lulu analyzes video on this phone only. Nothing is recorded or uploaded.</T>
        <Button title="Allow camera" onPress={permission.requestPermission} />
      </SafeAreaView>
    );
  }
  return <Monitor camera={camera} />;
}

function Monitor({ camera }: { camera: CameraRow }) {
  useKeepAwake();
  const t = useTheme();
  const models = useLuluModels();
  const yolo = models.yolo.status === 'ready' ? models.yolo.model : undefined;
  const pose = models.pose.status === 'ready' ? models.pose.model : undefined;
  const yamnet = models.yamnet.status === 'ready' ? models.yamnet.model : undefined;
  const summary = useMemo(() => describeModels(models), [models]);
  const monitor = useMonitor(camera, yamnet, summary);
  const [focused, setFocused] = useState(true);
  const [dimmed, setDimmed] = useState(false);
  const { state } = monitor;

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const frameOutput = useFrameAnalysis({
    yolo,
    pose,
    intervalMs: 200,
    classThresholds: CLASS_THRESHOLDS,
    onResult: monitor.onFrame,
  });

  const status =
    state.analysis === 'paused_live'
      ? { label: `Live view (${state.viewers})`, color: t.info }
      : state.analysis === 'running'
        ? { label: 'Watching', color: t.ok }
        : { label: 'Starting…', color: t.warning };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <Row style={styles.topBar}>
          <Text style={styles.title}>{camera.name}</Text>
          <View style={{ flex: 1 }} />
          <Pill label={status.label} color={status.color} />
          {state.crying && <Pill label="Crying" color={t.alert} />}
        </Row>

        <CameraStage
          position={camera.settings.position ?? 'back'}
          isActive={monitor.cameraActive && focused}
          outputs={[frameOutput]}
          onStopped={monitor.onCameraStopped}>
          {(size) => <Overlay {...size} zones={camera.zones} tracks={state.tracks} />}
        </CameraStage>

        <ScrollView contentContainerStyle={{ padding: Space.lg, gap: Space.md }}>
          {camera.zones.length === 0 && <Banner tone="warning" text="Draw a safe zone so Lulu knows where your child is. Zone, position and object alerts need one." />}
          {models.yolo.status === 'missing' && (
            <Banner tone="warning" text="The object detection model isn't installed, so only crying and camera checks are active. See models/README in the repo." />
          )}
          {models.yolo.status === 'error' && <Banner tone="alert" text={`Detector failed to load: ${models.yolo.error}`} />}
          {state.micError && <Banner tone="warning" text={state.micError} />}

          <Row style={{ flexWrap: 'wrap' }}>
            <Button title="Safe zones" variant="secondary" onPress={() => router.push({ pathname: '/camera/zones/[id]', params: { id: camera.id } })} />
            <Button title="Dim screen" variant="secondary" onPress={() => setDimmed(true)} />
            <Button
              title={state.recording ? 'Stop & share trace' : 'Record trace'}
              variant={state.recording ? 'danger' : 'secondary'}
              onPress={state.recording ? monitor.stopRecording : monitor.startRecording}
            />
            <Button title="Reset view" variant="ghost" onPress={monitor.resetView} />
            <Button title="Settings" variant="ghost" onPress={() => router.push('/settings')} />
          </Row>

          <Text style={styles.stats}>
            {state.fps.toFixed(1)} fps · {state.inferenceMs} ms/frame · {state.tracks.length} in view
            {state.pendingUploads > 0 ? ` · ${state.pendingUploads} events waiting for Wi-Fi` : ''}
          </Text>

          {state.recent.map((e, i) => (
            <Row key={`${e.t}-${i}`}>
              <View style={[styles.dot, { backgroundColor: severityColor(t, e.severity) }]} />
              <Text style={styles.event}>
                {EVENT_META[e.type].title}: {e.message}
              </Text>
            </Row>
          ))}
        </ScrollView>
      </SafeAreaView>

      {dimmed && (
        <Pressable style={styles.dim} onPress={() => setDimmed(false)}>
          <Text style={styles.dimText}>Lulu is {state.analysis === 'running' ? 'watching' : 'paused'} · tap to wake</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { paddingHorizontal: Space.lg, paddingVertical: Space.sm },
  title: { color: '#fff', fontSize: 18, fontWeight: '600' },
  stats: { color: '#9a918a', fontSize: 12 },
  event: { color: '#e9e2da', fontSize: 14, flex: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dim: { ...StyleSheet.absoluteFill, backgroundColor: '#000', alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 60 },
  dimText: { color: '#3a3430', fontSize: 14 },
});
