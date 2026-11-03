'use client';

import { useCallback, useEffect, useState } from 'react';

import { Button, Card, Label } from '@/components/ui';
import { useLulu } from '@/lib/lulu';
import { supabase, type MemberRole, type Membership } from '@/lib/supabase';

interface Invite {
  id: string;
  code: string;
  role: MemberRole;
  expires_at: string;
  redeemed_at: string | null;
}

const ROLE_INFO: Record<MemberRole, string> = {
  owner: 'Manages the family, cameras and invites',
  caregiver: 'Live view and alerts, can run a camera',
  viewer: 'Alerts and history only, no live video',
};

export default function Family() {
  const { householdId, membership, session } = useLulu();
  const isOwner = membership?.role === 'owner';
  const [members, setMembers] = useState<Membership[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [role, setRole] = useState<'caregiver' | 'viewer'>('caregiver');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!householdId) return;
    const [m, i] = await Promise.all([
      supabase.from('household_members').select('*').eq('household_id', householdId).order('joined_at'),
      supabase.from('invites').select('id, code, role, expires_at, redeemed_at').eq('household_id', householdId).order('created_at', { ascending: false }),
    ]);
    setMembers((m.data ?? []) as Membership[]);
    setInvites((i.data ?? []) as Invite[]);
  }, [householdId]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (p: PromiseLike<{ error: { message: string } | null }>) => {
    setError(null);
    const { error } = await p;
    if (error) setError(error.message);
    await load();
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight">{membership?.households?.name}</h1>
      <Card>
        <Label>Caregivers</Label>
        <ul className="mt-3 divide-y divide-line">
          {members.map((m) => (
            <li key={m.user_id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-48">
                <p className="font-medium">
                  {m.display_name || 'Caregiver'}
                  {m.user_id === session?.user.id && ' (you)'}
                </p>
                <p className="text-sm text-muted">{ROLE_INFO[m.role]}</p>
              </div>
              {isOwner && m.user_id !== session?.user.id ? (
                <div className="ml-auto flex items-center gap-2">
                  <select
                    aria-label={`Role for ${m.display_name}`}
                    className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
                    value={m.role}
                    onChange={(e) => run(supabase.rpc('set_member_role', { p_household: householdId, p_user: m.user_id, p_role: e.target.value }))}>
                    <option value="owner">Owner</option>
                    <option value="caregiver">Caregiver</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  <Button variant="ghost" onClick={() => run(supabase.from('household_members').delete().eq('household_id', householdId!).eq('user_id', m.user_id))}>
                    Remove
                  </Button>
                </div>
              ) : (
                <span className="ml-auto text-sm capitalize text-muted">{m.role}</span>
              )}
            </li>
          ))}
        </ul>
      </Card>

      {isOwner && (
        <Card>
          <Label>Invite someone</Label>
          <p className="mt-2 text-sm text-muted">They enter the code in the Lulu app under “Join with an invite code”. Codes expire after 7 days.</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <select aria-label="Role" className="rounded-lg border border-line bg-surface px-2 py-2 text-sm" value={role} onChange={(e) => setRole(e.target.value as 'caregiver' | 'viewer')}>
              <option value="caregiver">Caregiver</option>
              <option value="viewer">Viewer</option>
            </select>
            <Button onClick={() => run(supabase.rpc('create_invite', { p_household: householdId, p_role: role }))}>Create invite code</Button>
          </div>
          {invites.length > 0 && (
            <ul className="mt-4 divide-y divide-line border-t border-line text-sm">
              {invites.map((i) => {
                const expired = new Date(i.expires_at) < new Date();
                return (
                  <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
                    <span className="font-mono tracking-widest">{i.code}</span>
                    <span className="capitalize">{i.role}</span>
                    <span className="text-muted">{i.redeemed_at ? 'Used' : expired ? 'Expired' : `Valid until ${new Date(i.expires_at).toLocaleDateString()}`}</span>
                    {!i.redeemed_at && !expired && (
                      <button className="ml-auto text-xs font-semibold text-accent" onClick={() => run(supabase.from('invites').delete().eq('id', i.id))}>
                        Revoke
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}
      {error && <p className="text-sm text-alert">{error}</p>}
    </div>
  );
}
