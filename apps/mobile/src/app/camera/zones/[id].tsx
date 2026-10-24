import type { Point, Zone } from '@lulu/core';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { CameraStage } from '@/components/CameraStage';
import { Overlay } from '@/components/Overlay';
import { Banner, Button, Card, Field, Row, T } from '@/components/ui';
import { Space, useTheme } from '@/constants/theme';
import { useCameras } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

export default function ZonesScreen() {
  const { id, first } = useLocalSearchParams<{ id: string; first?: string }>();
  const t = useTheme();
  const { householdId } = useSession();
  const { cameras } = useCameras(householdId);
  const camera = cameras.find((c) => c.id === id);
  const [zones, setZones] = useState<Zone[]>([]);
  const [draft, setDraft] = useState<Point[]>([]);
  const [name, setName] = useState('crib');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (camera) setZones(camera.zones);
  }, [camera]);

  const addZone = () => {
    if (draft.length < 3) return;
    setZones((z) => [...z, { id: `z${Date.now().toString(36)}`, name: name.trim() || 'safe zone', points: draft }]);
    setDraft([]);
  };

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from('cameras').update({ zones }).eq('id', id);
    setSaving(false);
    if (error) return setError(error.message);
    if (first) router.replace({ pathname: '/camera/[id]', params: { id } });
    else router.back();
  };

  return (
    <ScrollView contentContainerStyle={{ gap: Space.lg, paddingBottom: Space.xxl }} style={{ backgroundColor: t.background }}>
      <CameraStage position={camera?.settings.position ?? 'back'} isActive outputs={[]}>
        {(size) => (
          <Pressable
            style={{ position: 'absolute', left: 0, top: 0, width: size.width, height: size.height }}
            onPress={(e) => {
              const { locationX, locationY } = e.nativeEvent;
              setDraft((d) => [...d, { x: locationX / size.width, y: locationY / size.height }]);
            }}>
            <Overlay {...size} zones={zones} draft={draft} />
          </Pressable>
        )}
      </CameraStage>
      <View style={{ paddingHorizontal: Space.lg, gap: Space.md }}>
        <T variant="muted">
          Tap the corners of the mattress or play mat to outline it. Draw it a little larger than the mattress so a child lying near the side doesn't count as "at the edge".
        </T>
        <Card>
          <Field label="Zone name" value={name} onChangeText={setName} placeholder="crib, play mat…" />
          <Row>
            <Button title={`Add zone (${draft.length} points)`} onPress={addZone} disabled={draft.length < 3} style={{ flex: 1 }} />
            <Button title="Undo" variant="ghost" onPress={() => setDraft((d) => d.slice(0, -1))} disabled={!draft.length} />
          </Row>
        </Card>
        {zones.map((z) => (
          <Row key={z.id} style={{ justifyContent: 'space-between' }}>
            <T>{z.name}</T>
            <Button title="Remove" variant="ghost" onPress={() => setZones((all) => all.filter((x) => x.id !== z.id))} />
          </Row>
        ))}
        {error && <Banner tone="alert" text={error} />}
        <Button title="Save zones" onPress={save} loading={saving} />
      </View>
    </ScrollView>
  );
}
