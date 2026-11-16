import { createHmac, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Channel } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createApp } from '../src/bootstrap';
import {
  TEST_ADMIN_EMAIL,
  TEST_ADMIN_PASSWORD,
  TEST_SERVICE_API_KEY,
  TEST_TENANT_B,
} from './env';
import { prisma, resetDatabase, waitFor } from './setup/database';
import { RECIPIENT, seedFixtures, TEMPLATE_KEY } from './setup/fixtures';

const SUBSCRIBER_SECRET = process.env.SUBSCRIBER_JWT_SECRET as string;
const WEBHOOK_SECRET = process.env.WEBHOOK_SIGNING_SECRET as string;

let app: NestExpressApplication;
let server: Server;
let tenantBSecret = '';
let adminToken = '';
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

  it('E6 login admin, password salah 401, platform_admin ditolak guard 403', async () => {
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

    await prisma.adminUser.create({
      data: {
        email: 'platform@test.local',
        passwordHash: bcrypt.hashSync('Platform123!', 4),
        role: 'platform_admin',
        tenantId: 'default',
        active: true,
      },
    });

    const platformLogin = await request(server)
      .post('/api/v1/admin/auth/login')
      .send({ email: 'platform@test.local', password: 'Platform123!' });
    expect(platformLogin.status).toBe(200);

    const me = await request(server)
      .get('/api/v1/admin/auth/me')
      .set('Authorization', bearer(platformLogin.body.accessToken));

    expect(me.status).toBe(403);
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
