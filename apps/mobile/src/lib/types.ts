import type { CameraMount, PipelineFeatures, Severity, Zone } from '@lulu/core';

export type MemberRole = 'owner' | 'caregiver' | 'viewer';

export interface Household {
  id: string;
  name: string;
}

export interface Membership {
  household_id: string;
  user_id: string;
  role: MemberRole;
  display_name: string;
  min_push_severity: Severity;
  households?: Household | null;
}

export interface CameraSettings {
  mount?: CameraMount;
  position?: 'back' | 'front';
  features?: Partial<PipelineFeatures>;
}

export interface CameraStatus {
  battery?: number;
  charging?: boolean;
  analysis?: 'running' | 'paused_live' | 'starting' | 'error';
  models?: string;
  fps?: number;
  people?: number;
  appVersion?: string;
}

export interface CameraRow {
  id: string;
  household_id: string;
  name: string;
  zones: Zone[];
  settings: CameraSettings;
  status: CameraStatus;
  online: boolean;
  last_seen_at: string | null;
}

export interface EventRow {
  id: string;
  household_id: string;
  camera_id: string | null;
  client_id: string | null;
  type: string;
  severity: Severity;
  message: string;
  track: string | null;
  data: Record<string, unknown>;
  occurred_at: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
}

export type NewEventRow = Omit<EventRow, 'id' | 'acknowledged_at' | 'acknowledged_by'>;
