import { validateEnv } from '../src/config/env.schema';

const base = {
  DATABASE_URL: 'postgresql://notifhub:notifhub_pass@localhost:5432/notifhub_test',
  REDIS_URL: 'redis://localhost:6379/15',
  SERVICE_API_KEY: 'test-service-api-key-0123456789',
  ADMIN_EMAIL: 'admin@example.com',
  ADMIN_PASSWORD_HASH: '$2b$10$abcdefghijklmnopqrstuvwxyz',
  ADMIN_JWT_SECRET: 'a'.repeat(32),
  SUBSCRIBER_JWT_SECRET: 'b'.repeat(32),
  WEBHOOK_SIGNING_SECRET: 'c'.repeat(32),
};

const waha = {
  WHATSAPP_PROVIDER: 'waha',
  WAHA_BASE_URL: 'http://127.0.0.1:3001',
  WAHA_API_KEY: 'test-waha-api-key',
  WAHA_WEBHOOK_HMAC_KEY: 'd'.repeat(32),
};

describe('env schema WAHA', () => {
  it('mewajibkan env WAHA saat provider waha', () => {
    expect(() => validateEnv({ ...base, WHATSAPP_PROVIDER: 'waha' })).toThrow(
      /WAHA_BASE_URL is required/,
    );
    expect(() =>
      validateEnv({ ...base, WHATSAPP_PROVIDER: 'waha', WAHA_BASE_URL: waha.WAHA_BASE_URL }),
    ).toThrow(/WAHA_API_KEY is required/);
    expect(() =>
      validateEnv({
        ...base,
        WHATSAPP_PROVIDER: 'waha',
        WAHA_BASE_URL: waha.WAHA_BASE_URL,
        WAHA_API_KEY: waha.WAHA_API_KEY,
      }),
    ).toThrow(/WAHA_WEBHOOK_HMAC_KEY is required/);
  });

  it('menerima konfigurasi WAHA lengkap', () => {
    const parsed = validateEnv({ ...base, ...waha });

    expect(parsed.WHATSAPP_PROVIDER).toBe('waha');
    expect(parsed.WAHA_SESSION).toBe('default');
  });

  it('menolak HMAC key pendek saat provider waha', () => {
    expect(() =>
      validateEnv({ ...base, ...waha, WAHA_WEBHOOK_HMAC_KEY: 'terlalu-pendek' }),
    ).toThrow(/at least 32 characters/);
  });

  it('mengabaikan HMAC key pendek saat provider meta', () => {
    const parsed = validateEnv({
      ...base,
      WHATSAPP_PROVIDER: 'meta',
      WAHA_WEBHOOK_HMAC_KEY: 'terlalu-pendek',
    });

    expect(parsed.WHATSAPP_PROVIDER).toBe('meta');
  });

  it('menolak nilai WHATSAPP_PROVIDER yang tidak dikenal', () => {
    expect(() => validateEnv({ ...base, WHATSAPP_PROVIDER: 'twilio' })).toThrow(
      /WHATSAPP_PROVIDER/,
    );
  });
});
