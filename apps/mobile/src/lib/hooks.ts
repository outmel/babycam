import { useCallback, useEffect, useState } from 'react';

import { supabase } from './supabase';
import type { CameraRow, EventRow } from './types';

/** Cameras in a household, kept live via Supabase Realtime. */
export function useCameras(householdId: string | null) {
  const [cameras, setCameras] = useState<CameraRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!householdId) return;
    const { data } = await supabase.from('cameras').select('*').eq('household_id', householdId).order('created_at');
    setCameras((data ?? []) as CameraRow[]);
    setLoading(false);
  }, [householdId]);

  useEffect(() => {
    if (!householdId) return;
    void refresh();
    const ch = supabase
      .channel(`cameras:${householdId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cameras', filter: `household_id=eq.${householdId}` }, () => void refresh())
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [householdId, refresh]);

  return { cameras, loading, refresh };
}

/** Recent events for a household, newest first, with live inserts. */
export function useEvents(householdId: string | null, opts: { limit?: number; minSeverity?: 'info' | 'warning' } = {}) {
  const limit = opts.limit ?? 50;
  const minSeverity = opts.minSeverity ?? 'info';
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!householdId) return;
    let q = supabase.from('events').select('*').eq('household_id', householdId).order('occurred_at', { ascending: false }).limit(limit);
    if (minSeverity === 'warning') q = q.in('severity', ['warning', 'alert']);
    const { data } = await q;
    setEvents((data ?? []) as EventRow[]);
    setLoading(false);
  }, [householdId, limit, minSeverity]);

  useEffect(() => {
    if (!householdId) return;
    void refresh();
    const ch = supabase
      .channel(`events:${householdId}:${minSeverity}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events', filter: `household_id=eq.${householdId}` }, () => void refresh())
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [householdId, minSeverity, refresh]);

  return { events, loading, refresh };
}

export function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
