import { describe, expect, it, vi } from 'vitest';
import { NotifHubAdminClient } from '../src/admin-client';
import { NotifHubError } from '../src/errors';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createClient(fetchImpl: typeof fetch, token = 'admin-token'): NotifHubAdminClient {
  return new NotifHubAdminClient({
    baseUrl: 'http://localhost:3000',
    getToken: () => token,
    fetch: fetchImpl,
    retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 },
  });
}

describe('NotifHubAdminClient', () => {
  it('logs in without an Authorization header and without retrying', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        accessToken: 'jwt',
        tokenType: 'Bearer',
        expiresIn: 3600,
        admin: { id: 'a1', email: 'admin@example.com', role: 'tenant_admin', tenantId: 'default' },
      }),
    );

    const client = createClient(fetchMock as unknown as typeof fetch);
    const result = await client.login('admin@example.com', 'secret-password');

    expect(result.accessToken).toBe('jwt');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;

    expect(url).toBe('http://localhost:3000/api/v1/admin/auth/login');
    expect(init.method).toBe('POST');
    expect(headers.Authorization).toBeUndefined();
    expect(JSON.parse(String(init.body))).toEqual({
      email: 'admin@example.com',
      password: 'secret-password',
    });
  });

  it('builds list queries with the admin bearer token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ items: [], total: 0, limit: 10, offset: 20 }));

    const client = createClient(fetchMock as unknown as typeof fetch);
    await client.listTemplates({ limit: 10, offset: 20, channel: 'email', active: true });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;

    expect(url).toBe(
      'http://localhost:3000/api/v1/admin/templates?limit=10&offset=20&channel=email&active=true',
    );
    expect(headers.Authorization).toBe('Bearer admin-token');
  });

  it('does not retry non-idempotent mutations', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ message: 'boom' }, 500));

    const client = createClient(fetchMock as unknown as typeof fetch);

    await expect(client.createApiKey({ name: 'console-key' })).rejects.toMatchObject({
      code: 'server_error',
      status: 500,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps 404 responses to a typed not_found error', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ message: 'Notification not found' }, 404));

    const client = createClient(fetchMock as unknown as typeof fetch);
    const error = await client.getNotification('missing').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NotifHubError);
    expect((error as NotifHubError).code).toBe('not_found');
    expect((error as NotifHubError).retryable).toBe(false);
  });
});
