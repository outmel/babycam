import { router } from 'expo-router';
import { useState } from 'react';

import { Banner, Button, Card, Field, Screen, T } from '@/components/ui';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

export default function Onboarding() {
  const { refreshMemberships, setHousehold, signOut } = useSession();
  const [name, setName] = useState('');
  const [yourName, setYourName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const finish = async (householdId: string) => {
    await refreshMemberships();
    await setHousehold(householdId);
    router.replace('/');
  };

  const create = async () => {
    setBusy('create');
    setError(null);
    const { data, error } = await supabase.rpc('create_household', { p_name: name.trim(), p_display_name: yourName.trim() });
    setBusy(null);
    if (error) return setError(error.message);
    await finish(data as string);
  };

  const join = async () => {
    setBusy('join');
    setError(null);
    const { data, error } = await supabase.rpc('redeem_invite', { p_code: code.trim(), p_display_name: yourName.trim() });
    setBusy(null);
    if (error) return setError(error.message);
    await finish(data as string);
  };

  return (
    <Screen>
      <T variant="muted">Lulu groups cameras and caregivers into a family. Everyone in it gets alerts and sees the same history.</T>
      <Field label="Your name" value={yourName} onChangeText={setYourName} placeholder="e.g. Sam" />
      <Card>
        <T variant="heading">Start a new family</T>
        <Field label="Family name" value={name} onChangeText={setName} placeholder="e.g. The Garcias" />
        <Button title="Create" onPress={create} loading={busy === 'create'} disabled={!name.trim()} />
      </Card>
      <Card>
        <T variant="heading">Join with an invite code</T>
        <T variant="muted">Ask the family owner to create a code in Family & caregivers.</T>
        <Field label="Invite code" value={code} onChangeText={(v) => setCode(v.toUpperCase())} autoCapitalize="characters" placeholder="8 letters" />
        <Button title="Join" variant="secondary" onPress={join} loading={busy === 'join'} disabled={code.trim().length < 8} />
      </Card>
      {error && <Banner tone="alert" text={error} />}
      <Button title="Sign out" variant="ghost" onPress={async () => { await signOut(); router.replace('/sign-in'); }} />
    </Screen>
  );
}
