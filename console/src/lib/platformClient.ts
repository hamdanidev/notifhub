import { DEFAULT_RETRY_OPTIONS, HttpTransport, type Paged } from '@notifhub/js';
import { API_BASE_URL } from '../env';
import { getPlatformToken } from './platformSession';

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

/**
 * Console-local transport for the platform lane.
 *
 * `@notifhub/js` is published and its AdminProfile/tenant client intentionally does not cover
 * platform endpoints yet. This follows the same pattern as `adminResend.ts`: reuse the SDK's
 * HttpTransport instead of raw fetch, and move the calls into the SDK at the next release.
 */
const transport = new HttpTransport(
  `${API_BASE_URL.replace(/\/+$/, '')}/api/v1/platform`,
  async () => getPlatformToken() ?? '',
  globalThis.fetch.bind(globalThis),
  DEFAULT_RETRY_OPTIONS,
);

export function loginPlatform(email: string, password: string): Promise<PlatformLoginResult> {
  return transport.request<PlatformLoginResult>('POST', '/auth/login', {
    auth: false,
    retry: false,
    body: { email, password },
  });
}

export function listTenants(query: TenantListQuery): Promise<Paged<TenantSummary>> {
  return transport.request<Paged<TenantSummary>>('GET', `/tenants${toQuery(query)}`);
}

export function getTenant(id: string): Promise<TenantSummary> {
  return transport.request<TenantSummary>('GET', `/tenants/${encodeURIComponent(id)}`);
}

export function createTenant(input: { id: string; name: string }): Promise<TenantSummary> {
  return transport.request<TenantSummary>('POST', '/tenants', { retry: false, body: input });
}

export function renameTenant(id: string, name: string): Promise<TenantSummary> {
  return transport.request<TenantSummary>('PATCH', `/tenants/${encodeURIComponent(id)}`, {
    retry: false,
    body: { name },
  });
}

export function suspendTenant(id: string): Promise<TenantSummary> {
  return transport.request<TenantSummary>(
    'POST',
    `/tenants/${encodeURIComponent(id)}/suspend`,
    { retry: false },
  );
}

export function resumeTenant(id: string): Promise<TenantSummary> {
  return transport.request<TenantSummary>(
    'POST',
    `/tenants/${encodeURIComponent(id)}/resume`,
    { retry: false },
  );
}

export function deleteTenant(id: string): Promise<void> {
  return transport.request<void>('DELETE', `/tenants/${encodeURIComponent(id)}`, {
    retry: false,
  });
}

export function listTenantAdmins(tenantId: string): Promise<TenantAdmin[]> {
  return transport.request<TenantAdmin[]>(
    'GET',
    `/tenants/${encodeURIComponent(tenantId)}/admins`,
  );
}

export function createTenantAdmin(
  tenantId: string,
  input: { email: string; password: string },
): Promise<TenantAdmin> {
  return transport.request<TenantAdmin>(
    'POST',
    `/tenants/${encodeURIComponent(tenantId)}/admins`,
    { retry: false, body: input },
  );
}

export function updateTenantAdmin(
  tenantId: string,
  adminId: string,
  input: { password?: string; active?: boolean },
): Promise<TenantAdmin> {
  return transport.request<TenantAdmin>(
    'PATCH',
    `/tenants/${encodeURIComponent(tenantId)}/admins/${encodeURIComponent(adminId)}`,
    { retry: false, body: input },
  );
}

export function listAuditEvents(query: AuditListQuery): Promise<Paged<PlatformAuditEvent>> {
  return transport.request<Paged<PlatformAuditEvent>>('GET', `/audit${toQuery(query)}`);
}

function toQuery(query: object): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if ((typeof value === 'string' || typeof value === 'number') && value !== '') {
      params.set(key, String(value));
    }
  }

  const serialized = params.toString();

  return serialized.length > 0 ? `?${serialized}` : '';
}
