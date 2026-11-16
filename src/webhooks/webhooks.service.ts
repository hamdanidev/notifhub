import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Channel, Status, type NotificationRecipient, Prisma } from '@prisma/client';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../prisma/prisma.service';
import type { WebhookEventDto } from './dto/webhook-event.dto';

const PROVIDER_CHANNELS: Record<string, Channel> = {
  smtp: Channel.email,
  whatsapp: Channel.whatsapp,
  sms: Channel.sms,
};

const TRUNCATED_FIELD_LENGTH = 4000;

export interface ApplyDeliveryStatusParams {
  providerName: string;
  channel: Channel;
  eventType: string;
  occurredAt: Date;
  rawPayload: Record<string, unknown>;
  providerMessageId?: string | null;
  errorMessage?: string | null;
  notificationId?: string;
  recipientId?: string;
}

export type ApplyDeliveryStatusResult = 'applied' | 'unmatched' | 'deleted';

/**
 * Applies provider delivery callbacks (PART 1 rule 25).
 *
 * Every event is appended to delivery_events, then the recipient row is updated with
 * monotonic status transitions: delivered/read may upgrade pending/failed, while a late
 * failed/bounced event never downgrades a delivered notification.
 */
@Injectable()
export class WebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WebhooksService.name);
  }

  async handle(providerRaw: string, dto: WebhookEventDto): Promise<void> {
    const provider = providerRaw.trim().toLowerCase();
    const providerChannel = PROVIDER_CHANNELS[provider];

    if (providerChannel === undefined) {
      throw new NotFoundException(`Unknown webhook provider: ${providerRaw}`);
    }

    if (dto.channel !== undefined && dto.channel !== providerChannel) {
      throw new BadRequestException(
        `channel ${dto.channel} does not match provider ${provider} (${providerChannel})`,
      );
    }

    const occurredAt = dto.occurredAt === undefined ? new Date() : new Date(dto.occurredAt);
    const rawPayload = {
      eventId: dto.eventId,
      provider,
      eventType: dto.eventType,
      notificationId: dto.notificationId,
      recipientId: dto.recipientId,
      channel: providerChannel,
      providerMessageId: dto.providerMessageId ?? null,
      occurredAt: occurredAt.toISOString(),
      metadata: dto.metadata ?? null,
    };

    await this.applyDeliveryStatus({
      providerName: provider,
      channel: providerChannel,
      eventType: dto.eventType,
      occurredAt,
      rawPayload,
      providerMessageId: dto.providerMessageId ?? null,
      errorMessage: extractFailureMessage(dto.metadata),
      notificationId: dto.notificationId,
      recipientId: dto.recipientId,
    });
  }

  /**
   * Shared entry point for provider-specific webhooks (Meta WhatsApp) and the generic
   * webhook endpoint. Finds the recipient by notification/recipient ids or by the
   * provider message id (wamid), appends delivery_events, then applies the monotonic
   * status transition.
   */
  async applyDeliveryStatus(
    params: ApplyDeliveryStatusParams,
  ): Promise<ApplyDeliveryStatusResult> {
    const recipient = await this.findRecipient(params);

    if (recipient === null) {
      this.logger.warn(
        {
          event: 'webhook.unmatched',
          provider: params.providerName,
          event_type: params.eventType,
          notification_id: params.notificationId ?? null,
          recipient_id: params.recipientId ?? null,
          provider_message_id: params.providerMessageId ?? null,
          channel: params.channel,
        },
        'webhook references a notification/recipient that does not exist, ignored',
      );

      return 'unmatched';
    }

    await this.prisma.deliveryEvent.create({
      data: {
        notificationId: recipient.notificationId,
        recipientId: recipient.recipientId,
        channel: params.channel,
        providerName: params.providerName,
        eventType: params.eventType,
        rawPayload: toJson(params.rawPayload),
        occurredAt: params.occurredAt,
      },
    });

    if (recipient.notification.deletedAt !== null) {
      this.logger.info(
        {
          event: 'webhook.deleted_notification',
          provider: params.providerName,
          event_type: params.eventType,
          notification_id: recipient.notificationId,
          recipient_id: recipient.recipientId,
        },
        'notification is soft deleted, delivery event stored without status change',
      );

      return 'deleted';
    }

    const update = buildRecipientUpdate(recipient, {
      eventType: params.eventType,
      occurredAt: params.occurredAt,
      providerMessageId: params.providerMessageId ?? null,
      errorMessage: params.errorMessage ?? null,
    });

    if (update !== null) {
      await this.prisma.notificationRecipient.update({
        where: { id: recipient.id },
        data: update,
      });
    }

    this.logger.info(
      {
        event: 'webhook.processed',
        provider: params.providerName,
        event_type: params.eventType,
        notification_id: recipient.notificationId,
        recipient_id: recipient.recipientId,
        channel: params.channel,
        status_changed: update !== null,
        previous_status: recipient.status,
      },
      'provider delivery event recorded',
    );

    return 'applied';
  }

  private async findRecipient(
    params: ApplyDeliveryStatusParams,
  ): Promise<
    | (NotificationRecipient & { notification: { deletedAt: Date | null } })
    | null
  > {
    if (params.notificationId !== undefined && params.recipientId !== undefined) {
      return this.prisma.notificationRecipient.findFirst({
        where: {
          notificationId: params.notificationId,
          recipientId: params.recipientId,
          channel: params.channel,
        },
        include: { notification: { select: { deletedAt: true } } },
      });
    }

    if (params.providerMessageId !== undefined && params.providerMessageId !== null) {
      return this.prisma.notificationRecipient.findFirst({
        where: {
          providerMessageId: params.providerMessageId,
          channel: params.channel,
        },
        include: { notification: { select: { deletedAt: true } } },
      });
    }

    return null;
  }
}

