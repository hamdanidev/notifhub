import { z } from 'zod';

/**
 * Zod schema for every environment variable NotifHub reads.
 * Validated once at startup (see AppModule -> ConfigModule.forRoot({ validate })).
 * Invalid or missing values fail fast with a list of problems.
 */

const positiveInt = (defaultValue: number) =>
  z.coerce.number().int().positive().default(defaultValue);

const nonNegativeInt = (defaultValue: number) =>
  z.coerce.number().int().nonnegative().default(defaultValue);

const optionalString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().optional(),
);

const optionalUrl = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.url().optional(),
);

const optionalEmail = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.email().optional(),
);

const optionalBcryptHash = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().startsWith('$2').optional(),
);

const optionalPositiveInt = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.coerce.number().int().positive().optional(),
);

export const envSchema = z
  .object({
    SERVICE_NAME: z.string().min(1).default('notifhub'),
    NOTIFHUB_MODE: z.enum(['development', 'staging', 'production']).default('development'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    PORT: positiveInt(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    SERVICE_API_KEY: z.string().min(16),
    DEFAULT_TENANT_ID: z.string().min(1).default('default'),
    DEFAULT_LOCALE: z.string().min(1).default('id'),
    IDEMPOTENCY_TTL_DAYS: positiveInt(7),
    RETENTION_DAYS: positiveInt(90),
    TEMPLATE_TEST_SEND_RETENTION_DAYS: nonNegativeInt(180),
    TEMPLATE_AUDIT_RETENTION_DAYS: nonNegativeInt(730),
    ADMIN_AUDIT_RETENTION_DAYS: nonNegativeInt(730),
    INGEST_MAX_PAYLOAD_BYTES: positiveInt(65536),
    TEMPLATE_MAX_PAYLOAD_BYTES: positiveInt(1048576),
    TEMPLATE_IMAGE_DIR: z.string().min(1).default('var/template-images'),
    TEMPLATE_IMAGE_MAX_BYTES: positiveInt(5242880),
    TEMPLATE_IMAGE_BASE_URL: optionalUrl,
    INGEST_RATE_LIMIT_PER_KEY: positiveInt(100),
    INGEST_RATE_LIMIT_WINDOW_SECONDS: positiveInt(60),
    PROVIDER_RATE_LIMIT_EMAIL_PER_SEC: positiveInt(10),
    PROVIDER_RATE_LIMIT_WHATSAPP_PER_SEC: positiveInt(5),
    RECIPIENT_THROTTLE_WINDOW_SECONDS: positiveInt(60),
    CORS_ORIGINS: z.string().min(1).default('*'),
    FAIL_MODE_ON_REDIS_DOWN: z.enum(['open', 'closed']).default('closed'),
    SUBSCRIBER_JWT_SECRET: z.string().min(32),
    SSE_HEARTBEAT_INTERVAL_SECONDS: positiveInt(25),
    SSE_REPLAY_BUFFER_SECONDS: positiveInt(300),
    ADMIN_EMAIL: z.email(),
    ADMIN_PASSWORD_HASH: z.string().startsWith('$2'),
    ADMIN_JWT_SECRET: z.string().min(32),
    ADMIN_JWT_EXPIRES_IN: z
      .string()
      .regex(/^\d+[smhd]$/, 'ADMIN_JWT_EXPIRES_IN must look like 30m, 1h or 7d')
      .default('1h'),
    PLATFORM_ADMIN_EMAIL: optionalEmail,
    PLATFORM_ADMIN_PASSWORD_HASH: optionalBcryptHash,
    APPROVER_EMAIL: optionalEmail,
    APPROVER_PASSWORD_HASH: optionalBcryptHash,
    TEMPLATE_APPROVAL_MODE: z.enum(['two_person', 'self_approval_allowed']).optional(),
    WEBHOOK_SIGNING_SECRET: z.string().min(32),
    CATCH_ALL_RECIPIENT: optionalString,
    SMTP_HOST: optionalString,
    SMTP_PORT: optionalPositiveInt,
    SMTP_USER: optionalString,
    SMTP_PASS: optionalString,
    SMTP_FROM: optionalString,
    WHATSAPP_API_BASE_URL: z.string().url().default('https://graph.facebook.com'),
    WHATSAPP_API_VERSION: z
      .string()
      .regex(/^v\d+\.\d+$/, 'WHATSAPP_API_VERSION must look like v21.0')
      .default('v21.0'),
    WHATSAPP_PROVIDER: z.enum(['meta', 'waha']).default('meta'),
    WAHA_BASE_URL: optionalUrl,
    WAHA_API_KEY: optionalString,
    WAHA_SESSION: z.string().min(1).default('default'),
    WAHA_WEBHOOK_HMAC_KEY: optionalString,
    WHATSAPP_PHONE_NUMBER_ID: optionalString,
    WHATSAPP_ACCESS_TOKEN: optionalString,
    WHATSAPP_APP_SECRET: optionalString,
    WHATSAPP_VERIFY_TOKEN: optionalString,
    WHATSAPP_CATCH_ALL_RECIPIENT: optionalString,
    SWAGGER_BASIC_AUTH_USER: optionalString,
    SWAGGER_BASIC_AUTH_PASS: optionalString,
  })
  .superRefine((env, ctx) => {
    const hasPlatformEmail = env.PLATFORM_ADMIN_EMAIL !== undefined;
    const hasPlatformHash = env.PLATFORM_ADMIN_PASSWORD_HASH !== undefined;

    if (hasPlatformEmail !== hasPlatformHash) {
      ctx.addIssue({
        code: 'custom',
        path: ['PLATFORM_ADMIN_PASSWORD_HASH'],
        message: 'PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD_HASH must be set together',
      });
    }

    const hasApproverEmail = env.APPROVER_EMAIL !== undefined;
    const hasApproverHash = env.APPROVER_PASSWORD_HASH !== undefined;

    if (hasApproverEmail !== hasApproverHash) {
      ctx.addIssue({
        code: 'custom',
        path: ['APPROVER_PASSWORD_HASH'],
        message: 'APPROVER_EMAIL and APPROVER_PASSWORD_HASH must be set together',
      });
    }

    if (env.NOTIFHUB_MODE === 'staging' && env.CATCH_ALL_RECIPIENT === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['CATCH_ALL_RECIPIENT'],
        message: 'CATCH_ALL_RECIPIENT is required when NOTIFHUB_MODE=staging',
      });
    }

    if (env.NOTIFHUB_MODE !== 'development') {
      if (env.SWAGGER_BASIC_AUTH_USER === undefined) {        ctx.addIssue({
          code: 'custom',
          path: ['SWAGGER_BASIC_AUTH_USER'],
          message: 'SWAGGER_BASIC_AUTH_USER is required outside development (Swagger must not be public)',
        });
      }
      if (env.SWAGGER_BASIC_AUTH_PASS === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['SWAGGER_BASIC_AUTH_PASS'],
          message: 'SWAGGER_BASIC_AUTH_PASS is required outside development (Swagger must not be public)',
        });
      }
      if (env.SMTP_HOST === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['SMTP_HOST'],
          message: 'SMTP_HOST is required outside development (email is log-only in development)',
        });
      }
      if (env.SMTP_PORT === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['SMTP_PORT'],
          message: 'SMTP_PORT is required outside development (email is log-only in development)',
        });
      }
      if (env.SMTP_FROM === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['SMTP_FROM'],
          message: 'SMTP_FROM is required outside development (email is log-only in development)',
        });
      }
    }

    const hasPhoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID !== undefined;
    const hasAccessToken = env.WHATSAPP_ACCESS_TOKEN !== undefined;

    if (hasPhoneNumberId !== hasAccessToken) {
      ctx.addIssue({
        code: 'custom',
        path: ['WHATSAPP_ACCESS_TOKEN'],
        message:
          'WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN must be set together',
      });
    }

    if (env.WHATSAPP_PROVIDER === 'waha') {
      if (env.WAHA_BASE_URL === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['WAHA_BASE_URL'],
          message: 'WAHA_BASE_URL is required when WHATSAPP_PROVIDER=waha',
        });
      }
      if (env.WAHA_API_KEY === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['WAHA_API_KEY'],
          message: 'WAHA_API_KEY is required when WHATSAPP_PROVIDER=waha',
        });
      }
      if (env.WAHA_WEBHOOK_HMAC_KEY === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['WAHA_WEBHOOK_HMAC_KEY'],
          message: 'WAHA_WEBHOOK_HMAC_KEY is required when WHATSAPP_PROVIDER=waha',
        });
      }
    }

    if (
      env.WHATSAPP_PROVIDER === 'waha' &&
      env.WAHA_WEBHOOK_HMAC_KEY !== undefined &&
      env.WAHA_WEBHOOK_HMAC_KEY.length < 32
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['WAHA_WEBHOOK_HMAC_KEY'],
        message: 'WAHA_WEBHOOK_HMAC_KEY must be at least 32 characters',
      });
    }

    const hasAppSecret = env.WHATSAPP_APP_SECRET !== undefined;
    const hasVerifyToken = env.WHATSAPP_VERIFY_TOKEN !== undefined;

    if (hasAppSecret !== hasVerifyToken) {
      ctx.addIssue({
        code: 'custom',
        path: ['WHATSAPP_VERIFY_TOKEN'],
        message: 'WHATSAPP_APP_SECRET and WHATSAPP_VERIFY_TOKEN must be set together',
      });
    }
  });

/** Fully validated, typed application configuration. */
export type AppConfig = z.infer<typeof envSchema>;

/**
 * Validates raw environment variables (process.env merged with .env by @nestjs/config).
 * Throws a single Error listing every invalid/missing variable so startup fails fast.
 */
export function validateEnv(raw: Record<string, unknown>): AppConfig {
  const parsed = envSchema.safeParse(raw);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  return parsed.data;
}
