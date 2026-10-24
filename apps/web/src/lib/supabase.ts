import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const isConfigured = Boolean(url && anonKey);

// Browser-only client. Every query runs as the signed-in user, so row-level security
// limits each person to their own families' data.
export const supabase = createClient(url || 'http://localhost:54321', anonKey || 'missing-anon-key');

export type Severity = 'info' | 'warning' | 'alert';
export type MemberRole = 'owner' | 'caregiver' | 'viewer';

export interface Membership {
  household_id: string;
  user_id: string;
  role: MemberRole;
  display_name: string;
  min_push_severity: Severity;
  joined_at?: string;
  households?: { id: string; name: string } | null;
}

export interface CameraRow {
  id: string;
  household_id: string;
  name: string;
  zones: unknown[];
  settings: { mount?: string };
  status: { battery?: number; charging?: boolean; analysis?: string; fps?: number; models?: string };
  online: boolean;
  last_seen_at: string | null;
}

export interface EventRow {
  id: string;
  household_id: string;
  camera_id: string | null;
  type: string;
  severity: Severity;
  message: string;
  track: string | null;
  data: Record<string, unknown>;
  occurred_at: string;
  acknowledged_at: string | null;
}
