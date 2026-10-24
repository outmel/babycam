import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { supabase } from './supabase';
import type { Membership } from './types';

export type AppMode = 'camera' | 'parent';

interface SessionState {
  ready: boolean;
  session: Session | null;
  memberships: Membership[];
  householdId: string | null;
  membership: Membership | null;
  mode: AppMode | null;
  setHousehold: (id: string) => Promise<void>;
  setMode: (mode: AppMode | null) => Promise<void>;
  refreshMemberships: () => Promise<Membership[]>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<SessionState | null>(null);
const HOUSEHOLD_KEY = 'lulu.household';
const MODE_KEY = 'lulu.mode';

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [mode, setModeState] = useState<AppMode | null>(null);

  const refreshMemberships = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      setMemberships([]);
      return [];
    }
    const { data } = await supabase
      .from('household_members')
      .select('household_id, user_id, role, display_name, min_push_severity, households(id, name)')
      .eq('user_id', auth.user.id);
    const list = (data ?? []) as unknown as Membership[];
    setMemberships(list);
    setHouseholdId((current) => {
      if (current && list.some((m) => m.household_id === current)) return current;
      return list[0]?.household_id ?? null;
    });
    return list;
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [{ data }, savedHousehold, savedMode] = await Promise.all([
        supabase.auth.getSession(),
        AsyncStorage.getItem(HOUSEHOLD_KEY),
        AsyncStorage.getItem(MODE_KEY),
      ]);
      if (!mounted) return;
      setSession(data.session);
      setHouseholdId(savedHousehold);
      setModeState((savedMode as AppMode | null) ?? null);
      if (data.session) await refreshMemberships();
      setReady(true);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (s) refreshMemberships();
      else setMemberships([]);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [refreshMemberships]);

  const value = useMemo<SessionState>(
    () => ({
      ready,
      session,
      memberships,
      householdId,
      membership: memberships.find((m) => m.household_id === householdId) ?? null,
      mode,
      setHousehold: async (id) => {
        setHouseholdId(id);
        await AsyncStorage.setItem(HOUSEHOLD_KEY, id);
      },
      setMode: async (m) => {
        setModeState(m);
        if (m) await AsyncStorage.setItem(MODE_KEY, m);
        else await AsyncStorage.removeItem(MODE_KEY);
      },
      refreshMemberships,
      signOut: async () => {
        await supabase.auth.signOut();
        await AsyncStorage.multiRemove([HOUSEHOLD_KEY, MODE_KEY]);
        setModeState(null);
        setHouseholdId(null);
      },
    }),
    [ready, session, memberships, householdId, mode, refreshMemberships],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession must be used inside SessionProvider');
  return v;
}
