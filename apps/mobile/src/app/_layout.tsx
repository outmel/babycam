import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useTheme } from '@/constants/theme';
import { SessionProvider, useSession } from '@/lib/session';

SplashScreen.preventAutoHideAsync();

function Navigator() {
  const t = useTheme();
  const { ready } = useSession();
  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);
  if (!ready) return null;
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: t.background },
        headerTintColor: t.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: t.background },
      }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="sign-in" options={{ title: '', headerShown: false }} />
      <Stack.Screen name="onboarding" options={{ title: 'Your family' }} />
      <Stack.Screen name="camera/index" options={{ title: 'Camera setup' }} />
      <Stack.Screen name="camera/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="camera/zones/[id]" options={{ title: 'Safe zones' }} />
      <Stack.Screen name="parent/index" options={{ title: 'Lulu' }} />
      <Stack.Screen name="parent/live/[id]" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
      <Stack.Screen name="parent/events" options={{ title: 'History' }} />
      <Stack.Screen name="family" options={{ title: 'Family & caregivers' }} />
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SessionProvider>
          <StatusBar style="auto" />
          <Navigator />
        </SessionProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
