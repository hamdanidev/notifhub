import { Channel, PrismaClient } from '@prisma/client';

/**
 * Idempotent development seed.
 * Run with: npm run prisma:seed (which delegates to `prisma db seed`).
 */
const prisma = new PrismaClient();

const TENANT_ID = process.env.DEFAULT_TENANT_ID ?? 'default';
const TEMPLATE_KEY = 'test.notification';
const TEMPLATE_LOCALE = 'id';
const TEMPLATE_VERSION = 1;
const IN_APP_BODY = 'Halo {{nama}}, ini notifikasi tes dari NotifHub.';
const EMAIL_SUBJECT = 'NotifHub test';
const EMAIL_BODY = '<p>Halo {{nama}}, ini email tes dari NotifHub.</p>';
const TEST_RECIPIENT_ID = 'user-test-1';
const TEST_TIMEZONE = 'Asia/Jakarta';

async function main(): Promise<void> {
  const inAppTemplate = await prisma.notificationTemplate.upsert({
    where: {
      tenantId_key_channel_locale_version: {
        tenantId: TENANT_ID,
        key: TEMPLATE_KEY,
        channel: Channel.inapp,
        locale: TEMPLATE_LOCALE,
        version: TEMPLATE_VERSION,
      },
    },
    update: {
      body: IN_APP_BODY,
      subject: null,
      active: true,
    },
    create: {
      tenantId: TENANT_ID,
      key: TEMPLATE_KEY,
      channel: Channel.inapp,
      locale: TEMPLATE_LOCALE,
      version: TEMPLATE_VERSION,
      subject: null,
      body: IN_APP_BODY,
      active: true,
    },
    select: { id: true, key: true, channel: true, locale: true, version: true },
  });

  const emailTemplate = await prisma.notificationTemplate.upsert({
    where: {
      tenantId_key_channel_locale_version: {
        tenantId: TENANT_ID,
        key: TEMPLATE_KEY,
        channel: Channel.email,
        locale: TEMPLATE_LOCALE,
        version: TEMPLATE_VERSION,
      },
    },
    update: {
      subject: EMAIL_SUBJECT,
      body: EMAIL_BODY,
      active: true,
    },
    create: {
      tenantId: TENANT_ID,
      key: TEMPLATE_KEY,
      channel: Channel.email,
      locale: TEMPLATE_LOCALE,
      version: TEMPLATE_VERSION,
      subject: EMAIL_SUBJECT,
      body: EMAIL_BODY,
      active: true,
    },
    select: { id: true, key: true, channel: true, locale: true, version: true },
  });

  const preference = await prisma.notificationPreference.upsert({
    where: {
      tenantId_recipientId_channel: {
        tenantId: TENANT_ID,
        recipientId: TEST_RECIPIENT_ID,
        channel: Channel.inapp,
      },
    },
    update: {
      enabled: true,
      timezone: TEST_TIMEZONE,
    },
    create: {
      tenantId: TENANT_ID,
      recipientId: TEST_RECIPIENT_ID,
      channel: Channel.inapp,
      enabled: true,
      timezone: TEST_TIMEZONE,
    },
    select: { id: true, recipientId: true, channel: true },
  });

  process.stdout.write(
    `Seeded tenant ${TENANT_ID}: templates ${inAppTemplate.key} (${inAppTemplate.channel}) and ` +
      `${emailTemplate.key} (${emailTemplate.channel}), plus preference ` +
      `${preference.recipientId} (${preference.channel}).\n`,
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    process.stderr.write(
      `Seed failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    await prisma.$disconnect();
    process.exitCode = 1;
  });
