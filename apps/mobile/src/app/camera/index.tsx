import { router } from 'expo-router';
import { useState } from 'react';

import { Banner, Button, Card, Field, Pill, Row, Screen, Segmented, T } from '@/components/ui';
import { useTheme } from '@/constants/theme';
import { timeAgo, useCameras } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import type { CameraSettings } from '@/lib/types';

export default function CameraSetup() {
  const t = useTheme();
  const { householdId, membership, setMode } = useSession();
  const { cameras, refresh } = useCameras(householdId);
  const [name, setName] = useState('Nursery');
  const [mount, setMount] = useState<'overhead' | 'side'>('overhead');
  const [position, setPosition] = useState<'back' | 'front'>('back');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (membership?.role === 'viewer') {
    return (
      <Screen>
        <Banner tone="warning" text="Viewers can't run a camera. Ask the family owner to make you a caregiver." />
        <Button title="Use as parent phone instead" onPress={async () => { await setMode('parent'); router.replace('/parent'); }} />
      </Screen>
    );
  }

  const create = async () => {
    setBusy(true);
    setError(null);
    const settings: CameraSettings = { mount, position };
    const { data, error } = await supabase
      .from('cameras')
      .insert({ household_id: householdId, name: name.trim(), settings })
      .select('id')
      .single();
    setBusy(false);
    if (error) return setError(error.message);
    await refresh();
    router.push({ pathname: '/camera/zones/[id]', params: { id: data.id, first: '1' } });
  };

  return (
    <Screen>
      <T variant="muted">Put this phone on a charger, about 1–2 m from the crib or play mat, pointing down at it.</T>
      {cameras.length > 0 && (
        <>
          <T variant="label">Use an existing camera</T>
          {cameras.map((c) => (
            <Card key={c.id} onPress={() => router.replace({ pathname: '/camera/[id]', params: { id: c.id } })}>
              <Row style={{ justifyContent: 'space-between' }}>
                <T variant="heading">{c.name}</T>
                <Pill label={c.online ? 'Online' : `Seen ${timeAgo(c.last_seen_at)}`} color={c.online ? t.ok : t.textMuted} />
              </Row>
              <T variant="small">{c.zones.length} safe zone{c.zones.length === 1 ? '' : 's'} · {c.settings.mount === 'side' ? 'side view' : 'overhead'}</T>
            </Card>
          ))}
        </>
      )}
      <Card>
        <T variant="heading">Add a new camera</T>
        <Field label="Name" value={name} onChangeText={setName} />
        <T variant="label">Camera angle</T>
        <Segmented value={mount} onChange={setMount} options={[{ value: 'overhead', label: 'Looking down' }, { value: 'side', label: 'From the side' }]} />
        <T variant="label">Lens</T>
        <Segmented value={position} onChange={setPosition} options={[{ value: 'back', label: 'Back (better)' }, { value: 'front', label: 'Front' }]} />
        <Button title="Add camera and draw safe zone" onPress={create} loading={busy} disabled={!name.trim()} />
      </Card>
      {error && <Banner tone="alert" text={error} />}
      <Button title="Switch to parent mode" variant="ghost" onPress={async () => { await setMode('parent'); router.replace('/parent'); }} />
    </Screen>
  );
}
