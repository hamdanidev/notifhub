import { createHmac, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Channel } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createApp } from '../src/bootstrap';
import { AdminBootstrapService } from '../src/auth/admin/admin-bootstrap.service';
import { CleanupService } from '../src/cleanup/cleanup.service';
import {
  TEST_ADMIN_EMAIL,
  TEST_ADMIN_PASSWORD,
  TEST_PLATFORM_ADMIN_EMAIL,
  TEST_PLATFORM_ADMIN_PASSWORD,
  TEST_SERVICE_API_KEY,
  TEST_TENANT_B,
} from './env';
import { prisma, resetDatabase, waitFor } from './setup/database';
import { RECIPIENT, seedFixtures, TEMPLATE_KEY } from './setup/fixtures';

const SUBSCRIBER_SECRET = process.env.SUBSCRIBER_JWT_SECRET as string;
const WEBHOOK_SECRET = process.env.WEBHOOK_SIGNING_SECRET as string;
const ACME_SECRET = 'acme-subscriber-secret-32-characters-min';

let app: NestExpressApplication;
let server: Server;
let tenantBSecret = '';
let tenantBApiKey = '';
let adminToken = '';
let platformToken = '';
let acmeAdminToken = '';
let acmeApiKey = '';
let inAppNotificationId = '';

function bearer(token: string): string {
  return `Bearer ${token}`;
}

function subscriberToken(tenantId: string, secret: string, sub = RECIPIENT): string {
  return jwt.sign({ sub, tenant: tenantId }, secret, { algorithm: 'HS256', expiresIn: '1h' });
}

function postNotify(body: Record<string, unknown>) {
  return request(server)
    .post('/api/v1/notify')
    .set('X-API-Key', TEST_SERVICE_API_KEY)
    .send(body);
}

function notifyBody(idempotencyKey: string, channels: string[]): Record<string, unknown> {
  return {
    idempotency_key: idempotencyKey,
    template_key: TEMPLATE_KEY,
    recipients: [RECIPIENT],
    channels,
    data: { nama: 'Budi' },
  };
}

