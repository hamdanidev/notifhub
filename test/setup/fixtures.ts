import { createHash, randomBytes } from 'node:crypto';
import { Channel, type PrismaClient } from '@prisma/client';

export const TEMPLATE_KEY = 'test.notification';
export const RECIPIENT = 'user-test-1';

export interface Fixtures {
  /** Subscriber JWT secret of the second tenant; the env secret must NOT open it. */
  tenantBSecret: string;
}

/**
 * Baseline rows for the suite. Runs after the Nest application bootstrapped the admin user and
 * the bootstrap API key, so nothing here overwrites those.
 */
export async function seedFixtures(prismaClient: PrismaClient, tenantB: string): Promise<Fixtures> {
  const tenantBSecret = randomBytes(32).toString('base64url');

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
      keyHash: createHash('sha256').update(randomBytes(16)).digest('hex'),
      tenantId: tenantB,
      allowedOrigins: [],
      subscriberJwtSecret: tenantBSecret,
      active: true,
    },
  });

  return { tenantBSecret };
}
