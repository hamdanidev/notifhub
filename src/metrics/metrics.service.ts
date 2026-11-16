import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, register } from 'prom-client';
import { Queue } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';
import { QUEUE_EMAIL, QUEUE_INAPP, QUEUE_WHATSAPP } from '../queues/queues.module';

/**
 * Prometheus metrics on the default registry.
 * Metrics marked "reserved" are registered now so dashboards and alert rules can be
 * authored against stable names; they are incremented by later phases.
 */
@Injectable()
export class MetricsService {
  private readonly registry = register;

  readonly ingestedTotal: Counter<'channel' | 'status'>;
  readonly eventsTotal: Counter<'tenant_id'>;
  readonly deliveryLatencySeconds: Histogram<'provider' | 'channel'>;
  readonly providerErrorsTotal: Counter<'provider' | 'channel'>;
  readonly templateRenderErrorsTotal: Counter<'code' | 'channel'>;
  readonly templateVariableMissingTotal: Counter<'channel'>;
  readonly sseConnectionsActive: Gauge;
  readonly queueDepth: Gauge<'queue'>;

  constructor(
    @InjectQueue(QUEUE_INAPP) private readonly inappQueue: Queue,
    @InjectQueue(QUEUE_EMAIL) private readonly emailQueue: Queue,
    @InjectQueue(QUEUE_WHATSAPP) private readonly whatsappQueue: Queue,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(MetricsService.name);

    this.ingestedTotal = new Counter({
      name: 'notifhub_ingested_total',
      help: 'Ingest fan-out units accepted per channel and status',
      labelNames: ['channel', 'status'],
    });

    this.eventsTotal = new Counter({
      name: 'notifhub_events_total',
      help: 'Billing-relevant notification events per tenant',
      labelNames: ['tenant_id'],
    });

    this.deliveryLatencySeconds = new Histogram({
      name: 'notifhub_delivery_latency_seconds',
      help: 'Provider delivery latency in seconds per provider and channel',
      labelNames: ['provider', 'channel'],
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    });

    this.providerErrorsTotal = new Counter({
      name: 'notifhub_provider_errors_total',
      help: 'Provider call failures per provider and channel',
      labelNames: ['provider', 'channel'],
    });

    this.templateRenderErrorsTotal = new Counter({
      name: 'notifhub_template_render_errors_total',
      help: 'Non-retryable template render failures per code and channel',
      labelNames: ['code', 'channel'],
    });

    this.templateVariableMissingTotal = new Counter({
      name: 'notifhub_template_variable_missing_total',
      help: 'Rendered templates with missing/invalid variables per channel',
      labelNames: ['channel'],
    });

    this.sseConnectionsActive = new Gauge({
      name: 'notifhub_sse_connections_active',
      help: 'Active in-app SSE connections',
    });

    this.queueDepth = new Gauge({
      name: 'notifhub_queue_depth',
      help: 'Waiting + active + delayed jobs per queue, collected on scrape',
      labelNames: ['queue'],
      collect: () => this.collectQueueDepth(),
    });
  }

  async metrics(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  private async collectQueueDepth(): Promise<void> {
    const queues: Queue[] = [this.inappQueue, this.emailQueue, this.whatsappQueue];

    await Promise.all(
      queues.map(async (queue) => {
        try {
          const counts = await queue.getJobCounts('waiting', 'active', 'delayed');
          const depth = (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0);
          this.queueDepth.set({ queue: queue.name }, depth);
        } catch (error) {
          this.logger.warn(
            {
              event: 'metrics.queue_depth_failed',
              queue: queue.name,
              err: error instanceof Error ? error.message : String(error),
            },
            'failed to read queue depth',
          );
        }
      }),
    );
  }
}
