import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

const REDIS_PING_TIMEOUT_MS = 2000;

/**
 * Readiness probe for Redis.
 *
 * A dedicated, lazily connected client is used so that a Redis outage cannot
 * block the ingest queue connections and so that readiness reflects real
 * connectivity instead of a cached BullMQ connection state.
 */
@Injectable()
export class RedisHealthIndicator implements OnModuleDestroy {
  private readonly client: Redis;

  constructor(
    config: ConfigService,
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(RedisHealthIndicator.name);

    this.client = new Redis(config.getOrThrow<string>('REDIS_URL'), {
      lazyConnect: true,
      connectTimeout: REDIS_PING_TIMEOUT_MS,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: true,
      // Health probes must not keep retrying forever in the background.
      retryStrategy: () => null,
    });

    this.client.on('error', (error: Error) => {
      this.logger.warn(
        { event: 'redis.health_client.error', err: error.message },
        'redis health client error',
      );
    });
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    const startedAt = Date.now();

    try {
      const response = await this.pingWithTimeout();

      if (response !== 'PONG') {
        return indicator.down({ message: `unexpected PING response: ${response}` });
      }

      return indicator.up({ latency_ms: Date.now() - startedAt });
    } catch (error) {
      return indicator.down({
        message: error instanceof Error ? error.message : 'redis ping failed',
      });
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.status !== 'end') {
      this.client.disconnect();
    }
  }

  private async pingWithTimeout(): Promise<string> {
    let timer: NodeJS.Timeout | undefined;

    try {
      const ping = this.ensureConnected().then(() => this.client.ping());

      return await Promise.race([
        ping,
        new Promise<string>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error(`redis ping timed out after ${REDIS_PING_TIMEOUT_MS}ms`)),
            REDIS_PING_TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.client.status === 'wait' || this.client.status === 'end') {
      await this.client.connect();
    }
  }
}
