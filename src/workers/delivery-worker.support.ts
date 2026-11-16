import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import {
  Channel,
  Status,
  type NotificationRecipient,
} from '@prisma/client';
import type { Job } from 'bullmq';
import { Queue } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';
import { DELIVERY_JOB_NAME, type DeliveryJobData } from '../ingest/ingest.service';
import { PreferencesService, type PreferenceDecision } from '../preferences/preferences.service';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_EMAIL, QUEUE_INAPP } from '../queues/queues.module';

const MAX_DEFERRALS = 3;
const TRUNCATED_FIELD_LENGTH = 4000;

export type DeliveryStatus = 'sent' | 'skipped' | 'deferred' | 'fallback';

export interface DeliveryResult {
  status: DeliveryStatus;
  reason?: string;
  providerMessageId?: string | null;
}

export interface DeliveryContext {
  recipient: NotificationRecipient;
  tenantId: string;
  priority: number;
  payload: unknown;
  deletedAt: Date | null;
}

export interface DeliveryFailure {
  errorName: string;
  errorMessage: string;
  errorStack: string | null;
}

export function isTerminalStatus(status: Status): boolean {
  return status === Status.sent || status === Status.read || status === Status.skipped;
}

export function toDeliveryFailure(error: unknown): DeliveryFailure {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack === undefined ? null : error.stack,
    };
  }

  return { errorName: 'UnknownError', errorMessage: String(error), errorStack: null };
}

export function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

@Injectable()
export class DeliveryContextService {
  constructor(private readonly prisma: PrismaService) {}

  async load(data: DeliveryJobData): Promise<DeliveryContext | null> {
    const recipient = await this.prisma.notificationRecipient.findUnique({
      where: {
        notificationId_recipientId_channel: {
          notificationId: data.notificationId,
          recipientId: data.recipientId,
          channel: data.channel,
        },
      },
      include: {
        notification: {
          select: {
            tenantId: true,
            deletedAt: true,
            priority: true,
            payload: true,
          },
        },
      },
    });

    if (recipient === null) {
      return null;
    }

    return {
      recipient,
      tenantId: recipient.notification.tenantId,
      priority: recipient.notification.priority,
      payload: recipient.notification.payload,
      deletedAt: recipient.notification.deletedAt,
    };
  }

  async loadSubscriber(
    tenantId: string,
    externalId: string,
  ): Promise<{
    email: string | null;
    phone: string | null;
    locale: string | null;
    timezone: string;
  } | null> {
    return this.prisma.subscriber.findUnique({
      where: { tenantId_externalId: { tenantId, externalId } },
      select: { email: true, phone: true, locale: true, timezone: true },
    });
  }
}

@Injectable()
export class DeliveryAttemptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(DeliveryAttemptsService.name);
  }

  async markSkipped(recipientRowId: bigint, reason: string): Promise<void> {
    await this.prisma.notificationRecipient.update({
      where: { id: recipientRowId },
      data: { status: Status.skipped, lastError: reason },
    });
  }

  /**
   * Records the exact published template version resolved for this recipient row. This is
   * delivery provenance only; template resolution still happens when the worker processes the job.
   */
  async recordResolvedTemplate(params: {
    recipientRowId: bigint;
    templateId: string;
    templateVersion: number;
  }): Promise<void> {
    await this.prisma.notificationRecipient.update({
      where: { id: params.recipientRowId },
      data: {
        templateId: params.templateId,
        templateVersion: params.templateVersion,
        templateResolvedAt: new Date(),
      },
    });
  }

  async recordSuccess(params: {
    recipientRowId: bigint;
    notificationId: string;
    recipientId: string;
    channel: Channel;
    attemptNumber: number;
    providerName: string;
    providerMessageId: string | null;
    durationMs: number;
  }): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.notificationRecipient.update({
        where: { id: params.recipientRowId },
        data: {
          status: Status.sent,
          sentAt: new Date(),
          attempts: { increment: 1 },
          providerName: params.providerName,
          providerMessageId: params.providerMessageId,
          lastError: null,
        },
      }),
      this.prisma.deliveryAttempt.create({
        data: {
          notificationId: params.notificationId,
          recipientId: params.recipientId,
          channel: params.channel,
          attemptNumber: params.attemptNumber,
          providerName: params.providerName,
          status: 'success',
          durationMs: params.durationMs,
          occurredAt: new Date(),
        },
      }),
    ]);
  }

  async recordFailure(params: {
    recipientRowId: bigint;
    notificationId: string;
    recipientId: string;
    channel: Channel;
    attemptNumber: number;
    providerName: string;
    durationMs: number;
    failure: DeliveryFailure;
  }): Promise<void> {
    try {
      await this.prisma.$transaction([
        this.prisma.notificationRecipient.update({
          where: { id: params.recipientRowId },
          data: {
            status: Status.failed,
            attempts: { increment: 1 },
            providerName: params.providerName,
            lastError: truncate(params.failure.errorMessage, TRUNCATED_FIELD_LENGTH),
          },
        }),
        this.prisma.deliveryAttempt.create({
          data: {
            notificationId: params.notificationId,
            recipientId: params.recipientId,
            channel: params.channel,
            attemptNumber: params.attemptNumber,
            providerName: params.providerName,
            status: 'failed',
            errorName: truncate(params.failure.errorName, TRUNCATED_FIELD_LENGTH),
            errorMessage: truncate(params.failure.errorMessage, TRUNCATED_FIELD_LENGTH),
            errorStack:
              params.failure.errorStack === null
                ? null
                : truncate(params.failure.errorStack, TRUNCATED_FIELD_LENGTH),
            durationMs: params.durationMs,
            occurredAt: new Date(),
          },
        }),
      ]);
    } catch (error) {
      this.logger.error(
        {
          event: 'delivery.failure_persist_failed',
          notification_id: params.notificationId,
          recipient_id: params.recipientId,
          err: error instanceof Error ? error.message : String(error),
        },
        'failed to persist the delivery failure',
      );
    }
  }
}

