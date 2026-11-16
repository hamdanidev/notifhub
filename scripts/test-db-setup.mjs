#!/usr/bin/env node
/**
 * Prepares the isolated e2e environment:
 *   1. creates the test database when it does not exist (default: notifhub_test)
 *   2. applies migrations to it
 *   3. flushes the test Redis logical database (default: db 15)
 *
 * Never touches the development database: the database name must end with `_test`
 * (override with ALLOW_NON_TEST_DB=1 only if you really mean it).
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://notifhub:notifhub_pass@localhost:5432/notifhub_test';
const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15';

function fail(message, error) {
  console.error(`\ntest-db-setup gagal: ${message}`);
  if (error instanceof Error) {
    console.error(error.message);
  }
  process.exit(1);
}

const databaseName = (() => {
  try {
    const parsed = new URL(TEST_DATABASE_URL);
    return decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  } catch {
    return '';
  }
})();

if (databaseName.length === 0) {
  fail(`TEST_DATABASE_URL tidak valid: ${TEST_DATABASE_URL}`);
}

if (!databaseName.endsWith('_test') && process.env.ALLOW_NON_TEST_DB !== '1') {
  fail(
    `database "${databaseName}" tidak berakhiran "_test"; menolak menyiapkan/mengosongkan ` +
      'database yang mungkin dipakai development. Set ALLOW_NON_TEST_DB=1 bila ini disengaja.',
  );
}

async function ensureDatabase() {
  const maintenance = new URL(TEST_DATABASE_URL);
  maintenance.pathname = '/postgres';
  maintenance.search = '';

  const admin = new PrismaClient({ datasourceUrl: maintenance.toString() });

  try {
    const existing = await admin.$queryRawUnsafe(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      databaseName,
    );

    if (existing.length > 0) {
      console.log(`database ${databaseName}: sudah ada`);
      return;
    }

    if (!/^[A-Za-z0-9_]+$/.test(databaseName)) {
      fail(`nama database mengandung karakter tidak aman: ${databaseName}`);
    }

    await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
    console.log(`database ${databaseName}: dibuat`);
  } finally {
    await admin.$disconnect();
  }
}

function migrate() {
  const require = createRequire(import.meta.url);
  // Run the Prisma CLI through node itself: spawning npx.cmd directly fails on Windows.
  const prismaCli = require.resolve('prisma/build/index.js');

  console.log(`migrasi: prisma migrate deploy -> ${databaseName}`);
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
}

async function flushRedis() {
  const redis = new Redis(TEST_REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });

  try {
    await redis.connect();
    await redis.flushdb();
    console.log(`redis ${TEST_REDIS_URL}: db dikosongkan`);
  } catch (error) {
    fail(
      `tidak bisa terhubung ke Redis test (${TEST_REDIS_URL}). ` +
        'Jalankan `npm run infra:up` lalu coba lagi.',
      error,
    );
  } finally {
    redis.disconnect();
  }
}

try {
  await ensureDatabase();
  migrate();
  await flushRedis();
  console.log('\ntest-db-setup selesai: database dan Redis test siap.');
} catch (error) {
  fail('langkah persiapan gagal', error);
}
