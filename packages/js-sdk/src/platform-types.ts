import type { Paged } from './admin-types';

export type TenantStatus = 'active' | 'suspended';

export interface TenantSummary {
  id: string;
  name: string;
  status: TenantStatus;
  suspendedAt: string | null;
  createdAt: string;
  updatedAt: string;
  adminCount: number;
  apiKeyCount: number;
}

export interface TenantAdmin {
  id: string;
  email: string;
  role: string;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface PlatformAuditEvent {
  id: string;
  actorAdminId: string;
  actorEmail: string;
  action: string;
  tenantId: string | null;
  targetType: string;
  targetId: string;
  metadata: unknown;
  ip: string | null;
  requestId: string | null;
  occurredAt: string;
}

export interface PlatformLoginResult {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  admin: { id: string; email: string; role: string };
}

export interface TenantListQuery {
  status?: TenantStatus;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface AuditListQuery {
  tenantId?: string;
  action?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export type TenantListResult = Paged<TenantSummary>;
export type AuditListResult = Paged<PlatformAuditEvent>;
