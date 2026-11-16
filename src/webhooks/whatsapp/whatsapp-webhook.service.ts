import { Injectable } from '@nestjs/common';
import { Channel } from '@prisma/client';
import { PinoLogger } from 'nestjs-pino';
import { WebhooksService } from '../webhooks.service';

const STATUS_EVENTS: Record<string, string> = {
  sent: 'sent',
  delivered: 'delivered',
  read: 'read',
  failed: 'failed',
};

interface ParsedStatus {
  wamid: string;
  eventType: string;
  occurredAt: Date;
  errorMessage: string | null;
  raw: Record<string, unknown>;
}

export interface WhatsAppWebhookResult {
  processed: number;
  ignored: number;
}

/**
 * Parses Meta WhatsApp Cloud API webhook payloads and forwards status events to the
 * shared delivery-event pipeline.
 *
 * Only status events are handled; inbound messages and other changes are ignored
 * (Phase 7 scope). Unknown wamids are acknowledged and logged, never failed, so Meta
 * does not retry them forever.
 */
@Injectable()
export class WhatsAppWebhookService {
  constructor(
    private readonly webhooks: WebhooksService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WhatsAppWebhookService.name);
  }

  async handle(payload: unknown): Promise<WhatsAppWebhookResult> {
    const statuses = parseStatuses(payload);
    let processed = 0;
    let ignored = 0;

    for (const status of statuses) {
      const result = await this.webhooks.applyDeliveryStatus({
        providerName: 'whatsapp',
        channel: Channel.whatsapp,
        eventType: status.eventType,
        occurredAt: status.occurredAt,
        rawPayload: status.raw,
        providerMessageId: status.wamid,
        errorMessage: status.errorMessage,
      });

      if (result === 'applied' || result === 'deleted') {
        processed += 1;
      } else {
        ignored += 1;
      }
    }

    this.logger.info(
      {
        event: 'whatsapp.webhook.processed',
        statuses: statuses.length,
        processed,
        ignored,
      },
      'WhatsApp webhook payload handled',
    );

    return { processed, ignored };
  }
}

function parseStatuses(payload: unknown): ParsedStatus[] {
  const statuses: ParsedStatus[] = [];

  if (!isRecord(payload) || !Array.isArray(payload.entry)) {
    return statuses;
  }

  for (const entry of payload.entry) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) {
      continue;
    }

    for (const change of entry.changes) {
      if (!isRecord(change) || !isRecord(change.value)) {
        continue;
      }

      const value = change.value;

      if (!Array.isArray(value.statuses)) {
        continue;
      }

      for (const status of value.statuses) {
        const parsed = parseStatus(status);

        if (parsed !== null) {
          statuses.push(parsed);
        }
      }
    }
  }

  return statuses;
}

function parseStatus(value: unknown): ParsedStatus | null {
  if (!isRecord(value)) {
    return null;
  }

  const wamid = value.id;
  const status = value.status;

  if (typeof wamid !== 'string' || wamid.length === 0) {
    return null;
  }

  if (typeof status !== 'string') {
    return null;
  }

  const eventType = STATUS_EVENTS[status.toLowerCase()];

  if (eventType === undefined) {
    return null;
  }

  return {
    wamid,
    eventType,
    occurredAt: parseTimestamp(value.timestamp),
    errorMessage: extractErrorMessage(value.errors),
    raw: value,
  };
}

function parseTimestamp(value: unknown): Date {
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return new Date(Number(value) * 1000);
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value * 1000);
  }

  return new Date();
}

function extractErrorMessage(errors: unknown): string | null {
  if (!Array.isArray(errors) || errors.length === 0) {
    return null;
  }

  const first = errors[0];

  if (!isRecord(first)) {
    return null;
  }

  const candidate =
    first.message ??
    first.title ??
    (isRecord(first.error_data) ? first.error_data.details : undefined);

  return typeof candidate === 'string' && candidate.length > 0
    ? candidate.slice(0, 500)
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