beforeAll(async () => {
  await resetDatabase();

  app = await createApp();
  // NestFactory.create only builds the container; routes and lifecycle hooks are applied in init.
  await app.init();
  server = app.getHttpServer() as Server;

  const fixtures = await seedFixtures(prisma, TEST_TENANT_B);
  tenantBSecret = fixtures.tenantBSecret;
  tenantBApiKey = fixtures.tenantBApiKey;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('NotifHub e2e', () => {
  it('E1 health live dan ready menjawab 200', async () => {
    const live = await request(server).get('/health/live');
    const ready = await request(server).get('/health/ready');

    expect(live.status).toBe(200);
    expect(ready.status).toBe(200);
  });

  it('E2 ingest menolak API key yang hilang atau salah', async () => {
    const body = notifyBody('e2e-auth-1', ['inapp']);

    const missing = await request(server).post('/api/v1/notify').send(body);
    const wrong = await request(server)
      .post('/api/v1/notify')
      .set('X-API-Key', 'definitely-not-a-valid-key')
      .send(body);

    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
  });

  it('E3 ingest inapp diterima dan worker mengirim', async () => {
    const response = await postNotify(notifyBody('e2e-inapp-1', ['inapp']));

    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({ status: 'accepted' });
    inAppNotificationId = response.body.notification_id as string;

    const recipient = await waitFor(
      async () => {
        const row = await prisma.notificationRecipient.findFirst({
          where: {
            notificationId: inAppNotificationId,
            recipientId: RECIPIENT,
            channel: Channel.inapp,
          },
          select: { status: true },
        });

        return row !== null && row.status !== 'pending' ? row : null;
      },
      'recipient in-app selesai diproses worker',
    );

    expect(recipient.status).toBe('sent');
  });

  it('E4 idempotency key yang sama tidak membuat notifikasi baru', async () => {
    const response = await postNotify(notifyBody('e2e-inapp-1', ['inapp']));

    expect(response.status).toBe(202);
    expect(response.body.notification_id).toBe(inAppNotificationId);

    const notifications = await prisma.notification.count({
      where: { idempotencyKey: 'e2e-inapp-1' },
    });
    const recipients = await prisma.notificationRecipient.count({
      where: { notificationId: inAppNotificationId },
    });

    expect(notifications).toBe(1);
    expect(recipients).toBe(1);
  });

  it('E5 tenant_id yang berbeda dari API key ditolak 400', async () => {
    const response = await postNotify({
      ...notifyBody('e2e-tenant-mismatch-1', ['inapp']),
      tenant_id: 'another-tenant',
    });

    expect(response.status).toBe(400);
    expect(String(response.body.message)).toContain('tenant_id');
  });

  it('E6 login admin, password salah 401, platform_admin ditolak di lane tenant 403', async () => {
    const login = await request(server)
      .post('/api/v1/admin/auth/login')
      .send({ email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD });

    expect(login.status).toBe(200);
    adminToken = login.body.accessToken as string;
    expect(adminToken.length).toBeGreaterThan(0);

    const wrongPassword = await request(server)
      .post('/api/v1/admin/auth/login')
      .send({ email: TEST_ADMIN_EMAIL, password: 'wrong-password' });
    expect(wrongPassword.status).toBe(401);

    // The bootstrap created this platform admin; the tenant login lane must refuse it.
    const platformLogin = await request(server)
      .post('/api/v1/admin/auth/login')
      .send({ email: TEST_PLATFORM_ADMIN_EMAIL, password: TEST_PLATFORM_ADMIN_PASSWORD });
    expect(platformLogin.status).toBe(403);
  });

  it('E31 platform admin login + me, dan tiap lane menolak token lane lain', async () => {
    const login = await request(server)
      .post('/api/v1/platform/auth/login')
      .send({ email: TEST_PLATFORM_ADMIN_EMAIL, password: TEST_PLATFORM_ADMIN_PASSWORD });

    expect(login.status).toBe(200);
    expect(login.body.admin).toMatchObject({
      email: TEST_PLATFORM_ADMIN_EMAIL,
      role: 'platform_admin',
    });
    expect(login.body.admin.tenantId).toBeUndefined();

    const platformLogin = login.body.accessToken as string;
    platformToken = platformLogin;
    const claims = jwt.decode(platformLogin) as Record<string, unknown>;
    expect(claims.role).toBe('platform_admin');
    expect(claims.tenant).toBeUndefined();

    const me = await request(server)
      .get('/api/v1/platform/auth/me')
      .set('Authorization', bearer(platformToken));
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ email: TEST_PLATFORM_ADMIN_EMAIL, role: 'platform_admin' });

    const tenantOnPlatform = await request(server)
      .get('/api/v1/platform/auth/me')
      .set('Authorization', bearer(adminToken));
    expect(tenantOnPlatform.status).toBe(403);

    const platformOnTenant = await request(server)
      .get('/api/v1/admin/auth/me')
      .set('Authorization', bearer(platformToken));
    expect(platformOnTenant.status).toBe(403);

    const wrongPassword = await request(server)
      .post('/api/v1/platform/auth/login')
      .send({ email: TEST_PLATFORM_ADMIN_EMAIL, password: 'wrong-password' });
    expect(wrongPassword.status).toBe(401);

    const tenantOnPlatformLogin = await request(server)
      .post('/api/v1/platform/auth/login')
      .send({ email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD });
    expect(tenantOnPlatformLogin.status).toBe(403);
  });

  it('E32 platform admin membuat tenant + admin, lalu isolasi data tenant terjaga', async () => {
    const created = await request(server)
      .post('/api/v1/platform/tenants')
      .set('Authorization', bearer(platformToken))
      .send({ id: 'acme', name: 'Acme Corp' });

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      id: 'acme',
      name: 'Acme Corp',
      status: 'active',
      adminCount: 0,
      apiKeyCount: 0,
    });

    const adminCreated = await request(server)
      .post('/api/v1/platform/tenants/acme/admins')
      .set('Authorization', bearer(platformToken))
      .send({ email: 'acme-admin@test.local', password: 'AcmeAdmin123!' });

    expect(adminCreated.status).toBe(201);
    expect(adminCreated.body).toMatchObject({
      email: 'acme-admin@test.local',
      role: 'tenant_admin',
      active: true,
    });

    const login = await request(server)
      .post('/api/v1/admin/auth/login')
      .send({ email: 'acme-admin@test.local', password: 'AcmeAdmin123!' });
    expect(login.status).toBe(200);
    acmeAdminToken = login.body.accessToken as string;

    const apiKey = await request(server)
      .post('/api/v1/admin/api-keys')
      .set('Authorization', bearer(acmeAdminToken))
      .send({ name: 'acme-service', subscriberJwtSecret: ACME_SECRET });
    expect(apiKey.status).toBe(201);
    acmeApiKey = apiKey.body.key as string;

    const subscriber = await request(server)
      .put('/api/v1/subscribers/user-acme')
      .set('X-API-Key', acmeApiKey)
      .send({ email: 'user-acme@example.com', locale: 'id' });
    expect(subscriber.status).toBe(200);
    expect(subscriber.body.tenantId).toBe('acme');

    const own = await request(server)
      .get('/api/v1/admin/subscribers/user-acme')
      .set('Authorization', bearer(acmeAdminToken));
    expect(own.status).toBe(200);

    const foreign = await request(server)
      .get('/api/v1/admin/subscribers/user-acme')
      .set('Authorization', bearer(adminToken));
    expect(foreign.status).toBe(404);

    const listed = await request(server)
      .get('/api/v1/platform/tenants/acme')
      .set('Authorization', bearer(platformToken));
    expect(listed.status).toBe(200);
    expect(listed.body).toMatchObject({ id: 'acme', adminCount: 1, apiKeyCount: 1 });
  });

  it('E33 suspend menolak request baru di tiga lane, resume memulihkan', async () => {
    const suspend = await request(server)
      .post('/api/v1/platform/tenants/acme/suspend')
      .set('Authorization', bearer(platformToken));
    expect(suspend.status).toBe(200);
    expect(suspend.body.status).toBe('suspended');
    expect(suspend.body.suspendedAt).not.toBeNull();

    const suspendedLogin = await request(server)
      .post('/api/v1/admin/auth/login')
      .send({ email: 'acme-admin@test.local', password: 'AcmeAdmin123!' });
    expect(suspendedLogin.status).toBe(403);
    expect(suspendedLogin.body.message).toBe('tenant_suspended');

    const adminRequest = await request(server)
      .get('/api/v1/admin/subscribers')
      .set('Authorization', bearer(acmeAdminToken));
    expect(adminRequest.status).toBe(403);
    expect(adminRequest.body.message).toBe('tenant_suspended');

    const ingest = await request(server)
      .post('/api/v1/notify')
      .set('X-API-Key', acmeApiKey)
      .send({
        idempotency_key: 'e2e-suspended-ingest-1',
        template_key: TEMPLATE_KEY,
        recipients: ['user-acme'],
        channels: ['inapp'],
        data: { nama: 'Budi' },
      });
    expect(ingest.status).toBe(403);
    expect(ingest.body.message).toBe('tenant_suspended');

    const subscriberRequest = await request(server)
      .get('/api/v1/in-app/notifications')
      .set('Authorization', bearer(subscriberToken('acme', ACME_SECRET, 'user-acme')));
    expect(subscriberRequest.status).toBe(403);
    expect(subscriberRequest.body.message).toBe('tenant_suspended');

    const platformStillWorks = await request(server)
      .get('/api/v1/platform/tenants/acme')
      .set('Authorization', bearer(platformToken));
    expect(platformStillWorks.status).toBe(200);

    const resume = await request(server)
      .post('/api/v1/platform/tenants/acme/resume')
      .set('Authorization', bearer(platformToken));
    expect(resume.status).toBe(200);
    expect(resume.body).toMatchObject({ status: 'active', suspendedAt: null });

    const adminAfterResume = await request(server)
      .get('/api/v1/admin/subscribers')
      .set('Authorization', bearer(acmeAdminToken));
    expect(adminAfterResume.status).toBe(200);
  });

  it('E34 allowedOrigins menolak origin lain dan mengizinkan request tanpa Origin', async () => {
    const keyResponse = await request(server)
      .post('/api/v1/admin/api-keys')
      .set('Authorization', bearer(adminToken))
      .send({ name: 'origin-test', allowedOrigins: ['https://app.example.com'] });
    expect(keyResponse.status).toBe(201);
    const originKey = keyResponse.body.key as string;

    const serverToServer = await request(server)
      .post('/api/v1/notify')
      .set('X-API-Key', originKey)
      .send(notifyBody('e2e-origin-1', ['inapp']));
    expect(serverToServer.status).toBe(202);

    const allowed = await request(server)
      .post('/api/v1/notify')
      .set('X-API-Key', originKey)
      .set('Origin', 'https://app.example.com')
      .send(notifyBody('e2e-origin-2', ['inapp']));
    expect(allowed.status).toBe(202);

    const blocked = await request(server)
      .post('/api/v1/notify')
      .set('X-API-Key', originKey)
      .set('Origin', 'https://evil.example.com')
      .send(notifyBody('e2e-origin-3', ['inapp']));
    expect(blocked.status).toBe(403);
    expect(blocked.body.message).toBe('origin_not_allowed');
  });

  it('E35 audit platform mencatat mutasi dan bisa difilter', async () => {
    const all = await request(server)
      .get('/api/v1/platform/audit?tenantId=acme')
      .set('Authorization', bearer(platformToken));

    expect(all.status).toBe(200);
    expect(all.body.total).toBeGreaterThanOrEqual(4);

    const actions = (all.body.items as { action: string }[]).map((item) => item.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'tenant.created',
        'tenant.admin.created',
        'tenant.suspended',
        'tenant.resumed',
      ]),
    );

    const suspended = await request(server)
      .get('/api/v1/platform/audit?tenantId=acme&action=tenant.suspended')
      .set('Authorization', bearer(platformToken));

    expect(suspended.status).toBe(200);
    expect(
      (suspended.body.items as { action: string }[]).every(
        (item) => item.action === 'tenant.suspended',
      ),
    ).toBe(true);

    const entry = all.body.items[0] as {
      actorEmail: string;
      targetType: string;
      occurredAt: string;
    };
    expect(entry.actorEmail).toBe(TEST_PLATFORM_ADMIN_EMAIL);
    expect(entry.targetType).toBe('tenant');
    expect(Number.isNaN(Date.parse(entry.occurredAt))).toBe(false);
  });

  it('E36 delete tenant hanya untuk tenant kosong dan default dilindungi', async () => {
    const withData = await request(server)
      .delete('/api/v1/platform/tenants/acme')
      .set('Authorization', bearer(platformToken));
    expect(withData.status).toBe(409);
    expect(withData.body.message).toBe('tenant_not_empty');

    const created = await request(server)
      .post('/api/v1/platform/tenants')
      .set('Authorization', bearer(platformToken))
      .send({ id: 'empty-tenant', name: 'Empty Tenant' });
    expect(created.status).toBe(201);

    const deleted = await request(server)
      .delete('/api/v1/platform/tenants/empty-tenant')
      .set('Authorization', bearer(platformToken));
    expect(deleted.status).toBe(204);

    const gone = await request(server)
      .get('/api/v1/platform/tenants/empty-tenant')
      .set('Authorization', bearer(platformToken));
    expect(gone.status).toBe(404);

    const protectedTenant = await request(server)
      .delete('/api/v1/platform/tenants/default')
      .set('Authorization', bearer(platformToken));
    expect(protectedTenant.status).toBe(403);
    expect(protectedTenant.body.message).toBe('tenant_protected');
  });

  it('E37 bootstrap idempoten saat dijalankan ulang', async () => {
    const before = {
      tenants: await prisma.tenant.count(),
      admins: await prisma.adminUser.count(),
    };

    await app.get(AdminBootstrapService).onApplicationBootstrap();

    const after = {
      tenants: await prisma.tenant.count(),
      admins: await prisma.adminUser.count(),
    };

    expect(after).toEqual(before);
    expect(await prisma.tenant.count({ where: { id: 'default' } })).toBe(1);
  });

  it('E7 admin tenant A tidak bisa membaca data tenant B', async () => {
    const own = await request(server)
      .get(`/api/v1/admin/subscribers/${RECIPIENT}`)
      .set('Authorization', bearer(adminToken));
    expect(own.status).toBe(200);
    expect(own.body.tenantId).toBe('default');

    const foreign = await request(server)
      .get('/api/v1/admin/subscribers/only-in-tenant-b')
      .set('Authorization', bearer(adminToken));
    expect(foreign.status).toBe(404);

    const list = await request(server)
      .get('/api/v1/admin/subscribers?limit=50')
      .set('Authorization', bearer(adminToken));
    expect(list.status).toBe(200);
    expect(
      (list.body.items as { tenantId: string }[]).every((item) => item.tenantId === 'default'),
    ).toBe(true);
  });

  it('E8 lane subscriber memakai secret per tenant tanpa downgrade', async () => {
    const noToken = await request(server).get('/api/v1/in-app/notifications');
    expect(noToken.status).toBe(401);

    const downgrade = await request(server)
      .get('/api/v1/in-app/notifications')
      .set('Authorization', bearer(subscriberToken(TEST_TENANT_B, SUBSCRIBER_SECRET)));
    expect(downgrade.status).toBe(401);

    const tenantB = await request(server)
      .get('/api/v1/in-app/notifications')
      .set('Authorization', bearer(subscriberToken(TEST_TENANT_B, tenantBSecret)));
    expect(tenantB.status).toBe(200);

    const tenantA = await request(server)
      .get('/api/v1/in-app/notifications')
      .set('Authorization', bearer(subscriberToken('default', SUBSCRIBER_SECRET)));
    expect(tenantA.status).toBe(200);
  });

  it('E30 idempotency key yang sama di dua tenant menghasilkan notifikasi berbeda', async () => {
    const sharedKey = 'e2e-shared-idempotency-1';

    const tenantA = await postNotify({
      idempotency_key: sharedKey,
      template_key: TEMPLATE_KEY,
      recipients: [RECIPIENT],
      channels: ['inapp'],
      data: { nama: 'Budi' },
    });

    const tenantB = await request(server)
      .post('/api/v1/notify')
      .set('X-API-Key', tenantBApiKey)
      .send({
        idempotency_key: sharedKey,
        template_key: TEMPLATE_KEY,
        recipients: ['only-in-tenant-b'],
        channels: ['inapp'],
        data: { nama: 'Budi' },
      });

    expect(tenantA.status).toBe(202);
    expect(tenantB.status).toBe(202);
    expect(tenantB.body.notification_id).not.toBe(tenantA.body.notification_id);

    const rows = await prisma.notification.findMany({
      where: { idempotencyKey: sharedKey },
      select: { id: true, tenantId: true },
    });

    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.tenantId))).toEqual(new Set(['default', TEST_TENANT_B]));
  });

  it('E9 preference center menonaktifkan email dan worker menghormatinya', async () => {
    const token = bearer(subscriberToken('default', SUBSCRIBER_SECRET));

    const snapshot = await request(server)
      .get('/api/v1/subscriber/preferences')
      .set('Authorization', token);

    expect(snapshot.status).toBe(200);
    expect(
      (snapshot.body.channels as { channel: string }[]).map((item) => item.channel),
    ).toEqual(['inapp', 'email', 'whatsapp']);
    expect(
      (snapshot.body.channels as { isDefault: boolean }[]).every((item) => item.isDefault === true),
    ).toBe(true);

    const update = await request(server)
      .put('/api/v1/subscriber/preferences/email')
      .set('Authorization', token)
      .send({ enabled: false });

    expect(update.status).toBe(200);
    expect(update.body).toMatchObject({ channel: 'email', enabled: false, isDefault: false });

    const stored = await prisma.notificationPreference.findUnique({
      where: {
        tenantId_recipientId_channel: {
          tenantId: 'default',
          recipientId: RECIPIENT,
          channel: Channel.email,
        },
      },
    });
    expect(stored?.enabled).toBe(false);

    const notifyResponse = await postNotify(notifyBody('e2e-pref-email-1', ['email']));
    expect(notifyResponse.status).toBe(202);

    const skipped = await waitFor(
      async () => {
        const row = await prisma.notificationRecipient.findFirst({
          where: {
            notificationId: notifyResponse.body.notification_id as string,
            recipientId: RECIPIENT,
            channel: Channel.email,
          },
          select: { status: true, lastError: true },
        });

        return row !== null && row.status !== 'pending' ? row : null;
      },
      'recipient email ditandai skipped karena preferensi',
    );

    expect(skipped).toMatchObject({ status: 'skipped', lastError: 'preference_disabled' });

    const tenantB = await request(server)
      .get('/api/v1/subscriber/preferences')
      .set('Authorization', bearer(subscriberToken(TEST_TENANT_B, tenantBSecret)));

    const tenantBEmail = (tenantB.body.channels as { channel: string; isDefault: boolean }[]).find(
      (item) => item.channel === 'email',
    );
    expect(tenantBEmail?.isDefault).toBe(true);
  });

  it('E10 webhook signed memperbarui status dan menolak signature/provider salah', async () => {
    const token = bearer(subscriberToken('default', SUBSCRIBER_SECRET));

    await request(server)
      .put('/api/v1/subscriber/preferences/email')
      .set('Authorization', token)
      .send({ enabled: true });

    const notifyResponse = await postNotify(notifyBody('e2e-webhook-1', ['email']));
    expect(notifyResponse.status).toBe(202);
    const notificationId = notifyResponse.body.notification_id as string;

    await waitFor(
      async () => {
        const row = await prisma.notificationRecipient.findFirst({
          where: { notificationId, recipientId: RECIPIENT, channel: Channel.email },
          select: { status: true },
        });

        return row !== null && row.status !== 'pending' ? row : null;
      },
      'recipient email selesai diproses worker',
    );

    const payload = JSON.stringify({
      eventId: 'evt-e2e-1',
      eventType: 'delivered',
      notificationId,
      recipientId: RECIPIENT,
      channel: 'email',
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac('sha256', WEBHOOK_SECRET)
      .update(`${timestamp}.${payload}`)
      .digest('hex');

    const accepted = await request(server)
      .post('/api/v1/webhooks/smtp')
      .set('Content-Type', 'application/json')
      .set('X-NotifHub-Signature', `t=${timestamp},v1=${signature}`)
      .send(payload);

    expect(accepted.status).toBe(202);

    const event = await prisma.deliveryEvent.findFirst({ where: { notificationId } });
    expect(event).not.toBeNull();

    const delivered = await prisma.notificationRecipient.findFirst({
      where: { notificationId, channel: Channel.email },
    });
    expect(delivered?.deliveredAt).not.toBeNull();

    const rejected = await request(server)
      .post('/api/v1/webhooks/smtp')
      .set('Content-Type', 'application/json')
      .set('X-NotifHub-Signature', `t=${timestamp},v1=deadbeef`)
      .send(payload);
    expect(rejected.status).toBe(401);

    const unknownProvider = await request(server)
      .post('/api/v1/webhooks/unknown')
      .set('Content-Type', 'application/json')
      .set('X-NotifHub-Signature', `t=${timestamp},v1=${signature}`)
      .send(payload);
    expect(unknownProvider.status).toBe(404);
  });

  it('E11 admin resend failed membuat notification baru dengan audit link', async () => {
    const source = await postNotify(notifyBody('e2e-resend-source-1', ['inapp', 'email']));
    expect(source.status).toBe(202);
    const sourceId = source.body.notification_id as string;

    await waitFor(
      async () => {
        const row = await prisma.notificationRecipient.findFirst({
          where: { notificationId: sourceId, recipientId: RECIPIENT, channel: Channel.inapp },
          select: { status: true },
        });

        return row !== null && row.status !== 'pending' ? row : null;
      },
      'source notification selesai diproses sebelum disimulasikan gagal',
    );

    await prisma.notificationRecipient.updateMany({
      where: { notificationId: sourceId, recipientId: RECIPIENT, channel: Channel.inapp },
      data: { status: 'failed', lastError: 'forced_e2e_failure' },
    });

    const requestKey = randomUUID();
    const resend = await request(server)
      .post(`/api/v1/admin/notifications/${sourceId}/resend`)
      .set('Authorization', bearer(adminToken))
      .send({ mode: 'failed', requestKey });

    expect(resend.status).toBe(202);
    expect(resend.body).toMatchObject({
      status: 'accepted',
      mode: 'failed',
      recipient_count: 1,
      channels: ['inapp'],
    });

    const resendId = resend.body.notification_id as string;
    expect(resendId).not.toBe(sourceId);

    const created = await prisma.notification.findUnique({
      where: { id: resendId },
      include: { recipients: true },
    });
    expect(created?.resendOfNotificationId).toBe(sourceId);
    expect(created?.resendMode).toBe('failed');
    expect(created?.recipients).toHaveLength(1);

    const billingEvents = await prisma.billingEvent.count({ where: { notificationId: resendId } });
    expect(billingEvents).toBe(0);

    const replay = await request(server)
      .post(`/api/v1/admin/notifications/${sourceId}/resend`)
      .set('Authorization', bearer(adminToken))
      .send({ mode: 'failed', requestKey });
    expect(replay.status).toBe(202);
    expect(replay.body.notification_id).toBe(resendId);

    const detail = await request(server)
      .get(`/api/v1/admin/notifications/${resendId}`)
      .set('Authorization', bearer(adminToken));
    expect(detail.status).toBe(200);
    expect(detail.body.notification.resendOfNotificationId).toBe(sourceId);
    expect(detail.body.notification.payload.data.nama).toBe('Budi');

    const noFailed = await request(server)
      .post(`/api/v1/admin/notifications/${inAppNotificationId}/resend`)
      .set('Authorization', bearer(adminToken))
      .send({ mode: 'failed', requestKey: randomUUID() });
    expect(noFailed.status).toBe(409);
  });
});

