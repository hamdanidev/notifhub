import bcrypt from 'bcrypt';

/**
 * Deterministic environment for the e2e suite.
 *
 * Runs as a Jest `setupFiles` entry, before any test file (and therefore before AppModule is
 * imported). Every variable required by `envSchema` is set here so the suite never reads the
 * developer's `.env`; `AppModule` additionally sets `ignoreEnvFile` when NODE_ENV=test.
 *
 * The database and Redis instance are separate from development:
 *   notifhub_test (PostgreSQL) and Redis logical DB 15.
 */

export const TEST_ADMIN_EMAIL = 'admin@test.local';
export const TEST_ADMIN_PASSWORD = 'TestAdmin123!';
export const TEST_PLATFORM_ADMIN_EMAIL = 'platform@test.local';
export const TEST_PLATFORM_ADMIN_PASSWORD = 'Platform123!';
export const TEST_SERVICE_API_KEY = 'test-service-api-key-0123456789';
export const TEST_TENANT_B = 'tenant-b';

const env: Record<string, string> = {
  NODE_ENV: 'test',
  NOTIFHUB_MODE: 'development',
  SERVICE_NAME: 'notifhub-test',
  DATABASE_URL:
    process.env.TEST_DATABASE_URL ?? 'postgresql://notifhub:notifhub_pass@localhost:5432/notifhub_test',
  REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15',
  PORT: '3101',
  LOG_LEVEL: 'error',
  SERVICE_API_KEY: TEST_SERVICE_API_KEY,
  DEFAULT_TENANT_ID: 'default',
  DEFAULT_LOCALE: 'id',
  IDEMPOTENCY_TTL_DAYS: '7',
  RETENTION_DAYS: '90',
  INGEST_MAX_PAYLOAD_BYTES: '65536',
  TEMPLATE_MAX_PAYLOAD_BYTES: '1048576',
  INGEST_RATE_LIMIT_PER_KEY: '1000',
  INGEST_RATE_LIMIT_WINDOW_SECONDS: '60',
  PROVIDER_RATE_LIMIT_EMAIL_PER_SEC: '10',
  PROVIDER_RATE_LIMIT_WHATSAPP_PER_SEC: '5',
  RECIPIENT_THROTTLE_WINDOW_SECONDS: '60',
  CORS_ORIGINS: '*',
  FAIL_MODE_ON_REDIS_DOWN: 'closed',
  SUBSCRIBER_JWT_SECRET: 'test-subscriber-jwt-secret-32-chars-min',
  SSE_HEARTBEAT_INTERVAL_SECONDS: '25',
  SSE_REPLAY_BUFFER_SECONDS: '300',
  ADMIN_EMAIL: TEST_ADMIN_EMAIL,
  ADMIN_PASSWORD_HASH: bcrypt.hashSync(TEST_ADMIN_PASSWORD, 4),
  ADMIN_JWT_SECRET: 'test-admin-jwt-secret-32-chars-minimum',
  ADMIN_JWT_EXPIRES_IN: '1h',
  PLATFORM_ADMIN_EMAIL: TEST_PLATFORM_ADMIN_EMAIL,
  PLATFORM_ADMIN_PASSWORD_HASH: bcrypt.hashSync(TEST_PLATFORM_ADMIN_PASSWORD, 4),
  WEBHOOK_SIGNING_SECRET: 'test-webhook-signing-secret-32-chars',
};

for (const [key, value] of Object.entries(env)) {
  process.env[key] = value;
}

// Never inherit provider credentials from the shell: development mode is log-only.
for (const key of [
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASS',
  'SMTP_FROM',
  'CATCH_ALL_RECIPIENT',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_APP_SECRET',
  'WHATSAPP_VERIFY_TOKEN',
  'WHATSAPP_CATCH_ALL_RECIPIENT',
  'SWAGGER_BASIC_AUTH_USER',
  'SWAGGER_BASIC_AUTH_PASS',
]) {
  delete process.env[key];
}
