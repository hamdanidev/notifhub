import { describe, expect, it, vi } from 'vitest';
import { NotifHubClient } from '../src/client';
import { NotifHubError } from '../src/errors';
import type { ChannelPreference, PreferenceChannel, SubscriberPreferences } from '../src/types';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createClient(fetchImpl: typeof fetch, token = 'subscriber-token'): NotifHubClient {
  return new NotifHubClient({
    baseUrl: 'http://localhost:3000',
    getToken: () => token,
    fetch: fetchImpl,
    retry: { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 5 },
  });
}

function channelPreference(overrides: Partial<ChannelPreference> = {}): ChannelPreference {
  return {
    channel: 'inapp',
    enabled: true,
    quietHoursStart: null,
    quietHoursEnd: null,
    timezone: 'Asia/Jakarta',
    isDefault: true,
    updatedAt: null,
    ...overrides,
  };
}

describe('preference center', () => {
  it('reads the snapshot with the subscriber bearer token and no body', async () => {
    const payload: SubscriberPreferences = {
      recipientId: 'user-1',
      locale: 'id',
      timezone: 'Asia/Jakarta',
      channels: [
        channelPreference({ channel: 'inapp' }),
        channelPreference({ channel: 'email' }),
        channelPreference({ channel: 'whatsapp' }),
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(payload));

    const result = await createClient(fetchMock as unknown as typeof fetch).getPreferences();

    expect(result).toEqual(payload);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;

    expect(url).toBe('http://localhost:3000/api/v1/subscriber/preferences');
    expect(init.method).toBe('GET');
    expect(headers.Authorization).toBe('Bearer subscriber-token');
    expect(init.body).toBeUndefined();
  });

  it('replaces one channel preference with a PUT body', async () => {
    const updated = channelPreference({
      channel: 'email',
      enabled: false,
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
      isDefault: false,
      updatedAt: '2026-11-16T04:10:00.000Z',
    });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(updated));

    const result = await createClient(fetchMock as unknown as typeof fetch).updatePreference(
      'email',
      { enabled: false, quietHoursStart: '22:00', quietHoursEnd: '07:00' },
    );

    expect(result).toEqual(updated);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;

    expect(url).toBe('http://localhost:3000/api/v1/subscriber/preferences/email');
    expect(init.method).toBe('PUT');
    expect(headers.Authorization).toBe('Bearer subscriber-token');
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(String(init.body))).toEqual({
      enabled: false,
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
    });
  });

  it('encodes the channel segment instead of building an unsafe path', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(channelPreference({ isDefault: false })));

    await createClient(fetchMock as unknown as typeof fetch).updatePreference(
      'a/b' as PreferenceChannel,
      { enabled: true },
    );

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe('http://localhost:3000/api/v1/subscriber/preferences/a%2Fb');
  });

  it('maps a 400 quiet-hours rejection to a bad_request error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          statusCode: 400,
          message: 'quietHoursStart and quietHoursEnd must be provided together',
          error: 'Bad Request',
        },
        400,
      ),
    );

    const client = createClient(fetchMock as unknown as typeof fetch);

    await expect(
      client.updatePreference('email', { enabled: true, quietHoursStart: '22:00' }),
    ).rejects.toMatchObject({
      name: 'NotifHubError',
      code: 'bad_request',
      status: 400,
      message: 'quietHoursStart and quietHoursEnd must be provided together',
    });
  });

  it('maps a 401 to an unauthorized error', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { statusCode: 401, message: 'Invalid or missing subscriber token', error: 'Unauthorized' },
          401,
        ),
      );

    const client = createClient(fetchMock as unknown as typeof fetch);

    await expect(client.getPreferences()).rejects.toBeInstanceOf(NotifHubError);
    await expect(client.getPreferences()).rejects.toMatchObject({ code: 'unauthorized', status: 401 });
  });
});
