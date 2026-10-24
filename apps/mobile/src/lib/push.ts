import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from './supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export type PushResult = { ok: true; token: string } | { ok: false; reason: string };

/**
 * Register this phone for alerts. Only parent-mode phones register, so a camera phone in the
 * nursery never buzzes.
 */
export async function registerForPush(): Promise<PushResult> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('alerts', {
      name: 'Alerts',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'default',
      vibrationPattern: [0, 400, 200, 400],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
    await Notifications.setNotificationChannelAsync('warnings', {
      name: 'Warnings',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
    });
  }
  if (!Device.isDevice) return { ok: false, reason: 'Push notifications need a physical device.' };

  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return { ok: false, reason: 'Notifications are turned off for Lulu in system settings.' };

  const projectId = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;
  if (!projectId) return { ok: false, reason: 'Set extra.eas.projectId in app.json (run `eas init`) to enable push.' };

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    const { error } = await supabase
      .from('push_tokens')
      .upsert({ token, platform: Platform.OS, updated_at: new Date().toISOString() }, { onConflict: 'token' });
    if (error) return { ok: false, reason: error.message };
    return { ok: true, token };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

export async function unregisterPush(): Promise<void> {
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) return;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await supabase.from('push_tokens').delete().eq('token', token);
  } catch {
    // Not registered; nothing to remove.
  }
}
