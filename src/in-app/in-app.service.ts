import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Channel, Prisma, Status } from '@prisma/client';
import { PinoLogger } from 'nestjs-pino';
import type { SubscriberPrincipal } from '../auth/subscriber/subscriber.types';
import { PrismaService } from '../prisma/prisma.service';
import { TemplateService } from '../templates/template.service';
import {
  InAppNotificationItem,
  InAppNotificationPage,
  ReadReceiptResponse,
} from './dto/list-in-app-notifications.dto';

interface CursorPayload {
  createdAt: string;
  notificationId: string;
}

interface DecodedCursor {
  createdAt: Date;
  notificationId: string;
}

@Injectable()
export class InAppService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly templates: TemplateService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(InAppService.name);
  }

  async list(
    principal: SubscriberPrincipal,
    limit: number,
    cursor: string | undefined,
  ): Promise<InAppNotificationPage> {
    const decoded = cursor === undefined ? undefined : this.decodeCursor(cursor);

    const where: Prisma.NotificationWhereInput = {
      tenantId: principal.tenantId,
      deletedAt: null,
      recipients: {
        some: {
          recipientId: principal.recipientId,
          channel: Channel.inapp,
        },
      },
    };

    if (decoded !== undefined) {
      where.OR = [
        { createdAt: { lt: decoded.createdAt } },
        { createdAt: decoded.createdAt, id: { lt: decoded.notificationId } },
      ];
    }

    const rows = await this.prisma.notification.findMany({
      where,
      include: {
        recipients: {
          where: { recipientId: principal.recipientId, channel: Channel.inapp },
          select: { status: true, readAt: true },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    const templates = await this.templates.resolveMany(
      principal.tenantId,
      pageRows.map((row) => row.templateKey),
      Channel.inapp,
      undefined,
    );

    const items: InAppNotificationItem[] = [];

    for (const row of pageRows) {
      const recipient = row.recipients[0];

      if (recipient === undefined) {
        continue;
      }

      const data = extractPayloadData(row.payload);
      const template = templates.get(row.templateKey);
      const rendered = template === undefined ? null : this.templates.render(template, data);

      items.push({
        notificationId: row.id,
        templateKey: row.templateKey,
        subject: rendered === null ? null : rendered.subject,
        body: rendered === null ? null : rendered.body,
        bodyHtml: rendered === null ? null : rendered.bodyHtml,
        format: rendered === null ? undefined : rendered.format,
        data,
        priority: row.priority,
        status: recipient.status,
        createdAt: row.createdAt.toISOString(),
        readAt: recipient.readAt === null ? null : recipient.readAt.toISOString(),
      });
    }

    const lastRow = pageRows[pageRows.length - 1];
    const nextCursor =
      hasMore && lastRow !== undefined
        ? this.encodeCursor({
            createdAt: lastRow.createdAt.toISOString(),
            notificationId: lastRow.id,
          })
        : null;

    return { items, nextCursor };
  }

  async markRead(
    principal: SubscriberPrincipal,
    notificationId: string,
  ): Promise<ReadReceiptResponse> {
    const readAt = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.notificationRecipient.findFirst({
        where: {
          notificationId,
          recipientId: principal.recipientId,
          channel: Channel.inapp,
          notification: {
            tenantId: principal.tenantId,
            deletedAt: null,
          },
        },
        select: { id: true, readAt: true },
      });

      if (existing === null) {
        return null;
      }

      if (existing.readAt !== null) {
        return existing.readAt;
      }

      const now = new Date();

      await tx.notificationRecipient.updateMany({
        where: { id: existing.id, readAt: null },
        data: { readAt: now, status: Status.read },
      });

      const updated = await tx.notificationRecipient.findUnique({
        where: { id: existing.id },
        select: { readAt: true },
      });

      return updated?.readAt ?? now;
    });

    if (readAt === null) {
      throw new NotFoundException('Notification not found');
    }

    this.logger.info(
      {
        event: 'inapp.notification.read',
        tenant_id: principal.tenantId,
        recipient_id: principal.recipientId,
        notification_id: notificationId,
      },
      'in-app notification marked as read',
    );

    return { notificationId, readAt: readAt.toISOString() };
  }

  private encodeCursor(payload: CursorPayload): string {
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  }

  private decodeCursor(cursor: string): DecodedCursor {
    try {
      const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));

      if (!isRecord(parsed) || typeof parsed.createdAt !== 'string') {
        throw new Error('malformed cursor');
      }

      if (typeof parsed.notificationId !== 'string' || parsed.notificationId.length === 0) {
        throw new Error('malformed cursor');
      }

      const createdAt = new Date(parsed.createdAt);

      if (Number.isNaN(createdAt.getTime())) {
        throw new Error('malformed cursor');
      }

      return { createdAt, notificationId: parsed.notificationId };
    } catch {
      throw new BadRequestException('Invalid cursor');
    }
  }
}

function extractPayloadData(payload: Prisma.JsonValue): Record<string, unknown> {
  if (!isRecord(payload) || !isRecord(payload.data)) {
    return {};
  }

  return payload.data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
