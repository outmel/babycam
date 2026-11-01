'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { LuluProvider, useLulu } from '@/lib/lulu';
import { isConfigured, supabase } from '@/lib/supabase';

import { Login } from './Login';
import { Onboarding } from './Onboarding';

const NAV = [
  { href: '/', label: 'Overview' },
  { href: '/sleep', label: 'Sleep log' },
  { href: '/history', label: 'History' },
  { href: '/family', label: 'Family' },
];

function Frame({ children }: { children: ReactNode }) {
  const { ready, session, memberships, householdId, setHouseholdId } = useLulu();
  const path = usePathname();

  if (!isConfigured) {
    return (
      <div className="mx-auto mt-16 max-w-lg px-4">
        <h1 className="text-2xl font-bold">Lulu dashboard</h1>
        <p className="mt-3 text-muted">
          Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> (see <code>apps/web/.env.example</code>) and restart.
        </p>
      </div>
    );
  }
  if (!ready) return null;
  if (!session) return <Login />;
  if (!memberships.length) return <Onboarding />;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 py-5">
        <Link href="/" className="text-xl font-bold tracking-tight">
          Lulu
        </Link>
        <nav className="flex flex-wrap gap-1">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${path === n.href ? 'bg-surface-alt text-ink' : 'text-muted hover:text-ink'}`}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          {memberships.length > 1 && (
            <select
              aria-label="Family"
              className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
              value={householdId ?? ''}
              onChange={(e) => setHouseholdId(e.target.value)}>
              {memberships.map((m) => (
                <option key={m.household_id} value={m.household_id}>
                  {m.households?.name}
                </option>
              ))}
            </select>
          )}
          <button className="text-sm text-muted hover:text-ink" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      </header>
      <main>{children}</main>
      <footer className="mt-12 text-xs text-muted">
        Lulu is an awareness tool, not a medical device. It does not monitor breathing or prevent SIDS, and it doesn&apos;t replace direct supervision.
      </footer>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <LuluProvider>
      <Frame>{children}</Frame>
    </LuluProvider>
  );
}