interface StatusUpdateInput {
  eventType: string;
  occurredAt: Date;
  providerMessageId: string | null;
  errorMessage: string | null;
}

function buildRecipientUpdate(
  recipient: NotificationRecipient,
  input: StatusUpdateInput,
): Prisma.NotificationRecipientUpdateInput | null {
  const providerMessageId = recipient.providerMessageId ?? input.providerMessageId;

  switch (input.eventType) {
    case 'sent': {
      if (recipient.status === Status.sent || recipient.status === Status.read) {
        return null;
      }

      return {
        status: Status.sent,
        sentAt: recipient.sentAt ?? input.occurredAt,
        providerMessageId,
        lastError: null,
      };
    }

    case 'delivered': {
      if (recipient.status === Status.read) {
        return null;
      }

      return {
        status: Status.sent,
        sentAt: recipient.sentAt ?? input.occurredAt,
        deliveredAt: recipient.deliveredAt ?? input.occurredAt,
        providerMessageId,
        lastError: null,
      };
    }

    case 'read': {
      if (recipient.status === Status.skipped) {
        return null;
      }

      return {
        status: Status.read,
        sentAt: recipient.sentAt ?? input.occurredAt,
        deliveredAt: recipient.deliveredAt ?? input.occurredAt,
        readAt: recipient.readAt ?? input.occurredAt,
        providerMessageId,
        lastError: null,
      };
    }

    case 'failed':
    case 'bounced': {
      if (recipient.status === Status.sent || recipient.status === Status.read) {
        // A late failure must not downgrade a notification that was already delivered.
        return null;
      }

      if (recipient.status === Status.skipped) {
        return null;
      }

      const reason =
        input.errorMessage === null
          ? `${input.eventType}: provider reported failure`
          : `${input.eventType}: ${input.errorMessage}`;

      return {
        status: Status.failed,
        lastError: reason.slice(0, TRUNCATED_FIELD_LENGTH),
        providerMessageId,
      };
    }

    case 'opened':
    default:
      return null;
  }
}

function extractFailureMessage(metadata: Record<string, unknown> | undefined): string | null {
  if (metadata === undefined) {
    return null;
  }

  const candidate = metadata.message ?? metadata.reason ?? metadata.error;

  return typeof candidate === 'string' && candidate.length > 0 ? candidate.slice(0, 500) : null;
}

function toJson(value: Record<string, unknown>): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}
