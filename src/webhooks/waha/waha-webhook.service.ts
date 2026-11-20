import { Injectable } from '@nestjs/common';
import { Channel } from '@prisma/client';
import { PinoLogger } from 'nestjs-pino';
import { WebhooksService } from '../webhooks.service';
import { isRecord } from '../../providers/waha/waha.types';

const ACK_NAME_TO_CODE: Record<string, number> = {
  ERROR: -1,
  PENDING: 0,
  SERVER: 1,
  DEVICE: 2,
  READ: 3,
  PLAYED: 4,
};

const ACK_CODE_TO_EVENT: Record<number, string | null> = {
  [-1]: 'failed',
  0: null,
  1: 'sent',
  2: 'delivered',
  3: 'read',
  4: 'read',
};

interface ParsedAck {
  providerMessageId: string;
  eventType: string | null;
  occurredAt: Date;
  errorMessage: string | null;
  raw: Record<string, unknown>;
}

export interface WahaWebhookResult {
  processed: number;
  ignored: number;
}

/**
 * Parses WAHA `message.ack` events and forwards them to the shared delivery pipeline.
 *
 * Only `message.ack` is handled; inbound messages and other events are acknowledged and ignored.
 * The stored raw payload is intentionally minimal: `_data`, message bodies, and media are never
 * persisted.
 */
@Injectable()
export class WahaWebhookService {
  constructor(
    private readonly webhooks: WebhooksService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WahaWebhookService.name);
  }

  async handle(payload: unknown): Promise<WahaWebhookResult> {
    if (!isRecord(payload) || payload.event !== 'message.ack') {
      this.logger.info(
        {
          event: 'waha.webhook.ignored',
          event_name: isRecord(payload) && typeof payload.event === 'string' ? payload.event : null,
        },
        'ignored non-ack WAHA webhook event',
      );

      return { processed: 0, ignored: 1 };
    }

    const ack = parseAck(payload);

    if (ack === null) {
      this.logger.warn(
        { event: 'waha.webhook.ignored', reason: 'malformed_ack' },
        'ignored malformed WAHA message.ack event',
      );

      return { processed: 0, ignored: 1 };
    }

    if (ack.eventType === null) {
      this.logger.info(
        {
          event: 'waha.webhook.ignored',
          reason: 'pending_ack',
          provider_message_id: ack.providerMessageId,
        },
        'ignored pending WAHA message.ack event',
      );

      return { processed: 0, ignored: 1 };
    }

    const result = await this.webhooks.applyDeliveryStatus({
      providerName: 'waha',
      channel: Channel.whatsapp,
      eventType: ack.eventType,
      occurredAt: ack.occurredAt,
      rawPayload: ack.raw,
      providerMessageId: ack.providerMessageId,
      errorMessage: ack.errorMessage,
    });

    const processed = result === 'applied' || result === 'deleted' ? 1 : 0;
    const ignored = processed === 1 ? 0 : 1;

    this.logger.info(
      {
        event: 'waha.webhook.processed',
        acks: 1,
        processed,
        ignored,
      },
      'WAHA message.ack handled',
    );

    return { processed, ignored };
  }
}

function parseAck(envelope: Record<string, unknown>): ParsedAck | null {
  const payload = envelope.payload;

  if (!isRecord(payload) || typeof payload.id !== 'string' || payload.id.length === 0) {
    return null;
  }

  const code = resolveAckCode(payload);

  if (code === undefined || !(code in ACK_CODE_TO_EVENT)) {
    return null;
  }

  const eventType = ACK_CODE_TO_EVENT[code];
  const ackName = typeof payload.ackName === 'string' ? payload.ackName.toUpperCase() : null;

  return {
    providerMessageId: payload.id,
    eventType,
    occurredAt: parseOccurredAt(envelope.timestamp),
    errorMessage: eventType === 'failed' ? extractAckError(payload) : null,
    raw: {
      event: 'message.ack',
      session: typeof envelope.session === 'string' ? envelope.session : null,
      id: payload.id,
      ack: code,
      ackName,
      from: typeof payload.from === 'string' ? payload.from : null,
      fromMe: payload.fromMe === true,
      timestamp: typeof envelope.timestamp === 'number' ? envelope.timestamp : null,
    },
  };
}

function resolveAckCode(payload: Record<string, unknown>): number | undefined {
  if (typeof payload.ackName === 'string') {
    const byName = ACK_NAME_TO_CODE[payload.ackName.toUpperCase()];

    if (byName !== undefined) {
      return byName;
    }
  }

  if (typeof payload.ack === 'number' && Number.isInteger(payload.ack)) {
    return payload.ack;
  }

  return undefined;
}

function parseOccurredAt(value: unknown): Date {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value);
  }

  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return new Date(Number(value));
  }

  return new Date();
}

function extractAckError(payload: Record<string, unknown>): string | null {
  const candidate = payload.error ?? payload.reason ?? payload.message;

  if (typeof candidate === 'string' && candidate.length > 0) {
    return candidate.slice(0, 500);
  }

  if (
    isRecord(candidate) &&
    typeof candidate.message === 'string' &&
    candidate.message.length > 0
  ) {
    return candidate.message.slice(0, 500);
  }

  return null;
}
