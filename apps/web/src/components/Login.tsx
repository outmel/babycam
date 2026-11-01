'use client';

import { useState } from 'react';

import { supabase } from '@/lib/supabase';

import { Button, Card } from './ui';

export function Login() {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<{ tone: 'alert' | 'ok'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const creds = { email: email.trim(), password };
    const { data, error } = mode === 'in' ? await supabase.auth.signInWithPassword(creds) : await supabase.auth.signUp(creds);
    setBusy(false);
    if (error) return setMessage({ tone: 'alert', text: error.message });
    if (!data.session) setMessage({ tone: 'ok', text: 'Check your email to confirm your account, then sign in.' });
  };

  const tab = (value: 'in' | 'up', label: string) => (
    <button
      type="button"
      onClick={() => {
        setMode(value);
        setMessage(null);
      }}
      className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold ${mode === value ? 'bg-surface text-ink' : 'text-muted hover:text-ink'}`}>
      {label}
    </button>
  );

  return (
    <div className="mx-auto mt-16 max-w-sm px-4">
      <h1 className="text-3xl font-bold tracking-tight">Lulu</h1>
      <p className="mt-2 text-muted">
        {mode === 'in' ? 'Sign in with the account you use in the Lulu app.' : 'Create an account. Use the same one on your phones.'}
      </p>
      <Card className="mt-6">
        <div className="mb-4 flex gap-1 rounded-xl bg-surface-alt p-1">
          {tab('in', 'Sign in')}
          {tab('up', 'Create account')}
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Email
            <input className="rounded-xl border border-line bg-bg px-3 py-2 text-base" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Password
            <input
              className="rounded-xl border border-line bg-bg px-3 py-2 text-base"
              type="password"
              autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {message && <p className={`text-sm ${message.tone === 'alert' ? 'text-alert' : 'text-ok'}`}>{message.text}</p>}
          <Button type="submit" disabled={busy}>
            {mode === 'in' ? (busy ? 'Signing in…' : 'Sign in') : busy ? 'Creating account…' : 'Create account'}
          </Button>
        </form>
      </Card>
      <p className="mt-6 text-xs text-muted">The dashboard only shows event text such as “Crying detected”. Lulu never stores video or audio.</p>
    </div>
  );
}
