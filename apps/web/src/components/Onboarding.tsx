'use client';

import { useState } from 'react';

import { useLulu } from '@/lib/lulu';
import { supabase } from '@/lib/supabase';

import { Button, Card } from './ui';

const INPUT = 'rounded-xl border border-line bg-bg px-3 py-2 text-base';

export function Onboarding() {
  const { refreshMemberships, setHouseholdId } = useLulu();
  const [yourName, setYourName] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (kind: 'create' | 'join') => {
    setBusy(kind);
    setError(null);
    const { data, error } =
      kind === 'create'
        ? await supabase.rpc('create_household', { p_name: name.trim(), p_display_name: yourName.trim() })
        : await supabase.rpc('redeem_invite', { p_code: code.trim(), p_display_name: yourName.trim() });
    setBusy(null);
    if (error) return setError(error.message);
    setHouseholdId(data as string);
    await refreshMemberships();
  };

  return (
    <div className="mx-auto mt-16 max-w-lg px-4">
      <h1 className="text-2xl font-bold">Set up your family</h1>
      <p className="mt-3 text-muted">Lulu groups cameras and caregivers into a family. Everyone in it gets alerts and sees the same history.</p>

      <label className="mt-6 flex flex-col gap-1 text-sm font-medium">
        Your name
        <input className={INPUT} value={yourName} onChange={(e) => setYourName(e.target.value)} placeholder="e.g. Sam" maxLength={60} />
      </label>

      <Card className="mt-6">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run('create');
          }}>
          <h2 className="text-lg font-semibold">Start a new family</h2>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Family name
            <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. The Garcias" maxLength={80} />
          </label>
          <Button type="submit" disabled={!name.trim() || busy !== null}>
            {busy === 'create' ? 'Creating…' : 'Create family'}
          </Button>
        </form>
      </Card>

      <Card className="mt-4">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run('join');
          }}>
          <h2 className="text-lg font-semibold">Join with an invite code</h2>
          <p className="text-sm text-muted">Ask the family owner to create a code under Family.</p>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Invite code
            <input className={`${INPUT} uppercase tracking-widest`} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="8 letters" />
          </label>
          <Button type="submit" variant="ghost" disabled={code.trim().length < 8 || busy !== null}>
            {busy === 'join' ? 'Joining…' : 'Join family'}
          </Button>
        </form>
      </Card>

      {error && <p className="mt-4 text-sm text-alert">{error}</p>}
      <button className="mt-6 text-sm underline" onClick={() => supabase.auth.signOut()}>
        Sign out
      </button>
    </div>
  );
}
