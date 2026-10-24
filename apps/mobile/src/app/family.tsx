import { useCallback, useEffect, useState } from 'react';
import { Share } from 'react-native';

import { Banner, Button, Card, Row, Screen, Segmented, T } from '@/components/ui';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import type { MemberRole, Membership } from '@/lib/types';

const ROLE_INFO: Record<MemberRole, string> = {
  owner: 'Manages the family, cameras and invites',
  caregiver: 'Live view, alerts, can run a camera',
  viewer: 'Alerts and history only, no live video',
};

export default function Family() {
  const { householdId, membership, session } = useSession();
  const isOwner = membership?.role === 'owner';
  const [members, setMembers] = useState<Membership[]>([]);
  const [role, setRole] = useState<'caregiver' | 'viewer'>('caregiver');
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!householdId) return;
    const { data } = await supabase.from('household_members').select('*').eq('household_id', householdId).order('joined_at');
    setMembers((data ?? []) as Membership[]);
  }, [householdId]);

  useEffect(() => {
    void load();
  }, [load]);

  const invite = async () => {
    setError(null);
    const { data, error } = await supabase.rpc('create_invite', { p_household: householdId, p_role: role });
    if (error) return setError(error.message);
    setCode(data as string);
    await Share.share({
      message: `Join our family on Lulu so you get alerts from the baby monitor. Open Lulu, choose "Join with an invite code" and enter ${data}. The code works for 7 days.`,
    });
  };

  const changeRole = async (m: Membership, r: MemberRole) => {
    const { error } = await supabase.rpc('set_member_role', { p_household: householdId, p_user: m.user_id, p_role: r });
    if (error) setError(error.message);
    await load();
  };

  const remove = async (m: Membership) => {
    const { error } = await supabase.from('household_members').delete().eq('household_id', householdId!).eq('user_id', m.user_id);
    if (error) setError(error.message);
    await load();
  };

  return (
    <Screen>
      <T variant="heading">{membership?.households?.name}</T>
      {members.map((m) => (
        <Card key={m.user_id}>
          <Row style={{ justifyContent: 'space-between' }}>
            <T variant="heading">{m.display_name || 'Caregiver'}{m.user_id === session?.user.id ? ' (you)' : ''}</T>
            <T variant="small">{m.role}</T>
          </Row>
          <T variant="small">{ROLE_INFO[m.role]}</T>
          {isOwner && m.user_id !== session?.user.id && (
            <Row style={{ flexWrap: 'wrap' }}>
              {(['owner', 'caregiver', 'viewer'] as MemberRole[]).filter((r) => r !== m.role).map((r) => (
                <Button key={r} title={`Make ${r}`} variant="ghost" onPress={() => changeRole(m, r)} />
              ))}
              <Button title="Remove" variant="ghost" onPress={() => remove(m)} />
            </Row>
          )}
        </Card>
      ))}

      {isOwner ? (
        <Card>
          <T variant="heading">Invite a grandparent, babysitter or co-parent</T>
          <Segmented value={role} onChange={setRole} options={[{ value: 'caregiver', label: 'Caregiver' }, { value: 'viewer', label: 'Viewer' }]} />
          <T variant="small">{ROLE_INFO[role]}</T>
          <Button title="Create invite code" onPress={invite} />
          {code && <T variant="title" style={{ letterSpacing: 4, textAlign: 'center' }}>{code}</T>}
        </Card>
      ) : (
        <T variant="muted">Only the family owner can invite people.</T>
      )}
      {error && <Banner tone="alert" text={error} />}
    </Screen>
  );
}
