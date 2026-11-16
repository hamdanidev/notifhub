import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { JobsOptions, RedisOptions } from 'bullmq';

/**
 * Injection tokens. The token (USED by @InjectQueue) is decoupled from the
 * BullMQ queue name, which is what appears in Redis and in the dashboard.
 */
export const QUEUE_INAPP = 'QUEUE_INAPP';
export const QUEUE_EMAIL = 'QUEUE_EMAIL';
export const QUEUE_WHATSAPP = 'QUEUE_WHATSAPP';

/**
 * BullMQ reserves ":" as the Redis key separator and rejects it in queue names
 * (both v5 and v6), so the logical channel queues "notification:inapp",
 * "notification:email" and "notification:whatsapp" are registered as
 * "notification-inapp" etc. under the "notifhub" key prefix.
 */
export const QUEUE_NAME_INAPP = 'notification-inapp';
export const QUEUE_NAME_EMAIL = 'notification-email';
export const QUEUE_NAME_WHATSAPP = 'notification-whatsapp';

/** Retry/backoff/retention policy shared by every channel queue. */
const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: false,
};

/**
 * Builds BullMQ/ioredis connection options from REDIS_URL.
 *
 * FAIL_MODE_ON_REDIS_DOWN=closed (default) fails fast when Redis is unreachable
 * (ingest answers 503) instead of buffering commands indefinitely; "open" keeps
 * the offline queue enabled so short Redis restarts do not fail requests.
 */
export function parseRedisConnection(
  redisUrl: string,
  failMode: 'open' | 'closed',
): RedisOptions {
  const url = new URL(redisUrl);
  const database = url.pathname.replace('/', '');

  return {
    host: url.hostname,
    port: url.port.length > 0 ? Number(url.port) : 6379,
    username: url.username.length > 0 ? url.username : undefined,
    password: url.password.length > 0 ? url.password : undefined,
    db: database.length > 0 ? Number(database) : undefined,
    maxRetriesPerRequest: null,
    enableOfflineQueue: failMode === 'open',
  };
}

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redisUrl = config.getOrThrow<string>('REDIS_URL');
        const failMode = config.getOrThrow<'open' | 'closed'>('FAIL_MODE_ON_REDIS_DOWN');

        return {
          prefix: 'notifhub',
          connection: parseRedisConnection(redisUrl, failMode),
          defaultJobOptions: DEFAULT_JOB_OPTIONS,
        };
      },
    }),
    BullModule.registerQueueAsync(
      {
        name: QUEUE_INAPP,
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: () => ({
          name: QUEUE_NAME_INAPP,
          defaultJobOptions: DEFAULT_JOB_OPTIONS,
        }),
      },
      {
        name: QUEUE_EMAIL,
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          name: QUEUE_NAME_EMAIL,
          defaultJobOptions: DEFAULT_JOB_OPTIONS,
          limiter: {
            max: config.getOrThrow<number>('PROVIDER_RATE_LIMIT_EMAIL_PER_SEC'),
            duration: 1000,
          },
        }),
      },
      {
        name: QUEUE_WHATSAPP,
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          name: QUEUE_NAME_WHATSAPP,
          defaultJobOptions: DEFAULT_JOB_OPTIONS,
          limiter: {
            max: config.getOrThrow<number>('PROVIDER_RATE_LIMIT_WHATSAPP_PER_SEC'),
            duration: 1000,
          },
        }),
      },
    ),
  ],
  exports: [BullModule],
})
export class QueuesModule {}
