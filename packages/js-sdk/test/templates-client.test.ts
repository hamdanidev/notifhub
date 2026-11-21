import { describe, expect, it, vi } from 'vitest';
import { NotifHubError } from '../src/errors';
import { NotifHubTemplatesClient } from '../src/templates-client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createClient(
  fetchImpl: typeof fetch,
  token: string | undefined = 'admin-token',
): NotifHubTemplatesClient {
  return new NotifHubTemplatesClient({
    baseUrl: 'http://localhost:3000',
    getToken: () => token,
    fetch: fetchImpl,
    retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 },
  });
}

const template = {
  id: 't1',
  tenantId: 'default',
  key: 'order.shipped',
  channel: 'email',
  locale: 'id',
  subject: 'Pesanan dikirim',
  preheader: null,
  body: '<p>Halo</p>',
  bodyPreview: 'Halo',
  format: 'html',
  direction: 'auto',
  version: 1,
  revision: 2,
  status: 'published',
  active: true,
  strictVariables: false,
  variables: {},
  sampleData: {},
  builderData: null,
  layoutId: null,
  themeId: null,
  partialIds: [],
  layout: null,
  theme: null,
  fallbackProvider: null,
  fallbackChannel: null,
  publishedAt: null,
  publishedByAdminId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('NotifHubTemplatesClient', () => {
  it('builds the list query with auth and summary view', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ items: [template], total: 1, limit: 20, offset: 0 }));

    const client = createClient(fetchMock as unknown as typeof fetch);
    const result = await client.listTemplates({
      search: 'order',
      channel: 'email',
      status: 'published',
      limit: 20,
      offset: 0,
    });

    expect(result.items[0]?.key).toBe('order.shipped');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;

    expect(url).toBe(
      'http://localhost:3000/api/v1/admin/templates?search=order&channel=email&status=published&limit=20&offset=0&view=summary',
    );
    expect(headers.Authorization).toBe('Bearer admin-token');
  });

  it('publishes with expectedRevision and does not retry mutations', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ message: 'template changed' }, 409));

    const client = createClient(fetchMock as unknown as typeof fetch);

    await expect(client.publishTemplate('t/1', 7, 'rilis')).rejects.toMatchObject({
      status: 409,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3000/api/v1/admin/templates/t%2F1/publish');
    expect(JSON.parse(String(init.body))).toEqual({ expectedRevision: 7, note: 'rilis' });
  });

  it('requests latest layout/theme/partial assets', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async () =>
        jsonResponse({ items: [], total: 0, limit: 50, offset: 0 }),
      );

    const client = createClient(fetchMock as unknown as typeof fetch);
    await client.listLayouts({ limit: 10 });
    await client.listThemes({ offset: 5 });
    await client.listPartials();

    const urls = fetchMock.mock.calls.map((call) => (call as [string])[0]);

    expect(urls[0]).toBe(
      'http://localhost:3000/api/v1/admin/template-assets/layouts?latest=true&limit=10',
    );
    expect(urls[1]).toBe(
      'http://localhost:3000/api/v1/admin/template-assets/themes?latest=true&offset=5',
    );
    expect(urls[2]).toBe(
      'http://localhost:3000/api/v1/admin/template-assets/partials?latest=true',
    );
  });

  it('uploads a template image as multipart without a JSON content type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: 'img1',
        url: 'http://localhost:3000/api/v1/template-images/img1',
        mimeType: 'image/png',
        width: 10,
        height: 10,
        size: 128,
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    );

    const client = createClient(fetchMock as unknown as typeof fetch);
    const result = await client.uploadTemplateImage(
      new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
    );

    expect(result.id).toBe('img1');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;

    expect(url).toBe('http://localhost:3000/api/v1/admin/template-assets/images');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect(headers.Authorization).toBe('Bearer admin-token');
    expect(headers['Content-Type']).toBeUndefined();
  });

  it('maps upload failures to a typed NotifHubError', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ message: 'Sesi admin tidak valid' }, 401));

    const client = createClient(fetchMock as unknown as typeof fetch);

    await expect(
      client.uploadTemplateImage(new Blob(['x'], { type: 'image/png' })),
    ).rejects.toMatchObject({ code: 'unauthorized', status: 401 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects upload without a token before calling fetch', async () => {
    const fetchMock = vi.fn();
    const client = createClient(fetchMock as unknown as typeof fetch, '');

    const error = await client
      .uploadTemplateImage(new Blob(['x'], { type: 'image/png' }))
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NotifHubError);
    expect((error as NotifHubError).code).toBe('unauthorized');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
