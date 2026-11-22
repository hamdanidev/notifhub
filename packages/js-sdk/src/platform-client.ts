import type { NotifHubAdminClientOptions } from './admin-types';
import { DEFAULT_RETRY_OPTIONS, HttpTransport } from './http';
import type { RetryOptions } from './types';
import type {
  AuditListQuery,
  AuditListResult,
  PlatformLoginResult,
  TenantAdmin,
  TenantListQuery,
  TenantListResult,
  TenantSummary,
} from './platform-types';

const PLATFORM_PREFIX = '/api/v1/platform';

/**
 * Client for the platform lane (`/api/v1/platform`): platform login, tenant provisioning,
 * tenant admin management, and platform audit.
 *
 * It is a separate client because the platform lane uses its own JWT and base path; the
 * `getToken` callback must return the platform token, not the tenant admin token.
 */
export class NotifHubPlatformClient {
  private readonly transport: HttpTransport;

  constructor(options: NotifHubAdminClientOptions) {
    if (typeof options.baseUrl !== 'string' || options.baseUrl.length === 0) {
      throw new TypeError('NotifHubPlatformClient: baseUrl is required');
    }

    if (typeof options.getToken !== 'function') {
      throw new TypeError('NotifHubPlatformClient: getToken is required');
    }

    const fetchImpl = options.fetch ?? globalThis.fetch;

    if (typeof fetchImpl !== 'function') {
      throw new TypeError(
        'NotifHubPlatformClient: fetch is not available; provide options.fetch',
      );
    }

    const baseUrl = options.baseUrl.replace(/\/+$/, '');
    const retry: RetryOptions = { ...DEFAULT_RETRY_OPTIONS, ...options.retry };

    this.transport = new HttpTransport(
      `${baseUrl}${PLATFORM_PREFIX}`,
      async () => (await options.getToken()) ?? '',
      fetchImpl.bind(globalThis),
      retry,
      options.logger,
    );
  }

  login(email: string, password: string): Promise<PlatformLoginResult> {
    return this.transport.request<PlatformLoginResult>('POST', '/auth/login', {
      auth: false,
      retry: false,
      body: { email, password },
    });
  }

  listTenants(query: TenantListQuery = {}): Promise<TenantListResult> {
    return this.transport.request<TenantListResult>(
      'GET',
      `/tenants${queryString({
        status: query.status,
        q: query.q,
        limit: query.limit,
        offset: query.offset,
      })}`,
    );
  }

  getTenant(id: string): Promise<TenantSummary> {
    return this.transport.request<TenantSummary>(
      'GET',
      `/tenants/${encodeURIComponent(id)}`,
    );
  }

  renameTenant(id: string, name: string): Promise<TenantSummary> {
    return this.updateTenant(id, { name });
  }

  createTenant(input: { id: string; name: string }): Promise<TenantSummary> {
    return this.transport.request<TenantSummary>('POST', '/tenants', {
      retry: false,
      body: input,
    });
  }

  updateTenant(
    id: string,
    input: { name?: string; templateApprovalMode?: 'two_person' | 'self_approval_allowed' },
  ): Promise<TenantSummary> {
    return this.transport.request<TenantSummary>(
      'PATCH',
      `/tenants/${encodeURIComponent(id)}`,
      { retry: false, body: input },
    );
  }

  suspendTenant(id: string): Promise<TenantSummary> {
    return this.transport.request<TenantSummary>(
      'POST',
      `/tenants/${encodeURIComponent(id)}/suspend`,
      { retry: false },
    );
  }

  resumeTenant(id: string): Promise<TenantSummary> {
    return this.transport.request<TenantSummary>(
      'POST',
      `/tenants/${encodeURIComponent(id)}/resume`,
      { retry: false },
    );
  }

  deleteTenant(id: string): Promise<void> {
    return this.transport.request<void>('DELETE', `/tenants/${encodeURIComponent(id)}`, {
      retry: false,
    });
  }

  listTenantAdmins(tenantId: string): Promise<TenantAdmin[]> {
    return this.transport.request<TenantAdmin[]>(
      'GET',
      `/tenants/${encodeURIComponent(tenantId)}/admins`,
    );
  }

  createTenantAdmin(
    tenantId: string,
    input: {
      email: string;
      password: string;
      role?: 'tenant_admin' | 'tenant_approver';
    },
  ): Promise<TenantAdmin> {
    return this.transport.request<TenantAdmin>(
      'POST',
      `/tenants/${encodeURIComponent(tenantId)}/admins`,
      { retry: false, body: input },
    );
  }

  updateTenantAdmin(
    tenantId: string,
    adminId: string,
    input: { password?: string; active?: boolean },
  ): Promise<TenantAdmin> {
    return this.transport.request<TenantAdmin>(
      'PATCH',
      `/tenants/${encodeURIComponent(tenantId)}/admins/${encodeURIComponent(adminId)}`,
      { retry: false, body: input },
    );
  }

  listAuditEvents(query: AuditListQuery = {}): Promise<AuditListResult> {
    return this.transport.request<AuditListResult>(
      'GET',
      `/audit${queryString({
        tenantId: query.tenantId,
        action: query.action,
        from: query.from,
        to: query.to,
        limit: query.limit,
        offset: query.offset,
      })}`,
    );
  }
}

type QueryValue = string | number | boolean | undefined;

function queryString(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') {
      continue;
    }

    search.set(key, String(value));
  }

  const serialized = search.toString();

  return serialized.length > 0 ? `?${serialized}` : '';
}
