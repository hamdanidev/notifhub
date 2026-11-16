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
});
