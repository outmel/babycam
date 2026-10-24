import { Redirect, router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Banner, Button, Card, T } from '@/components/ui';
import { Space, useTheme } from '@/constants/theme';
import { useSession } from '@/lib/session';
import { isConfigured } from '@/lib/supabase';

export default function Home() {
  const t = useTheme();
  const { session, membership, mode, setMode } = useSession();

  if (!isConfigured) {
    return (
      <SafeAreaView style={[styles.fill, { backgroundColor: t.background }]}>
        <View style={styles.body}>
          <T variant="title">Lulu</T>
          <Banner tone="warning" text="Supabase isn't configured. Copy apps/mobile/.env.example to .env.local, add your project URL and anon key, then restart the dev server." />
        </View>
      </SafeAreaView>
    );
  }
  if (!session) return <Redirect href="/sign-in" />;
  if (!membership) return <Redirect href="/onboarding" />;
  if (mode === 'camera') return <Redirect href="/camera" />;
  if (mode === 'parent') return <Redirect href="/parent" />;

  const choose = async (m: 'camera' | 'parent') => {
    await setMode(m);
    router.replace(m === 'camera' ? '/camera' : '/parent');
  };

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: t.background }]}>
      <View style={styles.body}>
        <View style={{ gap: Space.xs }}>
          <T variant="title">How will this phone be used?</T>
          <T variant="muted">{membership.households?.name}. You can change this later in Settings.</T>
        </View>
        <Card onPress={() => choose('camera')}>
          <T variant="heading">📷  Camera</T>
          <T variant="muted">Point this phone at the crib or play area. It watches and listens on-device and never uploads video.</T>
        </Card>
        <Card onPress={() => choose('parent')}>
          <T variant="heading">🔔  Parent</T>
          <T variant="muted">Get alerts, open live view, and see the shared history and sleep log.</T>
        </Card>
        <Button title="Family & caregivers" variant="ghost" onPress={() => router.push('/family')} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  body: { flex: 1, padding: Space.xl, gap: Space.lg, justifyContent: 'center' },
});
