import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  DeliveryAttempt,
  DeliveryEvent,
  Notification,
  NotificationRecipient,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { NotificationListQueryDto } from '../dto/list-query.dto';

export interface NotificationListItem {
  id: string;
  tenantId: string;
  templateKey: string;
  priority: number;
  overallStatus: string;
  targetType: string;
  createdAt: string;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  pendingCount: number;
  skippedCount: number;
}

export interface NotificationListResult {
  items: NotificationListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface NotificationDetailResult {
  notification: Record<string, unknown>;
  recipients: Record<string, unknown>[];
  deliveryAttempts: Record<string, unknown>[];
  deliveryEvents: Record<string, unknown>[];
}

@Injectable()
export class AdminNotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    tenantId: string,
    query: NotificationListQueryDto,
  ): Promise<NotificationListResult> {
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    const where = {
      tenantId,
      ...(query.status === undefined ? {} : { overallStatus: query.status }),
      ...(query.templateKey === undefined ? {} : { templateKey: query.templateKey }),
      ...(query.from === undefined && query.to === undefined
        ? {}
        : {
            createdAt: {
              ...(query.from === undefined ? {} : { gte: new Date(query.from) }),
              ...(query.to === undefined ? {} : { lte: new Date(query.to) }),
            },
          }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
        include: { recipients: { select: { status: true } } },
      }),
      this.prisma.notification.count({ where }),
    ]);

    return {
      items: rows.map((row) => toListItem(row, row.recipients)),
      total,
      limit,
      offset,
    };
  }

  async detail(tenantId: string, notificationId: string): Promise<NotificationDetailResult> {
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, tenantId },
      include: { recipients: { orderBy: { id: 'asc' } } },
    });

    if (notification === null) {
      throw new NotFoundException('Notification not found');
    }

    const [attempts, events] = await Promise.all([
      this.prisma.deliveryAttempt.findMany({
        where: { notificationId },
        orderBy: { id: 'desc' },
        take: 20,
      }),
      this.prisma.deliveryEvent.findMany({
        where: { notificationId },
        orderBy: { id: 'desc' },
        take: 20,
      }),
    ]);

    return {
      notification: toNotificationView(notification),
      recipients: notification.recipients.map(toRecipientView),
      deliveryAttempts: attempts.map(toAttemptView),
      deliveryEvents: events.map(toEventView),
    };
  }
}

function toListItem(
  notification: Notification,
  recipients: Array<{ status: string }>,
): NotificationListItem {
  const sent = recipients.filter(
    (recipient) => recipient.status === 'sent' || recipient.status === 'read',
  ).length;
  const failed = recipients.filter((recipient) => recipient.status === 'failed').length;
  const pending = recipients.filter((recipient) => recipient.status === 'pending').length;
  const skipped = recipients.filter((recipient) => recipient.status === 'skipped').length;

  return {
    id: notification.id,
    tenantId: notification.tenantId,
    templateKey: notification.templateKey,
    priority: notification.priority,
    overallStatus: notification.overallStatus,
    targetType: notification.targetType,
    createdAt: notification.createdAt.toISOString(),
    recipientCount: recipients.length,
    sentCount: sent,
    failedCount: failed,
    pendingCount: pending,
    skippedCount: skipped,
  };
}

function toNotificationView(notification: Notification): Record<string, unknown> {
  return {
    id: notification.id,
    tenantId: notification.tenantId,
    templateKey: notification.templateKey,
    priority: notification.priority,
    overallStatus: notification.overallStatus,
    targetType: notification.targetType,
    targetSnapshot: notification.targetSnapshot,
    groupAckRequired: notification.groupAckRequired,
    groupAckDeadline:
      notification.groupAckDeadline === null ? null : notification.groupAckDeadline.toISOString(),
    createdAt: notification.createdAt.toISOString(),
    updatedAt: notification.updatedAt.toISOString(),
    deletedAt: notification.deletedAt === null ? null : notification.deletedAt.toISOString(),
  };
}

function toRecipientView(recipient: NotificationRecipient): Record<string, unknown> {
  return {
    id: recipient.id.toString(),
    recipientId: recipient.recipientId,
    channel: recipient.channel,
    status: recipient.status,
    attempts: recipient.attempts,
    providerName: recipient.providerName,
    providerMessageId: recipient.providerMessageId,
    lastError: recipient.lastError,
    sentAt: recipient.sentAt === null ? null : recipient.sentAt.toISOString(),
    deliveredAt: recipient.deliveredAt === null ? null : recipient.deliveredAt.toISOString(),
    readAt: recipient.readAt === null ? null : recipient.readAt.toISOString(),
    acknowledgedAt:
      recipient.acknowledgedAt === null ? null : recipient.acknowledgedAt.toISOString(),
  };
}

function toAttemptView(attempt: DeliveryAttempt): Record<string, unknown> {
  return {
    id: attempt.id.toString(),
    recipientId: attempt.recipientId,
    channel: attempt.channel,
    attemptNumber: attempt.attemptNumber,
    providerName: attempt.providerName,
    status: attempt.status,
    errorName: attempt.errorName,
    errorMessage: attempt.errorMessage,
    durationMs: attempt.durationMs,
    occurredAt: attempt.occurredAt.toISOString(),
  };
}

function toEventView(event: DeliveryEvent): Record<string, unknown> {
  return {
    id: event.id.toString(),
    recipientId: event.recipientId,
    channel: event.channel,
    providerName: event.providerName,
    eventType: event.eventType,
    occurredAt: event.occurredAt.toISOString(),
  };
}
