import { createHash, randomBytes } from 'node:crypto';
import { Channel, TemplateFormat, TemplateStatus, type PrismaClient } from '@prisma/client';

export const TEMPLATE_KEY = 'test.notification';
export const RECIPIENT = 'user-test-1';

export interface Fixtures {
  /** Subscriber JWT secret of the second tenant; the env secret must NOT open it. */
  tenantBSecret: string;
  /** Raw API key of the second tenant, so ingest can be exercised across tenants. */
  tenantBApiKey: string;
}

const TENANT_B_API_KEY = 'nhk_e2e_tenant_b_key_0123456789';

/**
 * Baseline rows for the suite. Runs after the Nest application bootstrapped the admin user and
 * the bootstrap API key, so nothing here overwrites those.
 */
export async function seedFixtures(prismaClient: PrismaClient, tenantB: string): Promise<Fixtures> {
  const tenantBSecret = randomBytes(32).toString('base64url');

  await prismaClient.tenant.createMany({
    data: [
      { id: 'default', name: 'Default' },
      { id: tenantB, name: tenantB },
    ],
    skipDuplicates: true,
  });

  await prismaClient.notificationTemplate.createMany({
    data: [
      {
        tenantId: 'default',
        key: TEMPLATE_KEY,
        channel: Channel.inapp,
        locale: 'id',
        version: 1,
        subject: null,
        body: 'Halo {{nama}}, ini notifikasi tes.',
        active: true,
        format: TemplateFormat.text,
        status: TemplateStatus.published,
        publishedAt: new Date(),
      },
      {
        tenantId: 'default',
        key: TEMPLATE_KEY,
        channel: Channel.email,
        locale: 'id',
        version: 1,
        subject: 'NotifHub test',
        body: '<p>Halo {{nama}}, ini email tes.</p>',
        active: true,
        format: TemplateFormat.html,
        status: TemplateStatus.published,
        publishedAt: new Date(),
      },
      {
        tenantId: tenantB,
        key: TEMPLATE_KEY,
        channel: Channel.inapp,
        locale: 'id',
        version: 1,
        subject: null,
        body: 'Halo {{nama}}, ini notifikasi tes tenant B.',
        active: true,
        format: TemplateFormat.text,
        status: TemplateStatus.published,
        publishedAt: new Date(),
      },
    ],
  });

  await prismaClient.subscriber.create({
    data: {
      tenantId: 'default',
      externalId: RECIPIENT,
      email: `${RECIPIENT}@example.com`,
      locale: 'id',
      timezone: 'Asia/Jakarta',
    },
  });

  await prismaClient.subscriber.create({
    data: {
      tenantId: tenantB,
      externalId: 'only-in-tenant-b',
      email: 'tenant-b@example.com',
      locale: 'id',
      timezone: 'Asia/Jakarta',
    },
  });

  await prismaClient.apiKey.create({
    data: {
      name: 'tenant-b',
      keyHash: createHash('sha256').update(TENANT_B_API_KEY).digest('hex'),
      tenantId: tenantB,
      allowedOrigins: [],
      subscriberJwtSecret: tenantBSecret,
      active: true,
    },
  });

  return { tenantBSecret, tenantBApiKey: TENANT_B_API_KEY };
}
