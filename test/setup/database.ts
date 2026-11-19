import { PrismaClient } from '@prisma/client';

/** Shared Prisma client for e2e assertions; connects to TEST_DATABASE_URL (notifhub_test). */
export const prisma = new PrismaClient();

/**
 * Child tables first is not strictly required with CASCADE, but the explicit list documents
 * exactly which tables the suite owns. `_prisma_migrations` is intentionally left alone.
 */
const TABLES = [
  'PlatformAuditEvent',
  'BillingEvent',
  'DeliveryAttempt',
  'DeliveryEvent',
  'NotificationRecipient',
  'Notification',
  'TemplateTestSend',
  'TemplateAuditEvent',
  'TemplatePartialLink',
  'NotificationTemplate',
  'TemplateImage',
  'TemplateLayout',
  'TemplateTheme',
  'TemplatePartial',
  'NotificationPreference',
  'Subscriber',
  'TopicSubscriber',
  'Topic',
  'ApiKey',
  'AdminUser',
  'Tenant',
];

/** Empties every application table. Call before bootstrapping the Nest application. */
export async function resetDatabase(): Promise<void> {
  const list = TABLES.map((table) => `"${table}"`).join(', ');

  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

/** Polls until the probe returns a truthy value, or fails the test after `timeoutMs`. */
export async function waitFor<T>(
  probe: () => Promise<T | null | undefined>,
  description: string,
  timeoutMs = 20_000,
  intervalMs = 250,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const value = await probe();

    if (value !== null && value !== undefined && value !== false) {
      return value;
    }

    if (Date.now() > deadline) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for: ${description}`);
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
