import { describe, expect, it, vi } from 'vitest';
import { NotifHubPlatformClient } from '../src/platform-client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createClient(
  fetchImpl: typeof fetch,
  token: string | undefined = 'platform-token',
): NotifHubPlatformClient {
  return new NotifHubPlatformClient({
    baseUrl: 'http://localhost:3000/',
    getToken: () => token,
    fetch: fetchImpl,
    retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 },
  });
}

const tenant = {
  id: 'acme',
  name: 'Acme',
  status: 'active',
  suspendedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  adminCount: 1,
  apiKeyCount: 0,
};

describe('NotifHubPlatformClient', () => {
  it('logs in without an Authorization header and without retrying', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        accessToken: 'jwt',
        tokenType: 'Bearer',
        expiresIn: 3600,
        admin: { id: 'p1', email: 'platform@example.com', role: 'platform_admin' },
      }),
    );

    const client = createClient(fetchMock as unknown as typeof fetch);
    const result = await client.login('platform@example.com', 'secret');

    expect(result.accessToken).toBe('jwt');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;

    expect(url).toBe('http://localhost:3000/api/v1/platform/auth/login');
    expect(headers.Authorization).toBeUndefined();
    expect(JSON.parse(String(init.body))).toEqual({
      email: 'platform@example.com',
      password: 'secret',
    });
  });

  it('builds tenant list queries with the platform token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ items: [tenant], total: 1, limit: 10, offset: 0 }));

    const client = createClient(fetchMock as unknown as typeof fetch);
    await client.listTenants({ status: 'suspended', q: 'acme', limit: 10, offset: 5 });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;

    expect(url).toBe(
      'http://localhost:3000/api/v1/platform/tenants?status=suspended&q=acme&limit=10&offset=5',
    );
    expect(headers.Authorization).toBe('Bearer platform-token');
  });

  it('does not retry tenant mutations', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ message: 'tenant exists' }, 409));

    const client = createClient(fetchMock as unknown as typeof fetch);

    await expect(client.createTenant({ id: 'acme', name: 'Acme' })).rejects.toMatchObject({
      status: 409,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends suspend, resume, rename, and delete to the expected paths', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(tenant))
      .mockResolvedValueOnce(jsonResponse(tenant))
      .mockResolvedValueOnce(jsonResponse(tenant))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const client = createClient(fetchMock as unknown as typeof fetch);

    await client.suspendTenant('acme');
    await client.resumeTenant('acme');
    await client.renameTenant('acme', 'Acme Baru');
    await client.deleteTenant('acme');

    const calls = fetchMock.mock.calls as Array<[string, RequestInit]>;

    expect(calls[0]?.[0]).toBe('http://localhost:3000/api/v1/platform/tenants/acme/suspend');
    expect(calls[0]?.[1].method).toBe('POST');
    expect(calls[1]?.[0]).toBe('http://localhost:3000/api/v1/platform/tenants/acme/resume');
    expect(calls[2]?.[0]).toBe('http://localhost:3000/api/v1/platform/tenants/acme');
    expect(calls[2]?.[1].method).toBe('PATCH');
    expect(JSON.parse(String(calls[2]?.[1].body))).toEqual({ name: 'Acme Baru' });
    expect(calls[3]?.[0]).toBe('http://localhost:3000/api/v1/platform/tenants/acme');
    expect(calls[3]?.[1].method).toBe('DELETE');
  });

  it('builds admin and audit paths', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'a1',
          email: 'tenant@example.com',
          role: 'tenant_admin',
          active: true,
          lastLoginAt: null,
          createdAt: '2026-01-01T00:00:00.000Z',
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ items: [], total: 0, limit: 50, offset: 0 }));

    const client = createClient(fetchMock as unknown as typeof fetch);

    await client.listTenantAdmins('acme');
    await client.createTenantAdmin('acme', {
      email: 'tenant@example.com',
      password: 'secret-password',
    });
    await client.listAuditEvents({ tenantId: 'acme', action: 'platform.tenant.created' });

    const calls = fetchMock.mock.calls as Array<[string, RequestInit]>;

    expect(calls[0]?.[0]).toBe('http://localhost:3000/api/v1/platform/tenants/acme/admins');
    expect(calls[1]?.[0]).toBe('http://localhost:3000/api/v1/platform/tenants/acme/admins');
    expect(calls[1]?.[1].method).toBe('POST');
    expect(calls[2]?.[0]).toBe(
      'http://localhost:3000/api/v1/platform/audit?tenantId=acme&action=platform.tenant.created',
    );
  });
});
