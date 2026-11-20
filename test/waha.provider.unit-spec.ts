import { Channel } from '@prisma/client';
import {
  ProviderConfigurationError,
  type ProviderSendInput,
} from '../src/providers/provider.interface';
import { WahaProvider } from '../src/providers/waha/waha.provider';

const input: ProviderSendInput = {
  notificationId: 'n-waha',
  recipientId: 'r-waha',
  tenantId: 'default',
  priority: 3,
  templateKey: 'test.notification',
  subject: null,
  body: 'Halo Budi',
  data: {},
  to: '+628123456789',
};

const originalFetch = global.fetch;
const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterAll(() => {
  global.fetch = originalFetch;
});

function createProvider(
  mode: string,
  overrides: Record<string, string | undefined> = {},
): { provider: WahaProvider; logger: Record<string, jest.Mock> } {
  const values: Record<string, string | undefined> = {
    NOTIFHUB_MODE: mode,
    WAHA_BASE_URL: 'http://waha.test:3000',
    WAHA_API_KEY: 'test-waha-api-key',
    WAHA_SESSION: 'default',
    ...overrides,
  };
  const config = {
    getOrThrow: jest.fn((key: string) => values[key]),
    get: jest.fn((key: string) => values[key]),
  };
  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  return {
    provider: new WahaProvider(config as never, logger as never),
    logger,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('WahaProvider', () => {
  it('log-only di development tanpa HTTP dan tanpa isi pesan di log', async () => {
    const { provider, logger } = createProvider('development');

    const result = await provider.send(input);

    expect(result).toEqual({ providerMessageId: 'dev-log-only' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'waha.log_only', to: '+628123456789' }),
      expect.any(String),
    );
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('Halo Budi');
  });

  it('mengirim ke /api/sendText dengan header dan chatId yang benar', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ key: { id: '3EB0ABC123' } }));

    const { provider } = createProvider('production');
    const result = await provider.send(input);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe('http://waha.test:3000/api/sendText');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'X-Api-Key': 'test-waha-api-key',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(init.body)) as Record<string, unknown>).toEqual({
      session: 'default',
      chatId: '628123456789@c.us',
      text: 'Halo Budi',
      linkPreview: false,
    });
    expect(result.providerMessageId).toBe('3EB0ABC123');
  });

  it('menormalkan id komposit dari engine berbasis id penuh', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: 'true_628123456789@c.us_3EB0FULLID' }),
    );

    const { provider } = createProvider('production');

    await expect(provider.send(input)).resolves.toEqual({
      providerMessageId: '3EB0FULLID',
    });
  });

  it('menerima id dari _data sebagai fallback engine', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ _data: { id: 'true_628123456789@c.us_FALLBACK' } }),
    );

    const { provider } = createProvider('production');

    await expect(provider.send(input)).resolves.toEqual({
      providerMessageId: 'FALLBACK',
    });
  });

  it('staging mengganti nomor dengan catch-all WhatsApp', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'true_628999999999@c.us_X' }));

    const { provider } = createProvider('staging', {
      WHATSAPP_CATCH_ALL_RECIPIENT: '+628999999999',
    });
    await provider.send(input);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;

    expect(body.chatId).toBe('628999999999@c.us');
  });

  it('menolak nomor yang bukan E.164 tanpa memanggil WAHA', async () => {
    const { provider } = createProvider('production');

    await expect(provider.send({ ...input, to: '08123456789' })).rejects.toBeInstanceOf(
      ProviderConfigurationError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('401/403/404/422 menjadi ProviderConfigurationError (non-retryable)', async () => {
    for (const status of [401, 403, 404, 422]) {
      fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'not allowed' }, status));

      const { provider } = createProvider('production');

      await expect(provider.send(input)).rejects.toBeInstanceOf(ProviderConfigurationError);
    }
  });

  it('5xx menjadi WahaApiError yang bisa di-retry', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'server down' }, 500));

    const { provider } = createProvider('production');

    await expect(provider.send(input)).rejects.toMatchObject({
      name: 'WahaApiError',
      status: 500,
    });
  });

  it('2xx tanpa id dianggap gagal 502', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));

    const { provider } = createProvider('production');

    await expect(provider.send(input)).rejects.toMatchObject({
      name: 'WahaApiError',
      status: 502,
    });
  });

  it('konfigurasi WAHA yang hilang ditolak sebelum HTTP', async () => {
    const { provider } = createProvider('production', { WAHA_API_KEY: undefined });

    await expect(provider.send(input)).rejects.toBeInstanceOf(ProviderConfigurationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('tidak mencatat API key atau isi pesan pada log sukses', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'true_628123456789@c.us_ABC' }));

    const { provider, logger } = createProvider('production');
    await provider.send(input);

    const logs = JSON.stringify(logger.info.mock.calls);

    expect(logs).toContain('waha.sent');
    expect(logs).not.toContain('test-waha-api-key');
    expect(logs).not.toContain('Halo Budi');
  });

  it('membuang trailing slash pada WAHA_BASE_URL', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'true_628123456789@c.us_ABC' }));

    const { provider } = createProvider('production', {
      WAHA_BASE_URL: 'http://waha.test:3000/',
    });
    await provider.send(input);

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://waha.test:3000/api/sendText');
  });
});
