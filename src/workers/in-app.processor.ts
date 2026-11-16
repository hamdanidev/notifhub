import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Channel } from '@prisma/client';
import { Job, UnrecoverableError } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';
import { ReadinessService } from '../common/readiness.service';
import type { DeliveryJobData } from '../ingest/ingest.service';
import { MetricsService } from '../metrics/metrics.service';
import { ProviderExecutor } from '../providers/provider-executor.service';
import { ProviderRegistry } from '../providers/provider-registry.service';
import { QUEUE_NAME_INAPP } from '../queues/queues.module';
import { TemplateService } from '../templates/template.service';
import { TemplateRenderError } from '../templates/template.types';
import {
  DeliveryAttemptsService,
  DeliveryContextService,
  PreferenceEnforcementService,
  isTerminalStatus,
  toDeliveryFailure,
  type DeliveryResult,
} from './delivery-worker.support';

/**
 * In-app delivery worker.
 *
 * resolve template -> preferences -> render -> in-app provider (Redis stream + pub/sub)
 * -> status + delivery_attempts.
 */
@Processor(QUEUE_NAME_INAPP)
@Injectable()
export class InAppProcessor extends WorkerHost {
  constructor(
    private readonly readiness: ReadinessService,
    private readonly contexts: DeliveryContextService,
    private readonly templates: TemplateService,
    private readonly enforcement: PreferenceEnforcementService,
    private readonly attempts: DeliveryAttemptsService,
    private readonly providers: ProviderRegistry,
    private readonly executor: ProviderExecutor,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger,
  ) {
    super();
    this.logger.setContext(InAppProcessor.name);
  }

  async process(job: Job<DeliveryJobData>): Promise<DeliveryResult> {
    await this.readiness.untilReady();

    const startedAt = Date.now();
    const data = job.data;
    const context = await this.contexts.load(data);

    if (context === null) {
      this.logger.error(
        {
          event: 'delivery.failed',
          requestId: data.requestId,
          notification_id: data.notificationId,
          recipient_id: data.recipientId,
          channel: Channel.inapp,
          reason: 'recipient_row_missing',
        },
        'in-app recipient row not found',
      );
      throw new UnrecoverableError('in-app recipient row not found');
    }

    if (context.deletedAt !== null) {
      throw new UnrecoverableError('notification is soft deleted');
    }

    if (isTerminalStatus(context.recipient.status)) {
      return this.skipDuplicate(job, context.recipient.status);
    }

    const subscriber = await this.contexts.loadSubscriber(context.tenantId, data.recipientId);
    const locale = data.recipientOverride?.locale ?? subscriber?.locale ?? undefined;
    const attemptNumber = context.recipient.attempts + 1;
    const provider = this.providers.getOrThrow(Channel.inapp);

    try {
      const template = await this.templates.resolve(
        context.tenantId,
        data.templateKey,
        Channel.inapp,
        locale,
      );

      if (template === null) {
        throw new UnrecoverableError(`template not found: ${data.templateKey}`);
      }

      if (
        context.recipient.templateResolvedAt === null ||
        context.recipient.templateId !== template.id ||
        context.recipient.templateVersion !== template.version
      ) {
        await this.attempts.recordResolvedTemplate({
          recipientRowId: context.recipient.id,
          templateId: template.id,
          templateVersion: template.version,
        });
      }

      const decision = await this.enforcement.evaluate(job, context.tenantId, subscriber?.timezone ?? null);

      if (decision.action === 'skip') {
        const outcome = await this.enforcement.applySkip({
          job,
          recipientRowId: context.recipient.id,
          fallbackChannel: template.fallbackChannel,
        });

        return outcome === 'fallback_enqueued'
          ? { status: 'fallback', reason: 'preference_disabled' }
          : { status: 'skipped', reason: 'preference_disabled' };
      }

      if (decision.action === 'defer') {
        const deferred = await this.enforcement.defer(job, decision);

        if (deferred === 'deferred') {
          return { status: 'deferred', reason: 'quiet_hours' };
        }
      }

      const rendered = this.templates.render(template, data.data);

      if (rendered.warnings.length > 0) {
        this.logger.warn(
          {
            event: 'template.render.warning',
            notification_id: data.notificationId,
            template_id: template.id,
            template_version: template.version,
            warnings: rendered.warnings,
          },
          'template rendered with warnings',
        );
      }

      const result = await this.executor.execute(provider, {
        notificationId: data.notificationId,
        recipientId: data.recipientId,
        tenantId: context.tenantId,
        priority: data.priority,
        templateKey: data.templateKey,
        subject: rendered.subject,
        body: rendered.body,
        data: data.data,
        to: data.recipientId,
      });

      const durationMs = Date.now() - startedAt;

      await this.attempts.recordSuccess({
        recipientRowId: context.recipient.id,
        notificationId: data.notificationId,
        recipientId: data.recipientId,
        channel: Channel.inapp,
        attemptNumber,
        providerName: provider.name,
        providerMessageId: result.providerMessageId,
        durationMs,
      });

      this.metrics.deliveryLatencySeconds.observe(
        { provider: provider.name, channel: Channel.inapp },
        durationMs / 1000,
      );

      this.logger.info(
        {
          event: 'delivery.attempted',
          requestId: data.requestId,
          notification_id: data.notificationId,
          recipient_id: data.recipientId,
          channel: Channel.inapp,
          provider: provider.name,
          attempt: attemptNumber,
          duration_ms: durationMs,
          stream_id: result.providerMessageId,
        },
        'in-app notification published to the event stream',
      );

      return { status: 'sent', providerMessageId: result.providerMessageId };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const failure = toDeliveryFailure(error);

      if (error instanceof TemplateRenderError) {
        this.metrics.templateRenderErrorsTotal.inc({
          code: error.code,
          channel: Channel.inapp,
        });

        if (error.code === 'template_variable_missing') {
          this.metrics.templateVariableMissingTotal.inc({ channel: Channel.inapp });
        }
      }

      await this.attempts.recordFailure({
        recipientRowId: context.recipient.id,
        notificationId: data.notificationId,
        recipientId: data.recipientId,
        channel: Channel.inapp,
        attemptNumber,
        providerName: provider.name,
        durationMs,
        failure,
      });

      this.metrics.providerErrorsTotal.inc({ provider: provider.name, channel: Channel.inapp });

      this.logger.error(
        {
          event: 'delivery.failed',
          requestId: data.requestId,
          notification_id: data.notificationId,
          recipient_id: data.recipientId,
          channel: Channel.inapp,
          provider: provider.name,
          attempt: attemptNumber,
          error_name: failure.errorName,
          error_message: failure.errorMessage,
          duration_ms: durationMs,
          unrecoverable: error instanceof UnrecoverableError,
        },
        'in-app delivery failed',
      );

      throw error instanceof TemplateRenderError
        ? new UnrecoverableError(error.message)
        : error;
    }
  }

  private skipDuplicate(job: Job<DeliveryJobData>, status: string): DeliveryResult {
    this.logger.info(
      {
        event: 'delivery.skipped_duplicate',
        requestId: job.data.requestId,
        notification_id: job.data.notificationId,
        recipient_id: job.data.recipientId,
        channel: Channel.inapp,
        status,
      },
      'in-app recipient already handled, skipping duplicate delivery',
    );

    return { status: 'skipped', reason: status };
  }
}
