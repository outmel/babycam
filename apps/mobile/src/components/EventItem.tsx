import { eventTitle } from '@lulu/core';
import { Pressable, StyleSheet, View } from 'react-native';

import { T } from '@/components/ui';
import { severityColor, Space, useTheme } from '@/constants/theme';
import { clockTime } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';
import type { EventRow } from '@/lib/types';

export function EventItem({ event, cameraName }: { event: EventRow; cameraName?: string }) {
  const t = useTheme();
  const needsAck = event.severity === 'alert' && !event.acknowledged_at;
  return (
    <View style={[styles.row, { borderColor: t.border }]}>
      <View style={[styles.bar, { backgroundColor: severityColor(t, event.severity) }]} />
      <View style={{ flex: 1, gap: 2 }}>
        <T variant="heading" style={{ fontSize: 16 }}>
          {eventTitle(event.type)}
        </T>
        <T variant="muted">{event.message}</T>
        <T variant="small">
          {clockTime(event.occurred_at)}
          {cameraName ? ` · ${cameraName}` : ''}
          {event.acknowledged_at ? ' · seen' : ''}
        </T>
      </View>
      {needsAck && (
        <Pressable
          onPress={() => supabase.rpc('acknowledge_event', { p_event: event.id })}
          style={[styles.ack, { borderColor: t.border }]}
          accessibilityLabel="Mark as seen">
          <T variant="small" style={{ color: t.text }}>
            Seen
          </T>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Space.md, paddingVertical: Space.md, borderBottomWidth: StyleSheet.hairlineWidth, alignItems: 'center' },
  bar: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
  ack: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
});
