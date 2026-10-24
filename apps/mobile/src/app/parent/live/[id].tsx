import { useKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { RTCView, type MediaStream } from 'react-native-webrtc';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui';
import { Space } from '@/constants/theme';
import { LiveViewer, type ViewerState } from '@/lib/liveView';

export default function LiveScreen() {
  useKeepAwake();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [state, setState] = useState<ViewerState>('connecting');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const viewer = useRef<LiveViewer | null>(null);

  useEffect(() => {
    const v = new LiveViewer(id, (s, detail) => {
      setState(s);
      if (detail?.stream) setStream(detail.stream);
      if (detail?.error) setError(detail.error);
    });
    viewer.current = v;
    void v.start();
    return () => v.stop();
  }, [id, attempt]);

  return (
    <View style={styles.fill}>
      {stream && state === 'live' ? (
        <RTCView streamURL={stream.toURL()} style={styles.fill} objectFit="contain" />
      ) : (
        <View style={[styles.fill, styles.center]}>
          {state === 'connecting' && <ActivityIndicator color="#fff" size="large" />}
          <Text style={styles.msg}>
            {state === 'connecting' ? 'Connecting directly to the camera…' : state === 'failed' ? error ?? 'Could not connect' : 'Live view ended'}
          </Text>
          {state === 'failed' && <Button title="Try again" onPress={() => { setError(null); setAttempt((a) => a + 1); }} />}
        </View>
      )}
      <SafeAreaView style={styles.controls} edges={['top']}>
        <Text style={styles.badge}>🔒 End-to-end encrypted · peer to peer</Text>
        <Button title="Close" variant="secondary" onPress={() => router.back()} />
      </SafeAreaView>
      <Text style={styles.note}>Alerts on the camera pause while you watch and resume when you close this.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center', gap: Space.lg, padding: Space.xl },
  msg: { color: '#eee', fontSize: 16, textAlign: 'center' },
  controls: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: Space.lg },
  badge: { color: '#cfe8d3', fontSize: 13, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, overflow: 'hidden' },
  note: { position: 'absolute', bottom: 40, left: 0, right: 0, textAlign: 'center', color: '#bbb', fontSize: 13 },
});
