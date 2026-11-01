'use client';

import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { supabase, type CameraRow, type EventRow, type Membership } from './supabase';

interface LuluState {
  ready: boolean;
  session: Session | null;
  memberships: Membership[];
  householdId: string | null;
  membership: Membership | null;
  setHouseholdId: (id: string) => void;
  refreshMemberships: () => Promise<void>;
}

const Ctx = createContext<LuluState | null>(null);
const KEY = 'lulu.household';

// supabase.channel() returns an existing channel with the same topic, which throws if it's already
// subscribed, so each subscription gets its own topic.
let channelSeq = 0;
const topic = (name: string) => `${name}:${++channelSeq}`;

function readStored(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function LuluProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [householdId, setHousehold] = useState<string | null>(null);

  const refreshMemberships = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return setMemberships([]);
    const { data } = await supabase
      .from('household_members')
      .select('household_id, user_id, role, display_name, min_push_severity, households(id, name)')
      .eq('user_id', auth.user.id);
    const list = (data ?? []) as unknown as Membership[];
    setMemberships(list);
    setHousehold((cur) => {
      const stored = cur ?? readStored();
      return stored && list.some((m) => m.household_id === stored) ? stored : (list[0]?.household_id ?? null);
    });
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session) await refreshMemberships();
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s) void refreshMemberships();
      else setMemberships([]);
    });
    return () => sub.subscription.unsubscribe();
  }, [refreshMemberships]);

  const value = useMemo<LuluState>(
    () => ({
      ready,
      session,
      memberships,
      householdId,
      membership: memberships.find((m) => m.household_id === householdId) ?? null,
      setHouseholdId: (id) => {
        setHousehold(id);
        try {
          localStorage.setItem(KEY, id);
        } catch {
          // Private mode: the choice just isn't remembered.
        }
      },
      refreshMemberships,
    }),
    [ready, session, memberships, householdId, refreshMemberships],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLulu(): LuluState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLulu outside LuluProvider');
  return v;
}

export function useCameras(householdId: string | null) {
  const [cameras, setCameras] = useState<CameraRow[]>([]);
  const load = useCallback(async () => {
    if (!householdId) return;
    const { data } = await supabase.from('cameras').select('*').eq('household_id', householdId).order('created_at');
    setCameras((data ?? []) as CameraRow[]);
  }, [householdId]);
  useEffect(() => {
    if (!householdId) return;
    void load();
    const ch = supabase
      .channel(topic(`web-cameras:${householdId}`))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cameras', filter: `household_id=eq.${householdId}` }, () => void load())
      .subscribe();
    // Re-render "last seen" times even when nothing changes.
    const tick = setInterval(() => setCameras((c) => [...c]), 30_000);
    return () => {
      clearInterval(tick);
      void supabase.removeChannel(ch);
    };
  }, [householdId, load]);
  return cameras;
}

/** Events since `sinceDays` days ago, live-updated. */
export function useEvents(householdId: string | null, sinceDays: number) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!householdId) return;
    const since = new Date(Date.now() - sinceDays * 86400_000).toISOString();
    const { data } = await supabase
      .from('events')
      .select('*')
      .eq('household_id', householdId)
      .gte('occurred_at', since)
      .order('occurred_at', { ascending: false })
      .limit(5000);
    setEvents((data ?? []) as EventRow[]);
    setLoading(false);
  }, [householdId, sinceDays]);
  useEffect(() => {
    if (!householdId) return;
    void load();
    const ch = supabase
      .channel(topic(`web-events:${householdId}:${sinceDays}`))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events', filter: `household_id=eq.${householdId}` }, () => void load())
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [householdId, sinceDays, load]);
  return { events, loading, reload: load };
}

export function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}
