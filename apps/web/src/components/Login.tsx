'use client';

import { useState } from 'react';

import { supabase } from '@/lib/supabase';

import { Button, Card } from './ui';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(error.message);
  };

  return (
    <div className="mx-auto mt-16 max-w-sm px-4">
      <h1 className="text-3xl font-bold tracking-tight">Lulu</h1>
      <p className="mt-2 text-muted">Sign in with the account you use in the Lulu app.</p>
      <Card className="mt-6">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Email
            <input className="rounded-xl border border-line bg-bg px-3 py-2 text-base" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Password
            <input className="rounded-xl border border-line bg-bg px-3 py-2 text-base" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          {error && <p className="text-sm text-alert">{error}</p>}
          <Button type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </Card>
      <p className="mt-6 text-xs text-muted">The dashboard only shows event text such as “Crying detected”. Lulu never stores video or audio.</p>
    </div>
  );
}
