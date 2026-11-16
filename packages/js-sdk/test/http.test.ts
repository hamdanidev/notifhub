import { describe, expect, it, vi } from 'vitest';
import { NotifHubError } from '../src/errors';
import { computeDelay, HttpTransport } from '../src/http';
import type { RetryOptions } from '../src/types';

const RETRY: RetryOptions = { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 };

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function createTransport(fetchImpl: typeof fetch): HttpTransport {
  return new HttpTransport(
    'http://localhost:3000',
    () => 'subscriber-token',
    fetchImpl,
    RETRY,
  );
}

describe('HttpTransport', () => {
  it('retries 5xx responses and injects the bearer token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'boom' }, 500))
      .mockResolvedValueOnce(jsonResponse({ items: [], nextCursor: null }));

    const transport = createTransport(fetchMock as unknown as typeof fetch);
    const page = await transport.request<{ items: unknown[]; nextCursor: null }>(
      'GET',
      '/api/v1/in-app/notifications',
    );

    expect(page.items).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstCall = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = firstCall[1].headers as Record<string, string>;

    expect(firstCall[0]).toBe('http://localhost:3000/api/v1/in-app/notifications');
    expect(headers.Authorization).toBe('Bearer subscriber-token');
  });

  it('does not retry 401 and maps the error with requestId', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        { statusCode: 401, message: 'Invalid or missing subscriber token', requestId: 'req-1' },
        401,
      ),
    );

    const transport = createTransport(fetchMock as unknown as typeof fetch);

    await expect(transport.request('GET', '/api/v1/in-app/notifications')).rejects.toMatchObject({
      code: 'unauthorized',
      status: 401,
      requestId: 'req-1',
      retryable: false,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('honours Retry-After for 429 before retrying', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'Too Many Requests' }, 429, { 'retry-after': '0' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const transport = createTransport(fetchMock as unknown as typeof fetch);
    const result = await transport.request<{ ok: boolean }>('GET', '/api/v1/in-app/notifications');

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws a typed network error after exhausting attempts', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));

    const transport = createTransport(fetchMock as unknown as typeof fetch);

    const error = await transport.request('GET', '/x').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NotifHubError);
    expect((error as NotifHubError).code).toBe('network_error');
    expect((error as NotifHubError).retryable).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(RETRY.maxAttempts);
  });
});

describe('computeDelay', () => {
  it('grows exponentially with jitter and respects the cap', () => {
    const options: RetryOptions = { maxAttempts: 5, baseDelayMs: 500, maxDelayMs: 3000 };

    const first = computeDelay(1, options);
    expect(first).toBeGreaterThanOrEqual(500);
    expect(first).toBeLessThanOrEqual(625);

    expect(computeDelay(20, options)).toBe(3000);
    expect(computeDelay(1, options, 1200)).toBe(1200);
    expect(computeDelay(1, options, 60000)).toBe(3000);
  });
});
