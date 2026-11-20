import { Channel } from '@prisma/client';
import { WahaWebhookService } from '../src/webhooks/waha/waha-webhook.service';

const messageId = '3EB0ACKTEST';

function createService(result: 'applied' | 'unmatched' | 'deleted' = 'applied') {
  const applyDeliveryStatus = jest.fn().mockResolvedValue(result);
  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const service = new WahaWebhookService(
    { applyDeliveryStatus } as never,
    logger as never,
  );

  return { service, applyDeliveryStatus, logger };
}

function ackEnvelope(options: {
  ack?: number;
  ackName?: string;
  event?: string;
  payload?: Record<string, unknown>;
  timestamp?: number;
} = {}): Record<string, unknown> {
  return {
    id: 'evt_01TEST',
    timestamp: options.timestamp ?? 1741249702485,
    event: options.event ?? 'message.ack',
    session: 'default',
    payload: {
      id: messageId,
      from: '628123456789@c.us',
      fromMe: true,
      ack: options.ack ?? 2,
      ackName: options.ackName ?? 'DEVICE',
      ...options.payload,
    },
  };
}

describe('WahaWebhookService', () => {
  it('memetakan DEVICE ke delivered dengan payload minimal', async () => {
    const { service, applyDeliveryStatus } = createService();

    const result = await service.handle(
      ackEnvelope({
        payload: {
          body: 'isi rahasia',
          _data: { body: 'isi rahasia', media: 'rahasia.jpg' },
        },
      }),
    );

    expect(result).toEqual({ processed: 1, ignored: 0 });
    expect(applyDeliveryStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        providerName: 'waha',
        channel: Channel.whatsapp,
        eventType: 'delivered',
        providerMessageId: messageId,
        occurredAt: new Date(1741249702485),
      }),
    );

    const args = applyDeliveryStatus.mock.calls[0]?.[0] as { rawPayload: Record<string, unknown> };
    const raw = JSON.stringify(args.rawPayload);

    expect(args.rawPayload).toMatchObject({
      event: 'message.ack',
      session: 'default',
      id: messageId,
      ack: 2,
      ackName: 'DEVICE',
      fromMe: true,
    });
    expect(raw).not.toContain('rahasia');
    expect(args.rawPayload).not.toHaveProperty('_data');
    expect(args.rawPayload).not.toHaveProperty('body');
  });

  it('memetakan SERVER ke sent, READ/PLAYED ke read', async () => {
    for (const [ack, ackName, expected] of [
      [1, 'SERVER', 'sent'],
      [3, 'READ', 'read'],
      [4, 'PLAYED', 'read'],
    ] as const) {
      const { service, applyDeliveryStatus } = createService();

      await service.handle(ackEnvelope({ ack, ackName }));

      expect(applyDeliveryStatus).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: expected }),
      );
    }
  });

  it('memetakan ERROR ke failed dan mengambil pesan error', async () => {
    const { service, applyDeliveryStatus } = createService();

    await service.handle(
      ackEnvelope({ ack: -1, ackName: 'ERROR', payload: { error: 'nomor diblokir' } }),
    );

    expect(applyDeliveryStatus).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'failed', errorMessage: 'nomor diblokir' }),
    );
  });

  it('mengabaikan PENDING, event asing, dan ack yang tidak dikenal', async () => {
    for (const envelope of [
      ackEnvelope({ ack: 0, ackName: 'PENDING' }),
      ackEnvelope({ event: 'message' }),
      ackEnvelope({ ack: 99, ackName: 'UNKNOWN' }),
    ]) {
      const { service, applyDeliveryStatus } = createService();

      await expect(service.handle(envelope)).resolves.toEqual({ processed: 0, ignored: 1 });
      expect(applyDeliveryStatus).not.toHaveBeenCalled();
    }
  });

  it('memakai angka ack saat ackName tidak dikenal', async () => {
    const { service, applyDeliveryStatus } = createService();

    await service.handle(ackEnvelope({ ack: 3, ackName: 'SOMETHING_NEW' }));

    expect(applyDeliveryStatus).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'read' }),
    );
  });

  it('menormalkan ack id komposit agar cocok dengan providerMessageId tersimpan', async () => {
    const { service, applyDeliveryStatus } = createService();

    await service.handle(
      ackEnvelope({
        payload: { id: 'true_251680805396688@lid_3EB0341E59F1A2467B714E' },
      }),
    );

    expect(applyDeliveryStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        providerMessageId: '3EB0341E59F1A2467B714E',
      }),
    );

    const args = applyDeliveryStatus.mock.calls[0]?.[0] as { rawPayload: Record<string, unknown> };
    expect(args.rawPayload.id).toBe('true_251680805396688@lid_3EB0341E59F1A2467B714E');
  });

  it('id tak dikenal dihitung ignored', async () => {
    const { service, applyDeliveryStatus } = createService('unmatched');

    await expect(service.handle(ackEnvelope())).resolves.toEqual({
      processed: 0,
      ignored: 1,
    });
    expect(applyDeliveryStatus).toHaveBeenCalledTimes(1);
  });

  it('menolak payload ack tanpa id', async () => {
    const { service, applyDeliveryStatus } = createService();

    const result = await service.handle({ event: 'message.ack', payload: { ack: 2 } });

    expect(result).toEqual({ processed: 0, ignored: 1 });
    expect(applyDeliveryStatus).not.toHaveBeenCalled();
  });

  it('menganggap event deleted sebagai processed', async () => {
    const { service } = createService('deleted');

    await expect(service.handle(ackEnvelope())).resolves.toEqual({
      processed: 1,
      ignored: 0,
    });
  });
});
