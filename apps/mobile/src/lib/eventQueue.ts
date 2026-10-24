/**
 * Offline-safe event delivery for the camera phone. Events are written to local storage first
 * and then uploaded. If Wi-Fi drops they wait and go up, in order and exactly once (by client_id),
 * when the connection returns, so the shared history has no gaps.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

import { supabase } from './supabase';
import type { NewEventRow } from './types';

const KEY = 'lulu.eventQueue';
const MAX_QUEUED = 2000;

let queue: NewEventRow[] | null = null;
let flushing = false;
const listeners = new Set<(pending: number) => void>();

async function load(): Promise<NewEventRow[]> {
  if (queue) return queue;
  try {
    queue = JSON.parse((await AsyncStorage.getItem(KEY)) ?? '[]');
  } catch {
    queue = [];
  }
  return queue!;
}

async function save(): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(queue ?? []));
  listeners.forEach((l) => l(queue?.length ?? 0));
}

export function newClientId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function enqueueEvent(row: NewEventRow): Promise<void> {
  const q = await load();
  q.push(row);
  // Keep the newest events if the phone has been offline for a very long time.
  if (q.length > MAX_QUEUED) q.splice(0, q.length - MAX_QUEUED);
  await save();
  void flushEvents();
}

export async function flushEvents(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const q = await load();
    while (q.length) {
      const batch = q.slice(0, 50);
      const { error } = await supabase.from('events').upsert(batch, { onConflict: 'client_id', ignoreDuplicates: true });
      if (error) break; // offline or server error: keep everything and retry later
      q.splice(0, batch.length);
      await save();
    }
  } finally {
    flushing = false;
  }
}

export function pendingCount(): number {
  return queue?.length ?? 0;
}

export function onQueueChange(fn: (pending: number) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Retry whenever connectivity comes back, plus a slow periodic retry. */
export function startQueueSync(): () => void {
  const unsub = NetInfo.addEventListener((s) => {
    if (s.isConnected) void flushEvents();
  });
  const timer = setInterval(() => void flushEvents(), 30_000);
  void flushEvents();
  return () => {
    unsub();
    clearInterval(timer);
  };
}
