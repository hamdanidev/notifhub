import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Channel, Prisma, Status } from '@prisma/client';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { PinoLogger } from 'nestjs-pino';
import { RequestContext } from '../common/request-context';
import { MetricsService } from '../metrics/metrics.service';
import { PrismaService } from '../prisma/prisma.service';
import { TopicResolutionService } from '../routing/topic-resolution.service';
import {
  QUEUE_EMAIL,
  QUEUE_INAPP,
  QUEUE_WHATSAPP,
} from '../queues/queues.module';
import { RecipientInput } from './dto/recipient-input.dto';
import {
  DEFAULT_PRIORITY,
  MAX_RECIPIENTS_PER_REQUEST,
  NotifyDto,
  type NotificationPriority,
} from './dto/notify.dto';

const MILLISECONDS_PER_DAY = 86_400_000;
export const DELIVERY_JOB_NAME = 'deliver';
const BILLING_EVENT_TRIGGERED = 'notification.triggered';

export const PRIORITY_MAP: Record<NotificationPriority, number> = {
  critical: 1,
  high: 2,
  normal: 3,
  low: 4,
};

export interface DeliveryJobData {
  notificationId: string;
  requestId: string;
  recipientId: string;
  channel: Channel;
  templateKey: string;
  data: Record<string, unknown>;
  priority: number;
  recipientOverride?: {
    email?: string;
    phone?: string;
    locale?: string;
    timezone?: string;
  };
  /** Number of quiet-hour deferrals already applied to this job (max 3). */
  deferralCount?: number;
  /** Set when this job was created by the channel fallback of another channel. */
  fallbackFrom?: Channel;
}

interface NormalizedRecipient {
  id: string;
  email?: string;
  phone?: string;
  locale?: string;
  timezone?: string;
}

