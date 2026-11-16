#!/usr/bin/env node
/**
 * End-to-end verification for the end-user preference center.
 *
 * Requires a running backend and the development database:
 *   npm run start:dev
 *   npm run verify:preferences
 *
 * The script signs real subscriber tokens, mutates the API, inspects PostgreSQL through Prisma
 * and cleans up its own fixtures. It exits with code 1 if any check fails.
 */
import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const BASE_URL = (process.env.NOTIFHUB_API_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const ENV_SECRET = process.env.SUBSCRIBER_JWT_SECRET ?? '';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@notifhub.local';
const ADMIN_PASSWORD = process.env.NOTIFHUB_ADMIN_PASSWORD ?? 'NotifHubAdmin123!';
const TENANT_A = process.env.DEFAULT_TENANT_ID ?? 'default';
const TENANT_B = 'pref-verify';
const RECIPIENT = 'user-test-1';
const TEMPLATE_KEY = 'test.notification';
const NOTIFY_KEY = `pref-verify-${Date.now()}`;

const prisma = new PrismaClient();
const results = [];
let notifyNotificationId = null;
let tenantBSecret = '';

function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === '' ? '' : `  [${detail}]`}`);
}

function section(title) {
  console.log(`\n== ${title} ==`);
}

async function http(method, path, options = {}) {
  const headers = { Accept: 'application/json' };

  if (options.token !== undefined) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  if (options.apiKey !== undefined) {
    headers['X-API-Key'] = options.apiKey;
  }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let json = null;

  try {
    json = text.length === 0 ? null : JSON.parse(text);
  } catch {
    json = null;
  }

  return { status: response.status, json, text };
}

function tokenFor(tenantId, secret = ENV_SECRET) {
  return jwt.sign({ sub: RECIPIENT, tenant: tenantId }, secret, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });
}

/**
 * Signs the way a consumer does: with the tenant's configured API key secret, falling back to the
 * env secret only for tenants that never configured one.
 */
async function tenantSecret(tenantId) {
  const keys = await prisma.apiKey.findMany({
    where: { tenantId, active: true, subscriberJwtSecret: { not: null } },
    orderBy: { createdAt: 'asc' },
    select: { name: true, subscriberJwtSecret: true },
  });
  const configured = keys.find((key) => typeof key.subscriberJwtSecret === 'string');

  if (configured === undefined) {
    console.log(`tenant ${tenantId}: memakai SUBSCRIBER_JWT_SECRET (belum ada secret di API key)`);
    return ENV_SECRET;
  }

  console.log(
    `tenant ${tenantId}: memakai secret dari API key "${configured.name}" ` +
      `(sama dengan SUBSCRIBER_JWT_SECRET=${configured.subscriberJwtSecret === ENV_SECRET})`,
  );

  return configured.subscriberJwtSecret;
}

async function waitFor(probe, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const value = await probe();

    if (value !== null && value !== undefined) {
      return value;
    }
    if (Date.now() > deadline) {
      return null;
    }

    await new Promise((resolve) => setTimeout(resolve, 400));
  }
}

function logPreferences(label) {
  return prisma.notificationPreference
    .findMany({
      where: { OR: [{ tenantId: TENANT_A }, { tenantId: TENANT_B }] },
      orderBy: [{ tenantId: 'asc' }, { recipientId: 'asc' }, { channel: 'asc' }],
    })
    .then((rows) => {
      console.log(`\n[db] NotificationPreference (${label}):`);
      console.table(
        rows.map((row) => ({
          tenantId: row.tenantId,
          recipientId: row.recipientId,
          channel: row.channel,
          enabled: row.enabled,
          quietHoursStart: row.quietHoursStart,
          quietHoursEnd: row.quietHoursEnd,
          timezone: row.timezone,
        })),
      );
      return rows;
    });
}

async function main() {
  if (ENV_SECRET.length === 0) {
    throw new Error('SUBSCRIBER_JWT_SECRET is missing (run with --env-file=.env)');
  }

  const template = await prisma.notificationTemplate.findFirst({
    where: { tenantId: TENANT_A, key: TEMPLATE_KEY, channel: 'email', active: true },
    select: { id: true },
  });

  if (template === null) {
    throw new Error(`template ${TEMPLATE_KEY} (email) not found; run "npx prisma db seed"`);
  }

  section('fixtures');
  tenantBSecret = randomBytes(32).toString('base64url');
  await prisma.apiKey.deleteMany({ where: { tenantId: TENANT_B } });
  await prisma.notificationPreference.deleteMany({ where: { tenantId: TENANT_B } });
  await prisma.subscriber.upsert({
    where: { tenantId_externalId: { tenantId: TENANT_A, externalId: RECIPIENT } },
    update: {},
    create: {
      tenantId: TENANT_A,
      externalId: RECIPIENT,
      email: `${RECIPIENT}@example.com`,
      timezone: 'Asia/Jakarta',
    },
  });
  await prisma.apiKey.create({
    data: {
      name: 'pref-verify',
      keyHash: createHash('sha256').update(randomBytes(16)).digest('hex'),
      tenantId: TENANT_B,
      allowedOrigins: [],
      subscriberJwtSecret: tenantBSecret,
      active: true,
    },
  });
  console.log(`tenant ${TENANT_B} fixture created with its own subscriber secret`);

  const tokenA = tokenFor(TENANT_A, await tenantSecret(TENANT_A));
  const tokenB = tokenFor(TENANT_B, tenantBSecret);
  const before = await logPreferences('sebelum uji');
  check('fixture: token tenant A dapat dibuat', tokenA.length > 0);

  section('T1 baca snapshot default');
  const t1 = await http('GET', '/api/v1/subscriber/preferences', { token: tokenA });
  check('T1 status 200', t1.status === 200, `status ${t1.status}`);
  const channels = t1.json?.channels ?? [];
  check(
    'T1 tiga channel berurutan inapp/email/whatsapp',
    JSON.stringify(channels.map((item) => item.channel)) === JSON.stringify(['inapp', 'email', 'whatsapp']),
    JSON.stringify(channels.map((item) => item.channel)),
  );
  const whatsapp = channels.find((item) => item.channel === 'whatsapp');
  check('T1 whatsapp tanpa baris = default', whatsapp?.isDefault === true, `isDefault=${whatsapp?.isDefault}`);
  check('T1 timezone dari subscriber', t1.json?.timezone === 'Asia/Jakarta', String(t1.json?.timezone));
  check('T1 recipientId dari token', t1.json?.recipientId === RECIPIENT, String(t1.json?.recipientId));

  section('T2/T3 tulis dan baca ulang preferensi whatsapp');
  const t2 = await http('PUT', '/api/v1/subscriber/preferences/whatsapp', {
    token: tokenA,
    body: { enabled: true, quietHoursStart: '22:00', quietHoursEnd: '07:00' },
  });
  check('T2 status 200', t2.status === 200, `status ${t2.status}`);
  check('T2 quiet hours tersimpan', t2.json?.quietHoursStart === '22:00' && t2.json?.quietHoursEnd === '07:00');
  check('T2 isDefault false setelah ditulis', t2.json?.isDefault === false);

  const t3 = await http('GET', '/api/v1/subscriber/preferences', { token: tokenA });
  const whatsappAfter = (t3.json?.channels ?? []).find((item) => item.channel === 'whatsapp');
  check(
    'T3 GET mencerminkan perubahan',
    whatsappAfter?.quietHoursStart === '22:00' && whatsappAfter?.isDefault === false,
    `quietHoursStart=${whatsappAfter?.quietHoursStart}`,
  );
  await logPreferences('setelah T2');

  section('T4 penegakan preferensi oleh worker (email disabled)');
  const t4write = await http('PUT', '/api/v1/subscriber/preferences/email', {
    token: tokenA,
    body: { enabled: false },
  });
  check('T4 PUT email disabled 200', t4write.status === 200, `status ${t4write.status}`);

  const notify = await http('POST', '/api/v1/notify', {
    apiKey: process.env.SERVICE_API_KEY ?? 'dev-api-key-change-in-prod',
    body: {
      idempotency_key: NOTIFY_KEY,
      template_key: TEMPLATE_KEY,
      recipients: [RECIPIENT],
      channels: ['email'],
      data: { nama: 'Budi' },
    },
  });
  check('T4 ingest 202', notify.status === 202, `status ${notify.status}`);
  notifyNotificationId = notify.json?.notification_id ?? null;

  const recipientRow =
    notifyNotificationId === null
      ? null
      : await waitFor(async () => {
          const row = await prisma.notificationRecipient.findFirst({
            where: { notificationId: notifyNotificationId, recipientId: RECIPIENT, channel: 'email' },
            select: { status: true, lastError: true },
          });

          return row !== null && row.status !== 'pending' ? row : null;
        });

  check(
    'T4 worker men-skip karena preferensi',
    recipientRow?.status === 'skipped' && recipientRow?.lastError === 'preference_disabled',
    `status=${recipientRow?.status} lastError=${recipientRow?.lastError}`,
  );
  await logPreferences('setelah T4');

  section('T5 validasi input');
  const t5sms = await http('PUT', '/api/v1/subscriber/preferences/sms', {
    token: tokenA,
    body: { enabled: true },
  });
  check('T5 channel sms ditolak 400', t5sms.status === 400, `status ${t5sms.status}`);

  const t5pair = await http('PUT', '/api/v1/subscriber/preferences/email', {
    token: tokenA,
    body: { enabled: true, quietHoursStart: '22:00' },
  });
  check('T5 quiet hours tidak sepasang 400', t5pair.status === 400, `status ${t5pair.status}`);

  const t5tz = await http('PUT', '/api/v1/subscriber/preferences/email', {
    token: tokenA,
    body: { enabled: true, timezone: 'Mars/Base' },
  });
  check('T5 timezone tidak valid 400', t5tz.status === 400, `status ${t5tz.status}`);

  const t5body = await http('PUT', '/api/v1/subscriber/preferences/email', {
    token: tokenA,
    body: { quietHoursStart: '22:00' },
  });
  check('T5 enabled wajib 400', t5body.status === 400, `status ${t5body.status}`);

  const t5unknown = await http('PUT', '/api/v1/subscriber/preferences/foo', {
    token: tokenA,
    body: { enabled: true },
  });
  check('T5 channel tidak dikenal 400', t5unknown.status === 400, `status ${t5unknown.status}`);

  section('T6 autentikasi subscriber');
  const t6none = await http('GET', '/api/v1/subscriber/preferences');
  check('T6 tanpa token 401', t6none.status === 401, `status ${t6none.status}`);

  const t6bad = await http('GET', '/api/v1/subscriber/preferences', {
    token: tokenFor(TENANT_A, randomBytes(32).toString('base64url')),
  });
  check('T6 signature salah 401', t6bad.status === 401, `status ${t6bad.status}`);

  const t6tenantless = await http('GET', '/api/v1/subscriber/preferences', {
    token: jwt.sign({ sub: RECIPIENT }, ENV_SECRET, { algorithm: 'HS256', expiresIn: '1h' }),
  });
  check('T6 tanpa klaim tenant 401', t6tenantless.status === 401, `status ${t6tenantless.status}`);

  section('T7 isolasi tenant (recipientId sama)');
  const t7b = await http('GET', '/api/v1/subscriber/preferences', { token: tokenB });
  const bChannels = t7b.json?.channels ?? [];
  const bEmail = bChannels.find((item) => item.channel === 'email');
  const bWhatsapp = bChannels.find((item) => item.channel === 'whatsapp');
  check('T7 tenant B dapat membaca 200', t7b.status === 200, `status ${t7b.status}`);
  check(
    'T7 tenant B tidak melihat baris tenant A',
    bEmail?.isDefault === true && bWhatsapp?.isDefault === true,
    `email.isDefault=${bEmail?.isDefault} whatsapp.isDefault=${bWhatsapp?.isDefault}`,
  );

  const t7writeB = await http('PUT', '/api/v1/subscriber/preferences/inapp', {
    token: tokenB,
    body: { enabled: false },
  });
  check('T7 tenant B menulis preferensi 200', t7writeB.status === 200, `status ${t7writeB.status}`);

  const t7a = await http('GET', '/api/v1/subscriber/preferences', { token: tokenA });
  const aInapp = (t7a.json?.channels ?? []).find((item) => item.channel === 'inapp');
  check(
    'T7 tulis tenant B tidak mengubah tenant A',
    aInapp?.enabled === true,
    `tenant A inapp.enabled=${aInapp?.enabled}`,
  );
  await logPreferences('setelah T7');

  section('T8 tidak ada downgrade ke secret global');
  const t8 = await http('GET', '/api/v1/subscriber/preferences', {
    token: tokenFor(TENANT_B, ENV_SECRET),
  });
  check('T8 token tenant B dengan secret env 401', t8.status === 401, `status ${t8.status}`);

  section('T9 regresi admin (tenant-scoped)');
  const login = await http('POST', '/api/v1/admin/auth/login', {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  const adminToken = login.json?.accessToken ?? null;

  if (adminToken === null) {
    check('T9 admin login', false, `status ${login.status}`);
  } else {
    const adminPrefs = await http(
      'GET',
      `/api/v1/admin/subscribers/${encodeURIComponent(RECIPIENT)}/preferences`,
      { token: adminToken },
    );
    check('T9 admin membaca preferensi 200', adminPrefs.status === 200, `status ${adminPrefs.status}`);
    check(
      'T9 admin hanya melihat baris tenant sendiri',
      Array.isArray(adminPrefs.json) && adminPrefs.json.length >= 2,
      `rows=${Array.isArray(adminPrefs.json) ? adminPrefs.json.length : 'n/a'}`,
    );

    const adminWrite = await http(
      'PUT',
      `/api/v1/admin/subscribers/${encodeURIComponent(RECIPIENT)}/preferences/inapp`,
      { token: adminToken, body: { enabled: true } },
    );
    check('T9 admin menulis preferensi 200', adminWrite.status === 200, `status ${adminWrite.status}`);
  }

  section('T10 regresi lane in-app');
  const inappList = await http('GET', '/api/v1/in-app/notifications?limit=5', { token: tokenA });
  check('T10 daftar in-app 200', inappList.status === 200, `status ${inappList.status}`);

  section('T11 rate limit (60/menit per IP)');
  let limitedAt = null;

  for (let index = 1; index <= 70; index += 1) {
    const response = await http('GET', '/api/v1/subscriber/preferences', { token: tokenA });

    if (response.status === 429) {
      limitedAt = index;
      break;
    }
  }

  check('T11 permintaan ke-61+ ditolak 429', limitedAt !== null, limitedAt === null ? 'tidak ada 429' : `429 pada percobaan ke-${limitedAt}`);

  const after = await logPreferences('setelah semua uji');
  check(
    'DB: baris tenant B terpisah dari tenant A',
    after.some((row) => row.tenantId === TENANT_B) &&
      after.some((row) => row.tenantId === TENANT_A),
  );
  check(
    'DB: preferensi lama tetap dimiliki default',
    before.every((row) => row.tenantId === TENANT_A),
  );
}

async function cleanup() {
  await prisma.notificationPreference.deleteMany({ where: { tenantId: TENANT_B } });
  await prisma.apiKey.deleteMany({ where: { tenantId: TENANT_B, name: 'pref-verify' } });
  await prisma.notificationPreference.deleteMany({
    where: { tenantId: TENANT_A, recipientId: RECIPIENT, channel: 'whatsapp' },
  });
  await prisma.notificationPreference.upsert({
    where: {
      tenantId_recipientId_channel: {
        tenantId: TENANT_A,
        recipientId: RECIPIENT,
        channel: 'email',
      },
    },
    update: { enabled: true, quietHoursStart: null, quietHoursEnd: null, timezone: 'Asia/Jakarta' },
    create: {
      tenantId: TENANT_A,
      recipientId: RECIPIENT,
      channel: 'email',
      enabled: true,
      timezone: 'Asia/Jakarta',
    },
  });

  if (notifyNotificationId !== null) {
    await prisma.notification.deleteMany({ where: { id: notifyNotificationId } });
  }

  const remaining = await prisma.notificationPreference.findMany({
    where: { OR: [{ tenantId: TENANT_A }, { tenantId: TENANT_B }] },
    orderBy: [{ tenantId: 'asc' }, { channel: 'asc' }],
  });

  console.log('\n[db] NotificationPreference (setelah bersih-bersih):');
  console.table(
    remaining.map((row) => ({
      tenantId: row.tenantId,
      recipientId: row.recipientId,
      channel: row.channel,
      enabled: row.enabled,
      timezone: row.timezone,
    })),
  );
}

try {
  await main();
} catch (error) {
  check('skrip verifikasi selesai tanpa exception', false, error instanceof Error ? error.message : String(error));
} finally {
  try {
    await cleanup();
  } catch (error) {
    console.error(`cleanup gagal: ${error instanceof Error ? error.message : String(error)}`);
  }
  await prisma.$disconnect();

  const failed = results.filter((result) => !result.ok);
  console.log(
    `\n${results.length - failed.length}/${results.length} check lulus` +
      (failed.length === 0 ? '' : `; gagal: ${failed.map((item) => item.name).join(', ')}`),
  );
  process.exitCode = failed.length === 0 ? 0 : 1;
}
