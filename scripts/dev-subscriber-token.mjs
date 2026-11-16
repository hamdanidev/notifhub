#!/usr/bin/env node
/**
 * Prints a development subscriber JWT for the given recipient.
 *
 *   npm run dev:subscriber-token -- user-test-1
 *   npm run dev:subscriber-token -- user-test-1 acme
 *
 * The token is signed with the tenant's configured subscriber secret (the first active API key
 * that has one). Only when the tenant has no configured secret does it fall back to
 * SUBSCRIBER_JWT_SECRET, mirroring SubscriberTokenService.
 */
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const [recipientId, tenantArg] = process.argv.slice(2);

if (recipientId === undefined || recipientId.length === 0) {
  console.error('usage: npm run dev:subscriber-token -- <sub> [tenant]');
  process.exit(1);
}

const tenantId = tenantArg ?? process.env.DEFAULT_TENANT_ID ?? 'default';
const prisma = new PrismaClient();

try {
  const keys = await prisma.apiKey.findMany({
    where: { tenantId, active: true, subscriberJwtSecret: { not: null } },
    orderBy: { createdAt: 'asc' },
    select: { name: true, subscriberJwtSecret: true },
  });

  const configured = keys.find(
    (key) => typeof key.subscriberJwtSecret === 'string' && key.subscriberJwtSecret.length > 0,
  );
  const secret = configured?.subscriberJwtSecret ?? process.env.SUBSCRIBER_JWT_SECRET;

  if (secret === undefined || secret.length === 0) {
    console.error(`tenant ${tenantId} has no subscriber secret and SUBSCRIBER_JWT_SECRET is unset`);
    process.exit(1);
  }

  console.error(
    `signing for tenant=${tenantId} with secret from ` +
      (configured === undefined ? 'SUBSCRIBER_JWT_SECRET (env fallback)' : `api key "${configured.name}"`),
  );
  process.stdout.write(
    jwt.sign({ sub: recipientId, tenant: tenantId }, secret, {
      algorithm: 'HS256',
      expiresIn: '1h',
    }),
  );
} finally {
  await prisma.$disconnect();
}