describe('Template system e2e', () => {
  const TEMPLATE_KEY_E2E = 'order.shipped.e2e';
  let layoutId = '';
  let themeId = '';
  let headerPartialId = '';
  let footerPartialId = '';
  let draftId = '';
  let publishedId = '';

  const variables = {
    version: 1,
    variables: [
      { key: 'customer.name', type: 'string', required: true, example: 'Budi' },
      { key: 'order.number', type: 'string', required: true, example: 'INV-001' },
      { key: 'cta.url', type: 'url', required: true, example: 'https://example.com/orders/1' },
    ],
  };
  const sampleData = {
    customer: { name: 'Budi' },
    order: { number: 'INV-001' },
    cta: { url: 'https://example.com/orders/1' },
  };
  const emailBody =
    '<p style="font-family:Arial,sans-serif">Halo {{customer.name}},</p>' +
    '<p>Pesanan {{order.number}} sudah dikirim.</p>' +
    '<p><a href="{{cta.url}}" style="color:{{theme.brand.primary}}">Lacak pesanan</a></p>';

  it('E12 membuat aset, draft, preview, publish, lalu worker mengirim email', async () => {
    const layout = await request(server)
      .post('/api/v1/admin/template-assets/layouts')
      .set('Authorization', bearer(adminToken))
      .send({
        key: 'base-e2e',
        name: 'Base E2E',
        content:
          '<!doctype html><html><head><meta charset="utf-8"></head>' +
          '<body style="background:{{theme.brand.background}}">' +
          '<header>{{> header}}</header><main>{{{body}}}</main><footer>{{> footer}}</footer>' +
          '</body></html>',
      });
    expect(layout.status).toBe(201);
    layoutId = layout.body.id as string;

    const theme = await request(server)
      .post('/api/v1/admin/template-assets/themes')
      .set('Authorization', bearer(adminToken))
      .send({
        key: 'brand-e2e',
        name: 'Brand E2E',
        tokens: {
          brand: { primary: '#0d6efd', background: '#ffffff' },
          text: { primary: '#111111' },
        },
      });
    expect(theme.status).toBe(201);
    themeId = theme.body.id as string;

    const header = await request(server)
      .post('/api/v1/admin/template-assets/partials')
      .set('Authorization', bearer(adminToken))
      .send({
        key: 'header',
        name: 'Header E2E',
        content: '<p style="font-weight:bold">NotifHub · {{customer.name}}</p>',
      });
    expect(header.status).toBe(201);
    headerPartialId = header.body.id as string;

    const footer = await request(server)
      .post('/api/v1/admin/template-assets/partials')
      .set('Authorization', bearer(adminToken))
      .send({
        key: 'footer',
        name: 'Footer E2E',
        content: '<p style="font-size:12px">Jangan balas email ini.</p>',
      });
    expect(footer.status).toBe(201);
    footerPartialId = footer.body.id as string;

    const created = await request(server)
      .post('/api/v1/admin/templates')
      .set('Authorization', bearer(adminToken))
      .send({
        key: TEMPLATE_KEY_E2E,
        channel: 'email',
        locale: 'id',
        format: 'html',
        status: 'draft',
        subject: 'Pesanan {{order.number}} dikirim',
        preheader: 'Kabar baik untuk {{customer.name}}',
        body: emailBody,
        layoutId,
        themeId,
        partialIds: [headerPartialId, footerPartialId],
        variables,
        sampleData,
        strictVariables: true,
      });

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      key: TEMPLATE_KEY_E2E,
      status: 'draft',
      active: false,
      format: 'html',
    });
    expect(Array.isArray(created.body.validation)).toBe(true);
    draftId = created.body.id as string;

    const notPublished = await prisma.notificationTemplate.findUnique({
      where: { id: draftId },
      select: { status: true, active: true },
    });
    expect(notPublished).toMatchObject({ status: 'draft', active: false });

    const preview = await request(server)
      .post(`/api/v1/admin/templates/${draftId}/preview`)
      .set('Authorization', bearer(adminToken))
      .send({ sampleData });
    expect(preview.status).toBe(200);
    expect(preview.body.errors).toEqual([]);
    expect(preview.body.subject).toBe('Pesanan INV-001 dikirim');
    expect(preview.body.html).toContain('Halo Budi');
    expect(preview.body.resolved.layout.version).toBe(1);
    expect(preview.body.resolved.partials).toHaveLength(2);

    const publish = await request(server)
      .post(`/api/v1/admin/templates/${draftId}/publish`)
      .set('Authorization', bearer(adminToken))
      .send({ expectedRevision: created.body.revision as number, note: 'E2E publish' });
    expect(publish.status).toBe(200);
    expect(publish.body).toMatchObject({ status: 'published', active: true });
    publishedId = publish.body.id as string;

    const audit = await request(server)
      .get(`/api/v1/admin/templates/${publishedId}/audit`)
      .set('Authorization', bearer(adminToken));
    expect(audit.status).toBe(200);
    expect(audit.body.items.map((item: { action: string }) => item.action)).toEqual(
      expect.arrayContaining(['created', 'published']),
    );

    const notify = await postNotify({
      idempotency_key: `e2e-template-${randomUUID()}`,
      template_key: TEMPLATE_KEY_E2E,
      recipients: [RECIPIENT],
      channels: ['email'],
      data: sampleData,
    });
    expect(notify.status).toBe(202);

    const recipient = await waitFor(
      async () => {
        const row = await prisma.notificationRecipient.findFirst({
          where: {
            notificationId: notify.body.notification_id as string,
            recipientId: RECIPIENT,
            channel: Channel.email,
          },
          select: { status: true, lastError: true },
        });

        return row !== null && row.status !== 'pending' ? row : null;
      },
      'email template baru selesai diproses worker',
    );
    expect(recipient.status).toBe('sent');
  });

  it('E13 preview menolak HTML berbahaya dan publish memblokir draft tidak valid', async () => {
    const unsafePreview = await request(server)
      .post('/api/v1/admin/templates/preview')
      .set('Authorization', bearer(adminToken))
      .send({
        channel: 'email',
        format: 'html',
        subject: 'Unsafe',
        body: '<p>ok</p><script>alert(1)</script>',
        variables: { version: 1, variables: [] },
        sampleData: {},
      });

    expect(unsafePreview.status).toBe(200);
    expect(
      unsafePreview.body.errors.some(
        (issue: { code: string }) => issue.code === 'unsafe_html',
      ),
    ).toBe(true);
    expect(unsafePreview.body.html).not.toContain('<script>');

    const noSubject = await request(server)
      .post('/api/v1/admin/templates')
      .set('Authorization', bearer(adminToken))
      .send({
        key: 'invalid.subject.e2e',
        channel: 'email',
        locale: 'id',
        format: 'html',
        status: 'draft',
        body: '<p>Halo</p>',
        variables: { version: 1, variables: [] },
        sampleData: {},
      });
    expect(noSubject.status).toBe(201);
    expect(
      noSubject.body.validation.some(
        (issue: { code: string }) => issue.code === 'missing_subject',
      ),
    ).toBe(true);

    const publish = await request(server)
      .post(`/api/v1/admin/templates/${noSubject.body.id as string}/publish`)
      .set('Authorization', bearer(adminToken))
      .send({ expectedRevision: 0 });
    expect(publish.status).toBe(422);
    expect(publish.body.details.code).toBe('template_validation_failed');

    const whatsapp = await request(server)
      .post('/api/v1/admin/templates')
      .set('Authorization', bearer(adminToken))
      .send({
        key: 'too.long.whatsapp.e2e',
        channel: 'whatsapp',
        locale: 'id',
        format: 'text',
        status: 'draft',
        body: 'x'.repeat(4_097),
        variables: { version: 1, variables: [] },
        sampleData: {},
      });
    expect(whatsapp.status).toBe(201);

    const whatsappPublish = await request(server)
      .post(`/api/v1/admin/templates/${whatsapp.body.id as string}/publish`)
      .set('Authorization', bearer(adminToken))
      .send({ expectedRevision: 0 });
    expect(whatsappPublish.status).toBe(422);
  });

  it('E14 clone, rollback, versions, dan isolasi tenant', async () => {
    const clone = await request(server)
      .post(`/api/v1/admin/templates/${publishedId}/clone`)
      .set('Authorization', bearer(adminToken))
      .send({ locale: 'en', note: 'clone EN' });
    expect(clone.status).toBe(201);
    expect(clone.body).toMatchObject({ locale: 'en', status: 'draft', active: false });

    const rollback = await request(server)
      .post(`/api/v1/admin/templates/${publishedId}/rollback`)
      .set('Authorization', bearer(adminToken))
      .send({ sourceVersion: 1, note: 'rollback E2E' });
    expect(rollback.status).toBe(201);
    expect(rollback.body).toMatchObject({ status: 'draft', active: false });
    expect(rollback.body.version).toBeGreaterThan(1);

    const versions = await request(server)
      .get(`/api/v1/admin/templates/${publishedId}/versions`)
      .set('Authorization', bearer(adminToken));
    expect(versions.status).toBe(200);
    expect(versions.body.length).toBeGreaterThanOrEqual(2);

    const otherTenantTemplate = await prisma.notificationTemplate.create({
      data: {
        tenantId: TEST_TENANT_B,
        key: 'tenant-b.template',
        channel: Channel.inapp,
        locale: 'id',
        version: 1,
        body: 'tenant b',
        format: 'text',
        status: 'published',
        active: true,
      },
      select: { id: true },
    });

    const hidden = await request(server)
      .get(`/api/v1/admin/templates/${otherTenantTemplate.id}`)
      .set('Authorization', bearer(adminToken));
    expect(hidden.status).toBe(404);

    const hiddenPreview = await request(server)
      .post(`/api/v1/admin/templates/${otherTenantTemplate.id}/preview`)
      .set('Authorization', bearer(adminToken))
      .send({});
    expect(hiddenPreview.status).toBe(404);
  });

  it('E15 test send email dev log-only, replay idempotent, dan in-app ditolak', async () => {
    const requestKey = randomUUID();
    const sent = await request(server)
      .post(`/api/v1/admin/templates/${publishedId}/test-send`)
      .set('Authorization', bearer(adminToken))
      .send({ recipient: 'qa@example.com', requestKey, sampleData });

    expect(sent.status).toBe(200);
    expect(sent.body).toMatchObject({
      status: 'simulated',
      mode: 'development',
      channel: 'email',
      provider: 'smtp',
    });
    expect(sent.body.auditId).toBeTruthy();

    const replay = await request(server)
      .post(`/api/v1/admin/templates/${publishedId}/test-send`)
      .set('Authorization', bearer(adminToken))
      .send({ recipient: 'qa@example.com', requestKey, sampleData });
    expect(replay.status).toBe(200);
    expect(replay.body.auditId).toBe(sent.body.auditId);

    const inApp = await request(server)
      .post('/api/v1/admin/templates')
      .set('Authorization', bearer(adminToken))
      .send({
        key: 'inapp.test.send.e2e',
        channel: 'inapp',
        locale: 'id',
        format: 'text',
        status: 'published',
        body: 'Halo {{nama}}',
        variables: {
          version: 1,
          variables: [{ key: 'nama', type: 'string', required: true, example: 'Budi' }],
        },
        sampleData: { nama: 'Budi' },
      });
    expect(inApp.status).toBe(201);

    const inAppTestSend = await request(server)
      .post(`/api/v1/admin/templates/${inApp.body.id as string}/test-send`)
      .set('Authorization', bearer(adminToken))
      .send({ recipient: 'user@example.com' });
    expect(inAppTestSend.status).toBe(400);

    const testSends = await request(server)
      .get(`/api/v1/admin/templates/${publishedId}/test-sends`)
      .set('Authorization', bearer(adminToken));
    expect(testSends.status).toBe(200);
    expect(testSends.body.items[0]).toMatchObject({ recipientMasked: 'q***@example.com' });
  });

  it('E16 escaping sadar-channel: teks mempertahankan & dan subject email tidak HTML-escape', async () => {
    const textPreview = await request(server)
      .post('/api/v1/admin/templates/preview')
      .set('Authorization', bearer(adminToken))
      .send({
        channel: 'inapp',
        format: 'text',
        body: 'Halo {{nama}} & rekan',
        variables: {
          version: 1,
          variables: [{ key: 'nama', type: 'string', required: true, example: 'Budi' }],
        },
        sampleData: { nama: 'Budi & Co' },
      });

    expect(textPreview.status).toBe(200);
    expect(textPreview.body.text).toContain('Budi & Co');
    expect(textPreview.body.text).not.toContain('&amp;');

    const emailPreview = await request(server)
      .post('/api/v1/admin/templates/preview')
      .set('Authorization', bearer(adminToken))
      .send({
        channel: 'email',
        format: 'html',
        subject: 'Halo {{nama}}',
        body: '<p>{{nama}}</p>',
        variables: {
          version: 1,
          variables: [{ key: 'nama', type: 'string', required: true, example: 'Budi' }],
        },
        sampleData: { nama: 'Budi & Co' },
      });

    expect(emailPreview.status).toBe(200);
    expect(emailPreview.body.subject).toBe('Halo Budi & Co');
  });

  it('E17 test send dibatasi rate limit per admin', async () => {
    const admin = await prisma.adminUser.findFirst({
      where: { email: TEST_ADMIN_EMAIL },
      select: { id: true },
    });
    expect(admin).not.toBeNull();

    await prisma.templateTestSend.deleteMany({
      where: { tenantId: 'default', requestedByAdminId: admin?.id ?? '' },
    });

    for (let index = 0; index < 10; index += 1) {
      await prisma.templateTestSend.create({
        data: {
          tenantId: 'default',
          templateId: publishedId,
          templateVersion: 1,
          channel: Channel.email,
          recipientMasked: `q***@example.com`,
          recipientHash: `hash-${index}`,
          status: 'simulated',
          requestedByAdminId: admin?.id ?? null,
        },
      });
    }

    const limited = await request(server)
      .post(`/api/v1/admin/templates/${publishedId}/test-send`)
      .set('Authorization', bearer(adminToken))
      .send({ recipient: 'qa@example.com' });
    expect(limited.status).toBe(429);
  });

  it('E18 payload admin >64 KB diterima, ingest tetap dibatasi 64 KB', async () => {
    const largeBody = `<p>${'x'.repeat(70_000)}</p>`;
    const created = await request(server)
      .post('/api/v1/admin/templates')
      .set('Authorization', bearer(adminToken))
      .send({
        key: 'large.body.e2e',
        channel: 'email',
        locale: 'id',
        format: 'html',
        status: 'draft',
        subject: 'Large body',
        body: largeBody,
        variables: { version: 1, variables: [] },
        sampleData: {},
      });
    expect(created.status).toBe(201);

    const oversizedIngest = await postNotify({
      idempotency_key: `e2e-large-${randomUUID()}`,
      template_key: TEMPLATE_KEY,
      recipients: [RECIPIENT],
      channels: ['inapp'],
      data: { blob: 'x'.repeat(70_000) },
    });
    expect(oversizedIngest.status).toBe(413);
  });

  it('E19 legacy create/update published tetap live lewat versi baru tanpa memutasi baris lama', async () => {
    const create = await request(server)
      .post('/api/v1/admin/templates')
      .set('Authorization', bearer(adminToken))
      .send({
        key: 'legacy.update.e2e',
        channel: 'email',
        locale: 'id',
        subject: 'Legacy v1',
        body: '<p>versi 1 {{nama}}</p>',
        variables: {
          version: 1,
          variables: [{ key: 'nama', type: 'string', required: true, example: 'Budi' }],
        },
        sampleData: { nama: 'Budi' },
      });
    expect(create.status).toBe(201);
    expect(create.body).toMatchObject({ status: 'published', active: true, version: 1 });

    const oldId = create.body.id as string;
    const update = await request(server)
      .put(`/api/v1/admin/templates/${oldId}`)
      .set('Authorization', bearer(adminToken))
      .send({ body: '<p>versi 2 {{nama}}</p>', subject: 'Legacy v2' });

    expect(update.status).toBe(200);
    expect(update.body).toMatchObject({ status: 'published', active: true, version: 2 });
    expect(update.body.id).not.toBe(oldId);

    const oldRow = await prisma.notificationTemplate.findUnique({
      where: { id: oldId },
      select: { body: true, active: true },
    });
    expect(oldRow).toMatchObject({ body: '<p>versi 1 {{nama}}</p>', active: false });

    const audit = await prisma.templateAuditEvent.findFirst({
      where: { templateId: update.body.id as string, action: 'published' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit?.metadata).toMatchObject({ legacyPut: true });

    const summary = await request(server)
      .get('/api/v1/admin/templates?view=summary&search=legacy.update.e2e')
      .set('Authorization', bearer(adminToken));
    expect(summary.status).toBe(200);
    expect(summary.body.items[0].body).toBeNull();
    expect(summary.body.items[0].bodyPreview).toContain('versi 2');
  });

  it('E20 builderData tersimpan, diperbarui, dipublish, dan diclone tanpa memengaruhi worker', async () => {
    const builderData = {
      version: 1,
      blocks: [
        { id: 'b1', type: 'heading', text: 'Halo {{nama}}', level: 1 },
        { id: 'b2', type: 'text', text: 'Pesanan sudah dikirim.' },
      ],
    };

    const created = await request(server)
      .post('/api/v1/admin/templates')
      .set('Authorization', bearer(adminToken))
      .send({
        key: 'builder.e2e',
        channel: 'email',
        locale: 'id',
        format: 'html',
        status: 'draft',
        subject: 'Builder {{nama}}',
        body: '<p>Halo {{nama}}</p><p>Pesanan sudah dikirim.</p>',
        variables: {
          version: 1,
          variables: [{ key: 'nama', type: 'string', required: true, example: 'Budi' }],
        },
        sampleData: { nama: 'Budi' },
        builderData,
      });
    expect(created.status).toBe(201);
    expect(created.body.builderData).toEqual(builderData);

    const stored = await prisma.notificationTemplate.findUnique({
      where: { id: created.body.id as string },
      select: { builderData: true, status: true },
    });
    expect(stored).toMatchObject({ status: 'draft' });
    expect(stored?.builderData).toEqual(builderData);

    const updated = await request(server)
      .put(`/api/v1/admin/templates/${created.body.id as string}`)
      .set('Authorization', bearer(adminToken))
      .send({
        body: '<p>Halo {{nama}}</p><p>Pesanan sudah dikirim (versi 2).</p>',
        builderData: {
          version: 1,
          blocks: [
            { id: 'b1', type: 'heading', text: 'Halo {{nama}}', level: 1 },
            { id: 'b2', type: 'text', text: 'Pesanan sudah dikirim (versi 2).' },
          ],
        },
        expectedRevision: 0,
      });
    expect(updated.status).toBe(200);
    expect(updated.body.builderData.blocks[1].text).toContain('versi 2');

    const publish = await request(server)
      .post(`/api/v1/admin/templates/${created.body.id as string}/publish`)
      .set('Authorization', bearer(adminToken))
      .send({ expectedRevision: updated.body.revision as number });
    expect(publish.status).toBe(200);
    expect(publish.body.status).toBe('published');

    const clone = await request(server)
      .post(`/api/v1/admin/templates/${created.body.id as string}/clone`)
      .set('Authorization', bearer(adminToken))
      .send({ locale: 'en' });
    expect(clone.status).toBe(201);
    expect(clone.body.builderData).toEqual(updated.body.builderData);
  });

  it('E21 menolak builderData invalid tanpa membuat baris', async () => {
    const base = {
      channel: 'email',
      locale: 'id',
      format: 'html',
      status: 'draft',
      subject: 'Builder invalid',
      body: '<p>Halo</p>',
      variables: { version: 1, variables: [] },
      sampleData: {},
    };
    const tooMany = Array.from({ length: 201 }, (_, index) => ({
      id: `b${index}`,
      type: 'text',
      text: 'x',
    }));
    const tooLarge = Array.from({ length: 7 }, (_, index) => ({
      id: `big${index}`,
      type: 'text',
      text: 'x'.repeat(10_000),
    }));
    const cases: Array<{ name: string; builderData: unknown; code: string }> = [
      { name: 'version', builderData: { version: 2, blocks: [] }, code: 'builder_unsupported_version' },
      {
        name: 'type',
        builderData: { version: 1, blocks: [{ id: 'b1', type: 'video', text: 'x' }] },
        code: 'builder_unknown_block_type',
      },
      {
        name: 'field',
        builderData: { version: 1, blocks: [{ id: 'b1', type: 'text', text: 'x', extra: true }] },
        code: 'builder_unknown_field',
      },
      {
        name: 'url',
        builderData: {
          version: 1,
          blocks: [{ id: 'i1', type: 'image', url: 'javascript:alert(1)' }],
        },
        code: 'builder_url_unsafe',
      },
      {
        name: 'duplicate',
        builderData: {
          version: 1,
          blocks: [
            { id: 'dup', type: 'text', text: 'a' },
            { id: 'dup', type: 'text', text: 'b' },
          ],
        },
        code: 'builder_duplicate_id',
      },
      { name: 'too-many', builderData: { version: 1, blocks: tooMany }, code: 'builder_too_many_blocks' },
      { name: 'too-large', builderData: { version: 1, blocks: tooLarge }, code: 'builder_too_large' },
    ];

    for (const item of cases) {
      const response = await request(server)
        .post('/api/v1/admin/templates')
        .set('Authorization', bearer(adminToken))
        .send({ ...base, key: `builder.invalid.${item.name}.e2e`, builderData: item.builderData });

      expect(response.status).toBe(422);
      expect(response.body.details.code).toBe('template_validation_failed');
      expect(
        (response.body.details.errors as Array<{ code: string }>).map((issue) => issue.code),
      ).toContain(item.code);
    }

    const nonEmail = await request(server)
      .post('/api/v1/admin/templates')
      .set('Authorization', bearer(adminToken))
      .send({
        key: 'builder.invalid.channel.e2e',
        channel: 'inapp',
        locale: 'id',
        format: 'text',
        status: 'draft',
        body: 'Halo',
        variables: { version: 1, variables: [] },
        sampleData: {},
        builderData: { version: 1, blocks: [{ id: 'b1', type: 'text', text: 'Halo' }] },
      });

    expect(nonEmail.status).toBe(422);
    expect(nonEmail.body.details.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'builder_channel_mismatch' }),
      ]),
    );
  });

  it('E22 menormalkan builderData valid dan menolak update invalid', async () => {
    const created = await request(server)
      .post('/api/v1/admin/templates')
      .set('Authorization', bearer(adminToken))
      .send({
        key: 'builder.normalize.e2e',
        channel: 'email',
        locale: 'id',
        format: 'html',
        status: 'draft',
        subject: 'Builder normalisasi',
        body: '<p>Halo {{nama}}</p>',
        variables: {
          version: 1,
          variables: [{ key: 'nama', type: 'string', required: true, example: 'Budi' }],
        },
        sampleData: { nama: 'Budi' },
        builderData: {
          version: 1,
          blocks: [
            { id: 'h1', type: 'heading', text: 'Halo {{nama}}' },
            { id: 'i1', type: 'image', url: 'https://example.com/a.png' },
          ],
        },
      });

    expect(created.status).toBe(201);
    expect(created.body.builderData).toEqual({
      version: 1,
      blocks: [
        { id: 'h1', type: 'heading', text: 'Halo {{nama}}', level: 1 },
        { id: 'i1', type: 'image', url: 'https://example.com/a.png', alt: '', width: '552' },
      ],
    });

    const invalidUpdate = await request(server)
      .put(`/api/v1/admin/templates/${created.body.id as string}`)
      .set('Authorization', bearer(adminToken))
      .send({
        builderData: { version: 2, blocks: [] },
        expectedRevision: created.body.revision as number,
      });

    expect(invalidUpdate.status).toBe(422);
    expect(invalidUpdate.body.details.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'builder_unsupported_version' }),
      ]),
    );

    const stored = await prisma.notificationTemplate.findUnique({
      where: { id: created.body.id as string },
      select: { builderData: true },
    });
    expect(stored?.builderData).toEqual(created.body.builderData);
  });

  it('E23 preview email menghasilkan plain-text dari HTML final', async () => {
    const preview = await request(server)
      .post('/api/v1/admin/templates/preview')
      .set('Authorization', bearer(adminToken))
      .send({
        channel: 'email',
        format: 'html',
        subject: 'Halo {{nama}}',
        body:
          '<div data-nh-text-skip>Preheader internal</div>' +
          '<p>Halo {{nama}} &amp; rekan,</p>' +
          '<p><a href="{{cta.url}}">Lacak pesanan</a></p>' +
          '<img src="https://example.com/p.png" alt="Paket">',
        variables: {
          version: 1,
          variables: [
            { key: 'nama', type: 'string', required: true, example: 'Budi' },
            { key: 'cta.url', type: 'url', required: true, example: 'https://example.com/orders/1' },
          ],
        },
        sampleData: {
          nama: 'Budi & Co',
          cta: { url: 'https://example.com/orders/1' },
        },
      });

    expect(preview.status).toBe(200);
    expect(preview.body.html).not.toBeNull();
    expect(preview.body.text).toContain('Halo Budi & Co & rekan,');
    expect(preview.body.text).toContain('Lacak pesanan (https://example.com/orders/1)');
    expect(preview.body.text).toContain('Paket');
    expect(preview.body.text).not.toContain('Preheader internal');
    expect(preview.body.text).not.toContain('<p>');
  });

  it('E24 cleanup menghapus audit/test send lewat batas retensi', async () => {
    const day = 86_400_000;
    const oldAudit = await prisma.templateAuditEvent.create({
      data: {
        tenantId: 'default',
        templateId: publishedId,
        templateVersion: 1,
        action: 'test_sent',
        note: 'retention-old',
        metadata: { seed: 'old' },
        createdAt: new Date(Date.now() - 800 * day),
      },
      select: { id: true },
    });
    const recentAudit = await prisma.templateAuditEvent.create({
      data: {
        tenantId: 'default',
        templateId: publishedId,
        templateVersion: 1,
        action: 'test_sent',
        note: 'retention-recent',
        metadata: { seed: 'recent' },
        createdAt: new Date(),
      },
      select: { id: true },
    });
    const oldTestSend = await prisma.templateTestSend.create({
      data: {
        tenantId: 'default',
        templateId: publishedId,
        templateVersion: 1,
        channel: Channel.email,
        recipientMasked: 'r***@example.com',
        recipientHash: `retention-old-${randomUUID()}`,
        status: 'simulated',
        createdAt: new Date(Date.now() - 200 * day),
      },
      select: { id: true },
    });
    const recentTestSend = await prisma.templateTestSend.create({
      data: {
        tenantId: 'default',
        templateId: publishedId,
        templateVersion: 1,
        channel: Channel.email,
        recipientMasked: 'r***@example.com',
        recipientHash: `retention-recent-${randomUUID()}`,
        status: 'simulated',
        createdAt: new Date(),
      },
      select: { id: true },
    });

    const cleanup = app.get(CleanupService);
    const result = await cleanup.runTemplateTelemetryCleanup();

    expect(result.auditDeleted).toBeGreaterThanOrEqual(1);
    expect(result.testSendDeleted).toBeGreaterThanOrEqual(1);
    expect(
      await prisma.templateAuditEvent.findUnique({ where: { id: oldAudit.id } }),
    ).toBeNull();
    expect(
      await prisma.templateTestSend.findUnique({ where: { id: oldTestSend.id } }),
    ).toBeNull();
    expect(
      await prisma.templateAuditEvent.findUnique({ where: { id: recentAudit.id } }),
    ).not.toBeNull();
    expect(
      await prisma.templateTestSend.findUnique({ where: { id: recentTestSend.id } }),
    ).not.toBeNull();

    await prisma.templateAuditEvent.deleteMany({
      where: { id: { in: [recentAudit.id] } },
    });
    await prisma.templateTestSend.deleteMany({
      where: { id: { in: [recentTestSend.id] } },
    });
  });

  it('E25 memberi warning dua kolom bila layout tidak mendukung stacking', async () => {
    const noStackLayout = await request(server)
      .post('/api/v1/admin/template-assets/layouts')
      .set('Authorization', bearer(adminToken))
      .send({
        key: 'no-stack-e2e',
        name: 'No stack E2E',
        content: '<!doctype html><html><body>{{{body}}}</body></html>',
      });
    expect(noStackLayout.status).toBe(201);

    const withCssLayout = await request(server)
      .post('/api/v1/admin/template-assets/layouts')
      .set('Authorization', bearer(adminToken))
      .send({
        key: 'stack-e2e',
        name: 'Stack E2E',
        content:
          '<!doctype html><html><head><style>' +
          '@media only screen and (max-width:480px){.nh-col{display:block;width:100%}}' +
          '</style></head><body>{{{body}}}</body></html>',
      });
    expect(withCssLayout.status).toBe(201);

    const builderData = {
      version: 1,
      blocks: [{ id: 'c1', type: 'columns', left: 'Kiri', right: 'Kanan' }],
    };
    const base = {
      channel: 'email',
      locale: 'id',
      format: 'html',
      status: 'draft',
      subject: 'Dua kolom',
      body: '<p>Dua kolom</p>',
      variables: { version: 1, variables: [] },
      sampleData: {},
      builderData,
    };

    const missing = await request(server)
      .post('/api/v1/admin/templates')
      .set('Authorization', bearer(adminToken))
      .send({
        ...base,
        key: 'two-column.missing.e2e',
        layoutId: noStackLayout.body.id as string,
      });
    expect(missing.status).toBe(201);
    expect(
      (missing.body.validation as Array<{ code: string }>).some(
        (issue) => issue.code === 'two_column_css_missing',
      ),
    ).toBe(true);

    const supported = await request(server)
      .post('/api/v1/admin/templates')
      .set('Authorization', bearer(adminToken))
      .send({
        ...base,
        key: 'two-column.supported.e2e',
        layoutId: withCssLayout.body.id as string,
      });
    expect(supported.status).toBe(201);
    expect(
      (supported.body.validation as Array<{ code: string }>).some(
        (issue) => issue.code === 'two_column_css_missing',
      ),
    ).toBe(false);
  });

  it('E26 builderData legacy invalid tetap bisa dipublish dengan warning dan tidak disalin saat clone', async () => {
    const legacy = await prisma.notificationTemplate.create({
      data: {
        tenantId: 'default',
        key: 'builder.legacy.invalid.e2e',
        channel: Channel.email,
        locale: 'id',
        subject: 'Legacy builder',
        body: '<p>Halo</p>',
        format: 'html',
        status: 'draft',
        active: false,
        version: 1,
        variables: { version: 1, variables: [] },
        sampleData: {},
        builderData: { version: 2, blocks: [] },
      },
      select: { id: true },
    });

    const publish = await request(server)
      .post(`/api/v1/admin/templates/${legacy.id}/publish`)
      .set('Authorization', bearer(adminToken))
      .send({ expectedRevision: 0 });

    expect(publish.status).toBe(200);
    expect(publish.body.status).toBe('published');
    expect(
      (publish.body.validation as Array<{ code: string }>).some(
        (issue) => issue.code === 'builder_legacy_invalid',
      ),
    ).toBe(true);

    const clone = await request(server)
      .post(`/api/v1/admin/templates/${legacy.id}/clone`)
      .set('Authorization', bearer(adminToken))
      .send({ locale: 'en' });

    expect(clone.status).toBe(201);
    expect(clone.body.builderData).toBeNull();
    expect(
      (clone.body.validation as Array<{ code: string }>).some(
        (issue) => issue.code === 'builder_legacy_invalid',
      ),
    ).toBe(true);
  });

  it('E27 usage count dan proteksi hapus aset', async () => {
    const usedLayout = await request(server)
      .get(`/api/v1/admin/template-assets/layouts/${layoutId}`)
      .set('Authorization', bearer(adminToken));
    expect(usedLayout.status).toBe(200);
    expect(usedLayout.body.usageCount).toBeGreaterThan(0);

    const blockedLayout = await request(server)
      .delete(`/api/v1/admin/template-assets/layouts/${layoutId}`)
      .set('Authorization', bearer(adminToken));
    expect(blockedLayout.status).toBe(409);
    expect(blockedLayout.body.details).toMatchObject({
      code: 'asset_in_use',
      assetType: 'layout',
    });

    const usedTheme = await request(server)
      .get(`/api/v1/admin/template-assets/themes/${themeId}`)
      .set('Authorization', bearer(adminToken));
    expect(usedTheme.status).toBe(200);
    expect(usedTheme.body.usageCount).toBeGreaterThan(0);

    const blockedTheme = await request(server)
      .delete(`/api/v1/admin/template-assets/themes/${themeId}`)
      .set('Authorization', bearer(adminToken));
    expect(blockedTheme.status).toBe(409);
    expect(blockedTheme.body.details.code).toBe('asset_in_use');

    const blockedPartial = await request(server)
      .delete(`/api/v1/admin/template-assets/partials/${headerPartialId}`)
      .set('Authorization', bearer(adminToken));
    expect(blockedPartial.status).toBe(409);
    expect(blockedPartial.body.details.code).toBe('asset_in_use');

    const unusedLayout = await request(server)
      .post('/api/v1/admin/template-assets/layouts')
      .set('Authorization', bearer(adminToken))
      .send({
        key: 'delete-unused-e2e',
        name: 'Delete unused E2E',
        content: '<!doctype html><html><body>{{{body}}}</body></html>',
      });
    expect(unusedLayout.status).toBe(201);
    expect(unusedLayout.body.usageCount).toBe(0);

    const deletedLayout = await request(server)
      .delete(`/api/v1/admin/template-assets/layouts/${unusedLayout.body.id as string}`)
      .set('Authorization', bearer(adminToken));
    expect(deletedLayout.status).toBe(204);

    const missingLayout = await request(server)
      .get(`/api/v1/admin/template-assets/layouts/${unusedLayout.body.id as string}`)
      .set('Authorization', bearer(adminToken));
    expect(missingLayout.status).toBe(404);

    const unusedTheme = await request(server)
      .post('/api/v1/admin/template-assets/themes')
      .set('Authorization', bearer(adminToken))
      .send({
        key: 'delete-unused-theme-e2e',
        name: 'Delete unused theme E2E',
        tokens: { brand: { primary: '#0d6efd' } },
      });
    expect(unusedTheme.status).toBe(201);

    const deletedTheme = await request(server)
      .delete(`/api/v1/admin/template-assets/themes/${unusedTheme.body.id as string}`)
      .set('Authorization', bearer(adminToken));
    expect(deletedTheme.status).toBe(204);

    const unusedPartial = await request(server)
      .post('/api/v1/admin/template-assets/partials')
      .set('Authorization', bearer(adminToken))
      .send({
        key: 'delete-unused-partial-e2e',
        name: 'Delete unused partial E2E',
        content: '<p>Unused</p>',
      });
    expect(unusedPartial.status).toBe(201);

    const deletedPartial = await request(server)
      .delete(`/api/v1/admin/template-assets/partials/${unusedPartial.body.id as string}`)
      .set('Authorization', bearer(adminToken));
    expect(deletedPartial.status).toBe(204);

    const tenantBAsset = await prisma.templateLayout.create({
      data: {
        tenantId: TEST_TENANT_B,
        key: 'tenant-b-layout',
        version: 1,
        name: 'Tenant B layout',
        content: '<!doctype html><html><body>{{{body}}}</body></html>',
      },
      select: { id: true },
    });

    const crossTenantDelete = await request(server)
      .delete(`/api/v1/admin/template-assets/layouts/${tenantBAsset.id}`)
      .set('Authorization', bearer(adminToken));
    expect(crossTenantDelete.status).toBe(404);

    const tenantBAssetStillThere = await prisma.templateLayout.findUnique({
      where: { id: tenantBAsset.id },
      select: { id: true },
    });
    expect(tenantBAssetStillThere).not.toBeNull();
  });

  it('E28 mencatat templateId/version per recipient dan menampilkannya di admin detail', async () => {
    const created = await request(server)
      .post('/api/v1/admin/templates')
      .set('Authorization', bearer(adminToken))
      .send({
        key: 'version.tracking.e2e',
        channel: 'email',
        locale: 'id',
        subject: 'Versi 1',
        body: '<p>Versi 1</p>',
        variables: { version: 1, variables: [] },
        sampleData: {},
      });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('published');

    const firstNotify = await postNotify({
      idempotency_key: `e2e-version-1-${randomUUID()}`,
      template_key: 'version.tracking.e2e',
      recipients: [RECIPIENT],
      channels: ['email'],
      data: {},
    });
    expect(firstNotify.status).toBe(202);
    const firstNotificationId = firstNotify.body.notification_id as string;

    const firstRecipient = await waitFor(
      async () => {
        const row = await prisma.notificationRecipient.findFirst({
          where: {
            notificationId: firstNotificationId,
            recipientId: RECIPIENT,
            channel: Channel.email,
          },
          select: {
            status: true,
            templateId: true,
            templateVersion: true,
            templateResolvedAt: true,
          },
        });

        return row !== null && row.status !== 'pending' ? row : null;
      },
      'recipient versi 1 selesai diproses',
    );
    expect(firstRecipient).toMatchObject({
      templateId: created.body.id,
      templateVersion: 1,
    });
    expect(firstRecipient.templateResolvedAt).not.toBeNull();

    const detail = await request(server)
      .get(`/api/v1/admin/notifications/${firstNotificationId}`)
      .set('Authorization', bearer(adminToken));
    expect(detail.status).toBe(200);
    const detailRecipient = (detail.body.recipients as Array<Record<string, unknown>>).find(
      (recipient) => recipient.channel === 'email',
    );
    expect(detailRecipient).toMatchObject({
      templateId: created.body.id,
      templateVersion: 1,
    });

    const updated = await request(server)
      .put(`/api/v1/admin/templates/${created.body.id as string}`)
      .set('Authorization', bearer(adminToken))
      .send({ subject: 'Versi 2', body: '<p>Versi 2</p>' });
    expect(updated.status).toBe(200);
    expect(updated.body.version).toBe(2);
    expect(updated.body.id).not.toBe(created.body.id);

    const secondNotify = await postNotify({
      idempotency_key: `e2e-version-2-${randomUUID()}`,
      template_key: 'version.tracking.e2e',
      recipients: [RECIPIENT],
      channels: ['email'],
      data: {},
    });
    expect(secondNotify.status).toBe(202);
    const secondNotificationId = secondNotify.body.notification_id as string;

    const secondRecipient = await waitFor(
      async () => {
        const row = await prisma.notificationRecipient.findFirst({
          where: {
            notificationId: secondNotificationId,
            recipientId: RECIPIENT,
            channel: Channel.email,
          },
          select: { status: true, templateId: true, templateVersion: true },
        });

        return row !== null && row.status !== 'pending' ? row : null;
      },
      'recipient versi 2 selesai diproses',
    );
    expect(secondRecipient).toMatchObject({
      templateId: updated.body.id,
      templateVersion: 2,
    });

    const firstStillVersionOne = await prisma.notificationRecipient.findFirst({
      where: {
        notificationId: firstNotificationId,
        recipientId: RECIPIENT,
        channel: Channel.email,
      },
      select: { templateId: true, templateVersion: true },
    });
    expect(firstStillVersionOne).toMatchObject({
      templateId: created.body.id,
      templateVersion: 1,
    });
  });

  it('E29 upload gambar tervalidasi dan disajikan publik', async () => {
    const pixelPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2ZQAAAABJRU5ErkJggg==',
      'base64',
    );

    const uploaded = await request(server)
      .post('/api/v1/admin/template-assets/images')
      .set('Authorization', bearer(adminToken))
      .attach('file', pixelPng, { filename: 'pixel.png', contentType: 'image/png' });

    expect(uploaded.status).toBe(201);
    expect(uploaded.body).toMatchObject({
      mimeType: 'image/png',
      width: 1,
      height: 1,
      size: pixelPng.length,
    });
    expect(uploaded.body.url).toContain(`/api/v1/template-images/${uploaded.body.id as string}`);

    const publicPath = new URL(uploaded.body.url as string).pathname;
    const served = await request(server).get(publicPath);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toContain('image/png');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(served.headers['cache-control']).toContain('immutable');

    const list = await request(server)
      .get('/api/v1/admin/template-assets/images')
      .set('Authorization', bearer(adminToken));
    expect(list.status).toBe(200);
    expect(
      (list.body.items as Array<{ id: string }>).some((item) => item.id === uploaded.body.id),
    ).toBe(true);

    const disguised = await request(server)
      .post('/api/v1/admin/template-assets/images')
      .set('Authorization', bearer(adminToken))
      .attach('file', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), {
        filename: 'fake.png',
        contentType: 'image/png',
      });

    expect(disguised.status).toBe(400);
    expect(disguised.body.details.code).toBe('invalid_image');

    const tooLarge = await request(server)
      .post('/api/v1/admin/template-assets/images')
      .set('Authorization', bearer(adminToken))
      .attach('file', Buffer.alloc(5_242_881), {
        filename: 'too-large.png',
        contentType: 'image/png',
      });

    expect(tooLarge.status).toBe(413);
    expect(tooLarge.body.details.code).toBe('image_too_large');

    const missing = await request(server)
      .post('/api/v1/admin/template-assets/images')
      .set('Authorization', bearer(adminToken))
      .send({});

    expect(missing.status).toBe(400);
    expect(missing.body.details.code).toBe('image_file_missing');

    await prisma.templateImage.deleteMany({
      where: { id: uploaded.body.id as string },
    });
  });
});

