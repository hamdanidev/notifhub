import { InjectQueue } from '@nestjs/bullmq';
import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Channel,
  Prisma,
  Status,
  type Notification,
  type NotificationRecipient,
} from '@prisma/client';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { PinoLogger } from 'nestjs-pino';
import { RequestContext } from '../../common/request-context';
import {
  DELIVERY_JOB_NAME,
  type DeliveryJobData,
} from '../../ingest/ingest.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  QUEUE_EMAIL,
  QUEUE_INAPP,
  QUEUE_WHATSAPP,
} from '../../queues/queues.module';
import type { ResendMode, ResendNotificationDto } from '../dto/resend-notification.dto';

const MILLISECONDS_PER_DAY = 86_400_000;

export interface ResendNotificationResult {
  notification_id: string;
  status: 'accepted';
  mode: ResendMode;
  recipient_count: number;
  channels: Channel[];
}

type CreatedNotification = Notification & { recipients: NotificationRecipient[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function extractData(payload: Prisma.JsonValue): Record<string, unknown> {
  if (!isRecord(payload) || !isRecord(payload.data)) {
    return {};
  }

  return payload.data;
}

function asJson(value: Record<string, unknown>): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

function uniqueChannels(recipients: NotificationRecipient[]): Channel[] {
  return [...new Set(recipients.map((recipient) => recipient.channel))];
}

function requestKeyToIdempotencyKey(notificationId: string, requestKey: string): string {
  return `resend:${notificationId}:${requestKey}`;
}

@Injectable()
export class AdminNotificationResendService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @InjectQueue(QUEUE_INAPP) private readonly inappQueue: Queue<DeliveryJobData>,
    @InjectQueue(QUEUE_EMAIL) private readonly emailQueue: Queue<DeliveryJobData>,
    @InjectQueue(QUEUE_WHATSAPP) private readonly whatsappQueue: Queue<DeliveryJobData>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AdminNotificationResendService.name);
  }

  async resend(
    tenantId: string,
    notificationId: string,
    dto: ResendNotificationDto,
  ): Promise<ResendNotificationResult> {
    const original = await this.prisma.notification.findFirst({
      where: { id: notificationId, tenantId, deletedAt: null },
      include: { recipients: true },
    });

    if (original === null) {
      throw new NotFoundException('Notification not found');
    }

    const mode = dto.mode ?? 'failed';
    const candidates = original.recipients.filter(
      (recipient) =>
        recipient.channel !== Channel.sms &&
        (mode === 'all' || recipient.status === Status.failed),
    );

    if (candidates.length === 0) {
      throw new ConflictException(
        mode === 'failed' ? 'No failed recipients to resend' : 'No recipients to resend',
      );
    }

    const idempotencyKey = requestKeyToIdempotencyKey(original.id, dto.requestKey);
    const requestId = RequestContext.getRequestId() ?? randomUUID();
    const existing = await this.prisma.notification.findUnique({
      where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } },
      include: { recipients: true },
    });

    if (existing !== null) {
      if (
        existing.tenantId !== tenantId ||
        existing.resendOfNotificationId !== original.id ||
        existing.resendMode !== mode
      ) {
        throw new ConflictException('Resend request key has already been used');
      }

      // Re-dispatch pending rows on an idempotent replay. Deterministic job ids make the
      // operation safe if the first request committed but the HTTP response or queue call failed.
      await this.dispatch(existing, extractData(original.payload), requestId);

      return toResendResult(existing, mode);
    }

    const ttlDays = this.config.getOrThrow<number>('IDEMPOTENCY_TTL_DAYS');
    const data = extractData(original.payload);
    const channels = uniqueChannels(candidates);
    const targetSnapshot = asJson({
      topics: [],
      recipient_ids: [...new Set(candidates.map((recipient) => recipient.recipientId))],
      channels,
      resend_of: original.id,
      resend_mode: mode,
    });

    let created: CreatedNotification;

    try {
      created = await this.prisma.$transaction(async (tx) => {
        const notification = await tx.notification.create({
          data: {
            idempotencyKey,
            idempotencyExpiresAt: new Date(Date.now() + ttlDays * MILLISECONDS_PER_DAY),
            tenantId,
            templateKey: original.templateKey,
            payload: original.payload as Prisma.InputJsonValue,
            priority: original.priority,
            targetType: 'recipients',
            targetSnapshot,
            resendOfNotificationId: original.id,
            resendMode: mode,
            recipients: {
              create: candidates.map((recipient) => ({
                recipientId: recipient.recipientId,
                channel: recipient.channel,
                status: Status.pending,
              })),
            },
          },
          include: { recipients: true },
        });

        return notification;
      });
    } catch (error) {
      // A concurrent request with the same requestKey won the unique constraint race.
      if (isUniqueConstraintError(error)) {
        const raced = await this.prisma.notification.findUnique({
          where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } },
          include: { recipients: true },
        });

        if (
          raced !== null &&
          raced.tenantId === tenantId &&
          raced.resendOfNotificationId === original.id &&
          raced.resendMode === mode
        ) {
          return toResendResult(raced, mode);
        }
      }

      throw error;
    }

    await this.dispatch(created, data, requestId);

    this.logger.info(
      {
        event: 'admin.notification.resend',
        tenant_id: tenantId,
        original_notification_id: original.id,
        notification_id: created.id,
        mode,
        recipient_count: created.recipients.length,
        channels,
      },
      'notification recipients resent',
    );

    return toResendResult(created, mode);
  }

  private async dispatch(
    notification: CreatedNotification,
    data: Record<string, unknown>,
    requestId: string,
  ): Promise<void> {
    const jobsByQueue = new Map<
      Queue<DeliveryJobData>,
      Array<{ job: DeliveryJobData; jobId: string }>
    >();
    const pendingRecipients = notification.recipients.filter(
      (recipient) => recipient.status === Status.pending,
    );

    if (pendingRecipients.length === 0) {
      return;
    }

    for (const recipient of pendingRecipients) {
      const queue = this.queueForChannel(recipient.channel);
      const job: DeliveryJobData = {
        notificationId: notification.id,
        requestId,
        recipientId: recipient.recipientId,
        channel: recipient.channel,
        templateKey: notification.templateKey,
        data,
        priority: notification.priority,
      };
      const entry = {
        job,
        jobId: `resend-${notification.id}-${recipient.id.toString()}`,
      };

      const jobs = jobsByQueue.get(queue);

      if (jobs === undefined) {
        jobsByQueue.set(queue, [entry]);
      } else {
        jobs.push(entry);
      }
    }

    try {
      await Promise.all(
        [...jobsByQueue.entries()].map(([queue, entries]) =>
          queue.addBulk(
            entries.map(({ job, jobId }) => ({
              name: DELIVERY_JOB_NAME,
              data: job,
              opts: { priority: job.priority, jobId },
            })),
          ),
        ),
      );
    } catch (error) {
      this.logger.error(
        {
          event: 'admin.notification.resend_enqueue_failed',
          notification_id: notification.id,
          err: error instanceof Error ? error.message : String(error),
        },
        'failed to enqueue resend delivery jobs',
      );

      throw new ServiceUnavailableException(
        'Notification queue is unavailable, retry the request',
      );
    }
  }

  private queueForChannel(channel: Channel): Queue<DeliveryJobData> {
    if (channel === Channel.inapp) {
      return this.inappQueue;
    }

    if (channel === Channel.email) {
      return this.emailQueue;
    }

    if (channel === Channel.whatsapp) {
      return this.whatsappQueue;
    }

    throw new ServiceUnavailableException(`No delivery queue configured for channel ${channel}`);
  }
}

function toResendResult(
  notification: CreatedNotification,
  mode: ResendMode,
): ResendNotificationResult {
  return {
    notification_id: notification.id,
    status: 'accepted',
    mode,
    recipient_count: notification.recipients.length,
    channels: uniqueChannels(notification.recipients),
  };
}