/**
 * Applies the preference decision: skip (optionally fallback channel), defer (quiet hours),
 * or deliver. Deferred jobs keep the recipient row pending; no delivery attempt is recorded
 * because no provider call happened.
 */
@Injectable()
export class PreferenceEnforcementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly preferences: PreferencesService,
    private readonly attempts: DeliveryAttemptsService,
    private readonly logger: PinoLogger,
    @InjectQueue(QUEUE_INAPP) private readonly inAppQueue: Queue<DeliveryJobData>,
    @InjectQueue(QUEUE_EMAIL) private readonly emailQueue: Queue<DeliveryJobData>,
  ) {
    this.logger.setContext(PreferenceEnforcementService.name);
  }

  async evaluate(
    job: Job<DeliveryJobData>,
    tenantId: string,
    subscriberTimezone: string | null,
  ): Promise<PreferenceDecision> {
    return this.preferences.evaluate({
      tenantId,
      recipientId: job.data.recipientId,
      channel: job.data.channel,
      priority: job.data.priority,
      subscriberTimezone,
    });
  }

  async applySkip(params: {
    job: Job<DeliveryJobData>;
    recipientRowId: bigint;
    fallbackChannel: Channel | null;
  }): Promise<'skipped' | 'fallback_enqueued'> {
    const { job, recipientRowId, fallbackChannel } = params;
    const data = job.data;

    if (data.fallbackFrom !== undefined) {
      // A fallback job must not fallback again.
      await this.attempts.markSkipped(recipientRowId, 'preference_disabled');
      this.logger.warn(
        {
          event: 'preference.fallback_skipped',
          notification_id: data.notificationId,
          recipient_id: data.recipientId,
          channel: data.channel,
          fallback_from: data.fallbackFrom,
        },
        'fallback job preference is disabled too, skipping without another hop',
      );
      return 'skipped';
    }

    const fallbackQueue = fallbackChannel === null ? undefined : this.queueFor(fallbackChannel);

    if (
      fallbackChannel !== null &&
      fallbackChannel !== data.channel &&
      fallbackQueue !== undefined
    ) {
      await this.prisma.notificationRecipient.upsert({
        where: {
          notificationId_recipientId_channel: {
            notificationId: data.notificationId,
            recipientId: data.recipientId,
            channel: fallbackChannel,
          },
        },
        create: {
          notificationId: data.notificationId,
          recipientId: data.recipientId,
          channel: fallbackChannel,
          status: Status.pending,
        },
        update: {},
      });

      await this.attempts.markSkipped(
        recipientRowId,
        `channel_disabled_fallback:${fallbackChannel}`,
      );

      await fallbackQueue.add(
        DELIVERY_JOB_NAME,
        {
          ...data,
          channel: fallbackChannel,
          fallbackFrom: data.channel,
          deferralCount: 0,
        },
        { priority: data.priority },
      );

      this.logger.info(
        {
          event: 'preference.fallback_enqueued',
          notification_id: data.notificationId,
          recipient_id: data.recipientId,
          channel: data.channel,
          fallback_channel: fallbackChannel,
        },
        'primary channel disabled by preference, fallback channel enqueued',
      );

      return 'fallback_enqueued';
    }

    await this.attempts.markSkipped(recipientRowId, 'preference_disabled');

    this.logger.info(
      {
        event: 'preference.skipped',
        notification_id: data.notificationId,
        recipient_id: data.recipientId,
        channel: data.channel,
        reason: 'preference_disabled',
      },
      'channel disabled by recipient preference, delivery skipped',
    );

    return 'skipped';
  }

  async defer(
    job: Job<DeliveryJobData>,
    decision: Extract<PreferenceDecision, { action: 'defer' }>,
  ): Promise<'deferred' | 'max_deferrals_reached'> {
    const deferrals = job.data.deferralCount ?? 0;
    const queue = this.queueFor(job.data.channel);

    if (deferrals >= MAX_DEFERRALS || queue === undefined) {
      this.logger.warn(
        {
          event: 'delivery.quiet_hours_max_deferrals',
          notification_id: job.data.notificationId,
          recipient_id: job.data.recipientId,
          channel: job.data.channel,
          deferrals,
        },
        'quiet hours still active after maximum deferrals, delivering anyway',
      );
      return 'max_deferrals_reached';
    }

    await queue.add(
      DELIVERY_JOB_NAME,
      { ...job.data, deferralCount: deferrals + 1 },
      { delay: decision.delayMs, priority: job.data.priority },
    );

    this.logger.info(
      {
        event: 'delivery.deferred',
        notification_id: job.data.notificationId,
        recipient_id: job.data.recipientId,
        channel: job.data.channel,
        delay_ms: decision.delayMs,
        timezone: decision.timezone,
        local_time: decision.localTime,
        deferral: deferrals + 1,
      },
      'delivery deferred until quiet hours end',
    );

    return 'deferred';
  }

  private queueFor(channel: Channel): Queue<DeliveryJobData> | undefined {
    if (channel === Channel.inapp) {
      return this.inAppQueue;
    }

    if (channel === Channel.email) {
      return this.emailQueue;
    }

    return undefined;
  }
}