describe('Admin hardening e2e', () => {
  it('E38 ganti password memverifikasi password lama dan mencabut token lama', async () => {
    const email = `password-${randomUUID()}@test.local`;
    const oldPassword = 'OldPassword123!';
    const newPassword = 'NewPassword456!';
    const admin = await prisma.adminUser.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(oldPassword, 4),
        role: 'tenant_admin',
        tenantId: 'default',
      },
    });
    const token = jwt.sign(
      {
        sub: admin.id,
        email,
        role: 'tenant_admin',
        tenant: 'default',
        tokenVersion: 0,
      },
      process.env.ADMIN_JWT_SECRET as string,
      { algorithm: 'HS256', expiresIn: '1h' },
    );

    const wrongCurrent = await request(server)
      .post('/api/v1/admin/auth/change-password')
      .set('Authorization', bearer(token))
      .send({ currentPassword: 'WrongPassword123!', newPassword });
    expect(wrongCurrent.status).toBe(400);
    expect(wrongCurrent.body.details.code).toBe('invalid_current_password');

    const unchanged = await request(server)
      .post('/api/v1/admin/auth/change-password')
      .set('Authorization', bearer(token))
      .send({ currentPassword: oldPassword, newPassword: oldPassword });
    expect(unchanged.status).toBe(400);
    expect(unchanged.body.details.code).toBe('password_unchanged');

    const changed = await request(server)
      .post('/api/v1/admin/auth/change-password')
      .set('Authorization', bearer(token))
      .send({ currentPassword: oldPassword, newPassword });
    expect(changed.status).toBe(204);

    const oldTokenRejected = await request(server)
      .get('/api/v1/admin/auth/me')
      .set('Authorization', bearer(token));
    expect(oldTokenRejected.status).toBe(401);

    const updated = await prisma.adminUser.findUniqueOrThrow({ where: { id: admin.id } });
    expect(updated.tokenVersion).toBe(1);
    expect(await bcrypt.compare(newPassword, updated.passwordHash)).toBe(true);
    expect(await bcrypt.compare(oldPassword, updated.passwordHash)).toBe(false);

    await prisma.adminUser.delete({ where: { id: admin.id } });
  });

  it('E39 search notifikasi memakai ID/recipient exact dan tetap tenant-scoped', async () => {
    const recipient = `search-${randomUUID()}`;
    const created = await request(server)
      .post('/api/v1/notify')
      .set('X-API-Key', TEST_SERVICE_API_KEY)
      .send({
        idempotency_key: `e2e-search-${randomUUID()}`,
        template_key: TEMPLATE_KEY,
        recipients: [recipient],
        channels: ['inapp'],
        data: { nama: 'Budi' },
      });
    expect(created.status).toBe(202);
    const notificationId = created.body.notification_id as string;

    const byId = await request(server)
      .get(`/api/v1/admin/notifications?search=${encodeURIComponent(notificationId)}`)
      .set('Authorization', bearer(adminToken));
    expect(byId.status).toBe(200);
    expect(byId.body.total).toBe(1);
    expect(byId.body.items[0].id).toBe(notificationId);

    const byRecipient = await request(server)
      .get(`/api/v1/admin/notifications?search=${encodeURIComponent(recipient)}`)
      .set('Authorization', bearer(adminToken));
    expect(byRecipient.status).toBe(200);
    expect(byRecipient.body.total).toBeGreaterThanOrEqual(1);
    expect(
      (byRecipient.body.items as Array<{ id: string }>).some((item) => item.id === notificationId),
    ).toBe(true);

    const missing = await request(server)
      .get(`/api/v1/admin/notifications?search=${randomUUID()}`)
      .set('Authorization', bearer(adminToken));
    expect(missing.status).toBe(200);
    expect(missing.body.total).toBe(0);

    // Insert tenant B directly so the search isolation check does not enqueue a worker job.
    const tenantBRecipient = `tenant-b-${randomUUID()}`;
    const tenantBNotification = await prisma.notification.create({
      data: {
        tenantId: TEST_TENANT_B,
        idempotencyKey: `e2e-search-b-${randomUUID()}`,
        idempotencyExpiresAt: new Date(Date.now() + 60_000),
        templateKey: TEMPLATE_KEY,
        payload: {},
        targetSnapshot: { recipient_ids: [tenantBRecipient], channels: ['inapp'] },
        recipients: {
          create: [{ recipientId: tenantBRecipient, channel: Channel.inapp }],
        },
      },
    });
    const tenantBNotificationId = tenantBNotification.id;

    const isolated = await request(server)
      .get(`/api/v1/admin/notifications?search=${encodeURIComponent(tenantBNotificationId)}`)
      .set('Authorization', bearer(adminToken));
    expect(isolated.status).toBe(200);
    expect(isolated.body.total).toBe(0);
  });

  it('E40 bootstrap tidak menimpa password yang diubah dari console', async () => {
    const newPassword = 'BootstrapNew123!';
    const changed = await request(server)
      .post('/api/v1/admin/auth/change-password')
      .set('Authorization', bearer(adminToken))
      .send({ currentPassword: TEST_ADMIN_PASSWORD, newPassword });
    expect(changed.status).toBe(204);

    const afterChange = await prisma.adminUser.findUniqueOrThrow({
      where: { email: TEST_ADMIN_EMAIL },
    });
    expect(await bcrypt.compare(newPassword, afterChange.passwordHash)).toBe(true);

    // A restart re-runs bootstrap; it must not revert the UI password because the env hash did
    // not change (bootstrapPasswordHash still tracks the old env value).
    await app.get(AdminBootstrapService).onApplicationBootstrap();

    const afterBootstrap = await prisma.adminUser.findUniqueOrThrow({
      where: { email: TEST_ADMIN_EMAIL },
    });
    expect(await bcrypt.compare(newPassword, afterBootstrap.passwordHash)).toBe(true);
    expect(afterBootstrap.tokenVersion).toBe(afterChange.tokenVersion);

    // Restore the env-backed password so the test database is left in a predictable state.
    await prisma.adminUser.update({
      where: { id: afterBootstrap.id },
      data: {
        passwordHash: await bcrypt.hash(TEST_ADMIN_PASSWORD, 4),
        tokenVersion: { increment: 1 },
      },
    });

    // The password change invalidated the original token; sign a fresh one so later suites
    // (export/resend) can keep using the same admin without another throttled login.
    const restored = await prisma.adminUser.findUniqueOrThrow({ where: { id: afterBootstrap.id } });
    adminToken = jwt.sign(
      {
        sub: restored.id,
        email: TEST_ADMIN_EMAIL,
        role: 'tenant_admin',
        tenant: 'default',
        tokenVersion: restored.tokenVersion,
      },
      process.env.ADMIN_JWT_SECRET as string,
      { algorithm: 'HS256', expiresIn: '1h' },
    );
  });
});