interface PersistOutcome {
  notificationId: string;
  created: boolean;
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * `data` comes straight from a parsed JSON request body, so it is JSON-serializable
 * by construction; the cast only bridges the DTO type to Prisma's JSON input type.
 */
function asJson(value: Record<string, unknown>): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

@Injectable()
export class IngestService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_INAPP) private readonly inappQueue: Queue<DeliveryJobData>,
    @InjectQueue(QUEUE_EMAIL) private readonly emailQueue: Queue<DeliveryJobData>,
    @InjectQueue(QUEUE_WHATSAPP) private readonly whatsappQueue: Queue<DeliveryJobData>,
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
    private readonly topicResolution: TopicResolutionService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(IngestService.name);
  }

  async enqueue(dto: NotifyDto, tenantIdFromApiKey: string): Promise<{ notification_id: string }> {
    const startedAt = Date.now();
    const requestId = RequestContext.getRequestId() ?? randomUUID();
    const tenantId = this.resolveTenantId(dto.tenant_id, tenantIdFromApiKey);
    const channels = this.resolveChannels(dto.channels);
    const directRecipients = this.normalizeRecipients(dto.recipients);
    const topicKeys = [...new Set(dto.topics ?? [])];
    const topicRecipients = await this.topicResolution.resolve(tenantId, topicKeys);
    const recipients = this.mergeRecipients(directRecipients, topicRecipients);

    if (recipients.length === 0) {
      throw new BadRequestException('topics or recipients must not be empty');
    }

    const targetType = resolveTargetType(topicKeys, directRecipients);

    const priority = PRIORITY_MAP[dto.priority ?? DEFAULT_PRIORITY];
    const ttlDays = this.config.getOrThrow<number>('IDEMPOTENCY_TTL_DAYS');
    const idempotencyExpiresAt = new Date(Date.now() + ttlDays * MILLISECONDS_PER_DAY);

    let outcome: PersistOutcome;

    try {
      outcome = await this.persist(dto, {
        tenantId,
        priority,
        channels,
        recipients,
        topics: topicKeys,
        targetType,
        idempotencyExpiresAt,
      });
    } catch (error) {
      // A concurrent request with the same idempotency key won the unique constraint race.
      if (isUniqueConstraintError(error)) {
        const existing = await this.prisma.notification.findUnique({
          where: { idempotencyKey: dto.idempotency_key },
          select: { id: true },
        });

        if (existing) {
          this.logger.info(
            {
              event: 'notification.idempotent_hit',
              requestId,
              notification_id: existing.id,
              idempotency_key: dto.idempotency_key,
              idempotency_race: true,
            },
            'idempotent ingest resolved after unique constraint race',
          );
          return { notification_id: existing.id };
        }
      }

      throw error;
    }

    if (!outcome.created) {
      this.logger.info(
        {
          event: 'notification.idempotent_hit',
          requestId,
          notification_id: outcome.notificationId,
          idempotency_key: dto.idempotency_key,
        },
        'idempotent ingest skipped, returning existing notification',
      );
      return { notification_id: outcome.notificationId };
    }

    const smsRecipientCount = this.countSmsRecipients(recipients, channels);

    try {
      await this.dispatchJobs(dto, {
        notificationId: outcome.notificationId,
        requestId,
        priority,
        recipients,
        channels,
      });
    } catch (error) {
      this.logger.error(
        {
          event: 'notification.enqueue_failed',
          requestId,
          notification_id: outcome.notificationId,
          err: error instanceof Error ? error.message : String(error),
        },
        'failed to enqueue delivery jobs',
      );
      throw new ServiceUnavailableException('Notification queue is unavailable, retry the request');
    }

    this.recordIngestMetrics({ recipients, channels, tenantId });

    if (smsRecipientCount > 0) {
      this.logger.warn(
        {
          event: 'notification.channel_skipped',
          requestId,
          notification_id: outcome.notificationId,
          channel: Channel.sms,
          recipient_count: smsRecipientCount,
          reason: 'provider_not_available',
        },
        'sms has no delivery provider yet, recipient rows marked as skipped, ingest accepted',
      );
    }

    this.logger.info(
      {
        event: 'notification.ingested',
        requestId,
        notification_id: outcome.notificationId,
        tenant_id: tenantId,
        recipient_count: recipients.length,
        topic_count: topicKeys.length,
        channel_count: channels.length,
        priority,
        duration_ms: Date.now() - startedAt,
      },
      'notification ingested',
    );

    return { notification_id: outcome.notificationId };
  }

  /**
   * Persists the notification, its per-(recipient x channel) rows and exactly one
   * billing event in a single transaction.
   */
  private async persist(
    dto: NotifyDto,
    params: {
      tenantId: string;
      priority: number;
      channels: Channel[];
      recipients: NormalizedRecipient[];
      topics: string[];
      targetType: string;
      idempotencyExpiresAt: Date;
    },
  ): Promise<PersistOutcome> {
    const {
      tenantId,
      priority,
      channels,
      recipients,
      topics,
      targetType,
      idempotencyExpiresAt,
    } = params;

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.notification.findUnique({
        where: { idempotencyKey: dto.idempotency_key },
        select: { id: true, idempotencyExpiresAt: true },
      });

      if (existing && existing.idempotencyExpiresAt.getTime() > Date.now()) {
        return { notificationId: existing.id, created: false };
      }

      // An expired key is normally removed by the cleanup job; if it is still present,
      // the unique constraint below is handled by the P2002 branch in enqueue().
      const notification = await tx.notification.create({
        data: {
          idempotencyKey: dto.idempotency_key,
          idempotencyExpiresAt,
          tenantId,
          templateKey: dto.template_key,
          payload: asJson({
            data: dto.data,
            scheduled_at: dto.scheduled_at ?? null,
          }),
          priority,
          targetType,
          targetSnapshot: asJson({
            topics,
            recipient_ids: recipients.map((recipient) => recipient.id),
            channels,
          }),
          recipients: {
            create: recipients.flatMap((recipient) =>
              channels.map((channel) => ({
                recipientId: recipient.id,
                channel,
                status: channel === Channel.sms ? Status.skipped : Status.pending,
              })),
            ),
          },
          billingEvents: {
            create: {
              tenantId,
              eventType: BILLING_EVENT_TRIGGERED,
            },
          },
        },
        select: { id: true },
      });

      return { notificationId: notification.id, created: true };
    });
  }

  /** Enqueues one BullMQ job per (recipient x channel), grouped per channel queue. */
  private async dispatchJobs(
    dto: NotifyDto,
    params: {
      notificationId: string;
      requestId: string;
      priority: number;
      recipients: NormalizedRecipient[];
      channels: Channel[];
    },
  ): Promise<void> {
    const { notificationId, requestId, priority, recipients, channels } = params;
    const jobsByQueue = new Map<Queue<DeliveryJobData>, DeliveryJobData[]>();

    for (const recipient of recipients) {
      for (const channel of channels) {
        if (channel === Channel.sms) {
          continue;
        }

        const queue = this.queueForChannel(channel);
        const override = this.toRecipientOverride(recipient);
        const job: DeliveryJobData = {
          notificationId,
          requestId,
          recipientId: recipient.id,
          channel,
          templateKey: dto.template_key,
          data: dto.data,
          priority,
          ...(override ? { recipientOverride: override } : {}),
        };

        const jobs = jobsByQueue.get(queue);
        if (jobs) {
          jobs.push(job);
        } else {
          jobsByQueue.set(queue, [job]);
        }
      }
    }

    await Promise.all(
      [...jobsByQueue.entries()].map(([queue, jobs]) =>
        queue.addBulk(
          jobs.map((data) => ({
            name: DELIVERY_JOB_NAME,
            data,
            opts: { priority },
          })),
        ),
      ),
    );
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

  private recordIngestMetrics(params: {
    recipients: NormalizedRecipient[];
    channels: Channel[];
    tenantId: string;
  }): void {
    const { recipients, channels, tenantId } = params;

    for (let recipientIndex = 0; recipientIndex < recipients.length; recipientIndex += 1) {
      for (const channel of channels) {
        this.metrics.ingestedTotal.inc({
          channel,
          status: channel === Channel.sms ? 'skipped' : 'accepted',
        });
      }
    }

    this.metrics.eventsTotal.inc({ tenant_id: tenantId });
  }

  private countSmsRecipients(recipients: NormalizedRecipient[], channels: Channel[]): number {
    return channels.includes(Channel.sms) ? recipients.length : 0;
  }

  private resolveTenantId(tenantId: string | undefined, tenantIdFromApiKey: string): string {
    const trimmed = tenantId?.trim();

    if (trimmed !== undefined && trimmed.length > 0 && trimmed !== tenantIdFromApiKey) {
      throw new BadRequestException('tenant_id does not match the API key tenant');
    }

    return tenantIdFromApiKey;
  }

  /**
   * Unions direct recipients with topic-derived recipients. Direct entries win because they
   * carry per-request inline data (PART 1 rules 35, 39).
   */
  private mergeRecipients(
    directRecipients: NormalizedRecipient[],
    topicRecipients: Map<string, string[]>,
  ): NormalizedRecipient[] {
    const merged = new Map<string, NormalizedRecipient>();

    for (const recipientId of topicRecipients.keys()) {
      merged.set(recipientId, { id: recipientId });
    }

    for (const recipient of directRecipients) {
      merged.set(recipient.id, { ...merged.get(recipient.id), ...recipient });
    }

    return [...merged.values()];
  }

  private resolveChannels(channels: Channel[] | undefined): Channel[] {
    const requested = channels ?? [Channel.inapp];
    return [...new Set(requested)];
  }

  /**
   * Normalizes strings and objects, deduplicates by id, and lets inline object
   * fields override earlier data for this request only.
   */
  private normalizeRecipients(input: NotifyDto['recipients']): NormalizedRecipient[] {
    if (!Array.isArray(input)) {
      return [];
    }

    const byId = new Map<string, NormalizedRecipient>();

    for (const entry of input.slice(0, MAX_RECIPIENTS_PER_REQUEST)) {
      const recipient: Partial<RecipientInput> & { id?: unknown } =
        typeof entry === 'string' ? { id: entry } : entry;
      const id = typeof recipient.id === 'string' ? recipient.id.trim() : '';

      if (id.length === 0) {
        continue;
      }

      const merged: NormalizedRecipient = {
        ...byId.get(id),
        id,
        ...(typeof recipient.email === 'string' ? { email: recipient.email } : {}),
        ...(typeof recipient.phone === 'string' ? { phone: recipient.phone } : {}),
        ...(typeof recipient.locale === 'string' ? { locale: recipient.locale } : {}),
        ...(typeof recipient.timezone === 'string' ? { timezone: recipient.timezone } : {}),
      };

      byId.set(id, merged);
    }

    return [...byId.values()];
  }

  private toRecipientOverride(
    recipient: NormalizedRecipient,
  ): DeliveryJobData['recipientOverride'] | undefined {
    const override: NonNullable<DeliveryJobData['recipientOverride']> = {};

    if (recipient.email !== undefined) {
      override.email = recipient.email;
    }
    if (recipient.phone !== undefined) {
      override.phone = recipient.phone;
    }
    if (recipient.locale !== undefined) {
      override.locale = recipient.locale;
    }
    if (recipient.timezone !== undefined) {
      override.timezone = recipient.timezone;
    }

    return Object.keys(override).length > 0 ? override : undefined;
  }
}

function resolveTargetType(
  topicKeys: string[],
  directRecipients: NormalizedRecipient[],
): 'recipients' | 'topics' | 'mixed' {
  if (topicKeys.length === 0) {
    return 'recipients';
  }

  return directRecipients.length === 0 ? 'topics' : 'mixed';
}
