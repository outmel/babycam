import type { Severity } from '@lulu/core';
import { router } from 'expo-router';
import { useState } from 'react';

import { Banner, Button, Card, Screen, Segmented, T } from '@/components/ui';
import { unregisterPush } from '@/lib/push';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

export default function Settings() {
  const { session, membership, memberships, householdId, setHousehold, mode, setMode, signOut, refreshMemberships } = useSession();
  const [pref, setPref] = useState<Severity>(membership?.min_push_severity ?? 'warning');
  const [error, setError] = useState<string | null>(null);

  const savePref = async (v: Severity) => {
    setPref(v);
    const { error } = await supabase
      .from('household_members')
      .update({ min_push_severity: v })
      .eq('household_id', householdId!)
      .eq('user_id', session!.user.id);
    if (error) setError(error.message);
    else await refreshMemberships();
  };

  const switchMode = async () => {
    const next = mode === 'camera' ? 'parent' : 'camera';
    if (next === 'camera') await unregisterPush();
    await setMode(next);
    router.dismissAll();
    router.replace(next === 'camera' ? '/camera' : '/parent');
  };

  return (
    <Screen>
      <Card>
        <T variant="label">This phone</T>
        <T>{mode === 'camera' ? 'Camera' : 'Parent'} mode · {session?.user.email}</T>
        <Button title={mode === 'camera' ? 'Use as parent phone' : 'Use as camera'} variant="secondary" onPress={switchMode} />
      </Card>

      <Card>
        <T variant="label">Push notifications for</T>
        <Segmented
          value={pref}
          onChange={savePref}
          options={[
            { value: 'alert', label: 'Urgent only' },
            { value: 'warning', label: 'Alerts + warnings' },
            { value: 'info', label: 'Everything' },
          ]}
        />
        <T variant="small">Urgent: crying, leaving the safe zone, rolling over, objects nearby, camera blocked or offline.</T>
      </Card>

      {memberships.length > 1 && (
        <Card>
          <T variant="label">Family</T>
          {memberships.map((m) => (
            <Button
              key={m.household_id}
              title={`${m.households?.name ?? 'Family'}${m.household_id === householdId ? ' ✓' : ''}`}
              variant="ghost"
              onPress={() => setHousehold(m.household_id)}
            />
          ))}
        </Card>
      )}

      <Card>
        <T variant="label">Privacy</T>
        <T variant="muted">
          Video and audio are analyzed on the camera phone and never uploaded or recorded. Live view goes directly between phones, encrypted end to end. Only short text events (like "Crying detected") are stored in your family's history.
        </T>
      </Card>

      {error && <Banner tone="alert" text={error} />}
      <Button title="Sign out" variant="danger" onPress={async () => { await unregisterPush(); await signOut(); router.dismissAll(); router.replace('/sign-in'); }} />
    </Screen>
  );
}