describe('Console operations e2e', () => {
  it('E41 export notifikasi memakai filter, batas, dan tenant isolation', async () => {
    const recipient = `export-${randomUUID()}`;
    const created = await request(server)
      .post('/api/v1/notify')
      .set('X-API-Key', TEST_SERVICE_API_KEY)
      .send({
        idempotency_key: `e2e-export-${randomUUID()}`,
        template_key: TEMPLATE_KEY,
        recipients: [recipient],
        channels: ['inapp'],
        data: { nama: 'Budi' },
      });
    expect(created.status).toBe(202);
    const notificationId = created.body.notification_id as string;

    const byId = await request(server)
      .get(`/api/v1/admin/notifications/export?search=${encodeURIComponent(notificationId)}`)
      .set('Authorization', bearer(adminToken));
    expect(byId.status).toBe(200);
    expect(byId.body.total).toBe(1);
    expect(byId.body.limit).toBe(5000);
    expect(byId.body.truncated).toBe(false);
    expect(byId.body.items[0]).toMatchObject({ id: notificationId, templateKey: TEMPLATE_KEY });

    const invalidLimit = await request(server)
      .get('/api/v1/admin/notifications/export?limit=5001')
      .set('Authorization', bearer(adminToken));
    expect(invalidLimit.status).toBe(400);

    const truncated = await request(server)
      .get('/api/v1/admin/notifications/export?limit=1')
      .set('Authorization', bearer(adminToken));
    expect(truncated.status).toBe(200);
    expect(truncated.body.items).toHaveLength(1);
    expect(truncated.body.truncated).toBe(true);

    const tenantBNotification = await prisma.notification.create({
      data: {
        tenantId: TEST_TENANT_B,
        idempotencyKey: `e2e-export-b-${randomUUID()}`,
        idempotencyExpiresAt: new Date(Date.now() + 60_000),
        templateKey: TEMPLATE_KEY,
        payload: {},
      },
    });
    const isolated = await request(server)
      .get(`/api/v1/admin/notifications/export?search=${tenantBNotification.id}`)
      .set('Authorization', bearer(adminToken));
    expect(isolated.status).toBe(200);
    expect(isolated.body.total).toBe(0);
  });

  it('E42 resend all mengirim semua non-SMS, failed-only tetap gagal saja', async () => {
    const otherRecipient = `resend-all-${randomUUID()}`;
    const source = await request(server)
      .post('/api/v1/notify')
      .set('X-API-Key', TEST_SERVICE_API_KEY)
      .send({
        idempotency_key: `e2e-resend-all-${randomUUID()}`,
        template_key: TEMPLATE_KEY,
        recipients: [RECIPIENT, otherRecipient],
        channels: ['inapp', 'sms'],
        data: { nama: 'Budi' },
      });
    expect(source.status).toBe(202);
    const sourceId = source.body.notification_id as string;

    await waitFor(
      async () => {
        const rows = await prisma.notificationRecipient.findMany({
          where: { notificationId: sourceId, channel: Channel.inapp },
          select: { status: true },
        });

        return rows.length === 2 && rows.every((row) => row.status !== 'pending') ? rows : null;
      },
      'recipient in-app selesai diproses sebelum resend all',
    );

    await prisma.notificationRecipient.updateMany({
      where: { notificationId: sourceId, recipientId: RECIPIENT, channel: Channel.inapp },
      data: { status: 'failed', lastError: 'forced_e2e_failure' },
    });
    await prisma.notificationRecipient.updateMany({
      where: { notificationId: sourceId, recipientId: otherRecipient, channel: Channel.inapp },
      data: { status: 'sent', sentAt: new Date() },
    });

    const requestKey = randomUUID();
    const all = await request(server)
      .post(`/api/v1/admin/notifications/${sourceId}/resend`)
      .set('Authorization', bearer(adminToken))
      .send({ mode: 'all', requestKey });
    expect(all.status).toBe(202);
    expect(all.body).toMatchObject({
      status: 'accepted',
      mode: 'all',
      recipient_count: 2,
      channels: ['inapp'],
    });

    const allNotificationId = all.body.notification_id as string;
    const allCreated = await prisma.notification.findUniqueOrThrow({
      where: { id: allNotificationId },
      include: { recipients: true },
    });
    expect(allCreated.resendOfNotificationId).toBe(sourceId);
    expect(allCreated.resendMode).toBe('all');
    expect(allCreated.recipients).toHaveLength(2);
    expect(allCreated.recipients.every((row) => row.channel === Channel.inapp)).toBe(true);
    expect(
      await prisma.billingEvent.count({ where: { notificationId: allNotificationId } }),
    ).toBe(0);

    await waitFor(
      async () => {
        const rows = await prisma.notificationRecipient.findMany({
          where: { notificationId: allNotificationId },
          select: { status: true },
        });

        return rows.every((row) => row.status !== 'pending') ? rows : null;
      },
      'resend all selesai diproses worker',
    );

    const replay = await request(server)
      .post(`/api/v1/admin/notifications/${sourceId}/resend`)
      .set('Authorization', bearer(adminToken))
      .send({ mode: 'all', requestKey });
    expect(replay.status).toBe(202);
    expect(replay.body.notification_id).toBe(allNotificationId);

    const failedOnly = await request(server)
      .post(`/api/v1/admin/notifications/${sourceId}/resend`)
      .set('Authorization', bearer(adminToken))
      .send({ mode: 'failed', requestKey: randomUUID() });
    expect(failedOnly.status).toBe(202);
    expect(failedOnly.body).toMatchObject({ mode: 'failed', recipient_count: 1 });

    const failedOnlyId = failedOnly.body.notification_id as string;
    await waitFor(
      async () => {
        const rows = await prisma.notificationRecipient.findMany({
          where: { notificationId: failedOnlyId },
          select: { status: true },
        });

        return rows.every((row) => row.status !== 'pending') ? rows : null;
      },
      'resend failed-only selesai diproses worker',
    );
  });

  it('E43 audit admin tenant mencatat mutasi, filter, dan isolasi tenant', async () => {
    const keyName = `audit-key-${randomUUID()}`;
    const createdKey = await request(server)
      .post('/api/v1/admin/api-keys')
      .set('Authorization', bearer(adminToken))
      .send({ name: keyName });
    expect(createdKey.status).toBe(201);
    const apiKeyId = createdKey.body.id as string;

    const filtered = await request(server)
      .get('/api/v1/admin/audit?action=admin.api_key.created&limit=100')
      .set('Authorization', bearer(adminToken));
    expect(filtered.status).toBe(200);

    const event = (filtered.body.items as Array<Record<string, unknown>>).find(
      (item) => item.targetId === apiKeyId,
    );
    expect(event).toBeDefined();
    expect(event).toMatchObject({
      actorEmail: TEST_ADMIN_EMAIL,
      action: 'admin.api_key.created',
      targetType: 'api_key',
      targetId: apiKeyId,
      metadata: { name: keyName },
    });
    expect(typeof event?.requestId).toBe('string');
    expect(JSON.stringify(event?.metadata)).not.toContain(createdKey.body.key as string);

    const tooLarge = await request(server)
      .get('/api/v1/admin/audit?limit=101')
      .set('Authorization', bearer(adminToken));
    expect(tooLarge.status).toBe(400);

    await prisma.adminAuditEvent.create({
      data: {
        tenantId: TEST_TENANT_B,
        actorAdminId: 'tenant-b-admin',
        actorEmail: 'b@test.local',
        action: 'e2e.audit.tenant_b',
        targetType: 'test',
        targetId: 'tenant-b-only',
      },
    });
    const isolated = await request(server)
      .get('/api/v1/admin/audit?action=e2e.audit.tenant_b')
      .set('Authorization', bearer(adminToken));
    expect(isolated.status).toBe(200);
    expect(isolated.body.total).toBe(0);

    const resendAudit = await request(server)
      .get('/api/v1/admin/audit?action=admin.notification.resend&limit=100')
      .set('Authorization', bearer(adminToken));
    expect(resendAudit.status).toBe(200);
    expect(resendAudit.body.total).toBeGreaterThanOrEqual(2);

    const passwordAudit = await request(server)
      .get('/api/v1/admin/audit?action=admin.password.changed&limit=100')
      .set('Authorization', bearer(adminToken));
    expect(passwordAudit.status).toBe(200);
    expect(passwordAudit.body.total).toBeGreaterThanOrEqual(2);
  });

  it('E44 compose mengirim lewat ingest, idempoten, dan tenant-scoped', async () => {
    const recipient = `compose-${randomUUID()}`;
    const requestKey = randomUUID();
    const payload = {
      requestKey,
      templateKey: TEMPLATE_KEY,
      recipients: [recipient],
      channels: ['inapp'],
      data: { nama: 'Budi' },
      priority: 'normal',
    };

    const created = await request(server)
      .post('/api/v1/admin/notifications')
      .set('Authorization', bearer(adminToken))
      .send(payload);
    expect(created.status).toBe(202);
    const notificationId = created.body.notification_id as string;

    const notification = await prisma.notification.findUniqueOrThrow({
      where: { id: notificationId },
      include: { recipients: true },
    });
    expect(notification.tenantId).toBe('default');
    expect(notification.recipients).toHaveLength(1);
    expect(await prisma.billingEvent.count({ where: { notificationId } })).toBe(1);

    await waitFor(
      async () => {
        const row = await prisma.notificationRecipient.findFirst({
          where: { notificationId, recipientId: recipient, channel: Channel.inapp },
          select: { status: true },
        });

        return row !== null && row.status !== 'pending' ? row : null;
      },
      'compose selesai diproses worker',
    );

    const replay = await request(server)
      .post('/api/v1/admin/notifications')
      .set('Authorization', bearer(adminToken))
      .send(payload);
    expect(replay.status).toBe(202);
    expect(replay.body.notification_id).toBe(notificationId);
    expect(await prisma.billingEvent.count({ where: { notificationId } })).toBe(1);

    const audit = await request(server)
      .get('/api/v1/admin/audit?action=admin.notification.composed&limit=100')
      .set('Authorization', bearer(adminToken));
    expect(audit.status).toBe(200);
    const event = (audit.body.items as Array<Record<string, unknown>>).find(
      (item) => item.targetId === notificationId,
    );
    expect(event).toMatchObject({
      actorEmail: TEST_ADMIN_EMAIL,
      targetType: 'notification',
      metadata: { template_key: TEMPLATE_KEY, channels: ['inapp'] },
    });

    const missingTarget = await request(server)
      .post('/api/v1/admin/notifications')
      .set('Authorization', bearer(adminToken))
      .send({
        requestKey: randomUUID(),
        templateKey: TEMPLATE_KEY,
        channels: ['inapp'],
      });
    expect(missingTarget.status).toBe(400);

    const emptyChannels = await request(server)
      .post('/api/v1/admin/notifications')
      .set('Authorization', bearer(adminToken))
      .send({ ...payload, requestKey: randomUUID(), channels: [] });
    expect(emptyChannels.status).toBe(400);

    const acmeTemplate = await request(server)
      .post('/api/v1/admin/templates')
      .set('Authorization', bearer(acmeAdminToken))
      .send({
        key: TEMPLATE_KEY,
        channel: Channel.inapp,
        locale: 'id',
        body: 'Halo {{nama}}',
        active: true,
      });
    expect(acmeTemplate.status).toBe(201);

    const acmeRecipient = `acme-compose-${randomUUID()}`;
    const acmeCompose = await request(server)
      .post('/api/v1/admin/notifications')
      .set('Authorization', bearer(acmeAdminToken))
      .send({
        requestKey: randomUUID(),
        templateKey: TEMPLATE_KEY,
        recipients: [acmeRecipient],
        channels: ['inapp'],
        data: { nama: 'Acme' },
      });
    expect(acmeCompose.status).toBe(202);
    const acmeNotificationId = acmeCompose.body.notification_id as string;

    const foreign = await request(server)
      .get(`/api/v1/admin/notifications/${acmeNotificationId}`)
      .set('Authorization', bearer(adminToken));
    expect(foreign.status).toBe(404);

    await waitFor(
      async () => {
        const row = await prisma.notificationRecipient.findFirst({
          where: {
            notificationId: acmeNotificationId,
            recipientId: acmeRecipient,
            channel: Channel.inapp,
          },
          select: { status: true },
        });

        return row !== null && row.status !== 'pending' ? row : null;
      },
      'compose acme selesai diproses worker',
    );
  });

  it('E45 cleanup audit admin menghapus event lama, menyisakan yang baru, dan idempoten', async () => {
    const day = 86_400_000;
    const oldEvent = await prisma.adminAuditEvent.create({
      data: {
        tenantId: 'default',
        actorAdminId: 'retention-admin',
        actorEmail: 'retention@test.local',
        action: 'e2e.audit.retention_old',
        targetType: 'test',
        targetId: `old-${randomUUID()}`,
        metadata: { seed: 'old' },
        occurredAt: new Date(Date.now() - 800 * day),
      },
      select: { id: true },
    });
    const recentEvent = await prisma.adminAuditEvent.create({
      data: {
        tenantId: 'default',
        actorAdminId: 'retention-admin',
        actorEmail: 'retention@test.local',
        action: 'e2e.audit.retention_recent',
        targetType: 'test',
        targetId: `recent-${randomUUID()}`,
        metadata: { seed: 'recent' },
        occurredAt: new Date(),
      },
      select: { id: true },
    });

    const cleanup = app.get(CleanupService);
    const first = await cleanup.runAdminAuditCleanup();
    expect(first.deleted).toBeGreaterThanOrEqual(1);
    expect(
      await prisma.adminAuditEvent.findUnique({ where: { id: oldEvent.id } }),
    ).toBeNull();
    expect(
      await prisma.adminAuditEvent.findUnique({ where: { id: recentEvent.id } }),
    ).not.toBeNull();

    const second = await cleanup.runAdminAuditCleanup();
    expect(second.deleted).toBe(0);
    expect(
      await prisma.adminAuditEvent.findUnique({ where: { id: recentEvent.id } }),
    ).not.toBeNull();

    await prisma.adminAuditEvent.deleteMany({ where: { id: recentEvent.id } });
  });
});
