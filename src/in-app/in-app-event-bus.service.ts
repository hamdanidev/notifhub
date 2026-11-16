import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

const CHANNEL_PREFIX = 'notifhub:inapp:events:';
const STREAM_PREFIX = 'notifhub:inapp:stream:';
const STREAM_MAX_LENGTH = 500;
const REPLAY_PAGE_SIZE = 500;
const PAYLOAD_FIELD = 'payload';

export interface InAppEventContent {
  notificationId: string;
  templateKey: string;
  subject: string | null;
  body: string;
  data: Record<string, unknown>;
  priority: number;
  createdAt: string;
}

export interface InAppStoredEvent {
  id: string;
  content: InAppEventContent;
}

export interface InAppLiveEvent extends InAppStoredEvent {
  tenantId: string;
  recipientId: string;
}

interface StreamPayload {
  tenantId: string;
  recipientId: string;
  content: InAppEventContent;
}

/**
 * Redis transport for in-app events.
 *
 * - Stream (`notifhub:inapp:stream:<tenant>:<recipient>`) is the replay buffer: each event is
 *   appended with an id, kept for SSE_REPLAY_BUFFER_SECONDS, and capped at 500 entries.
 * - Pub/Sub (`notifhub:inapp:events:<tenant>:<recipient>`) is the live fan-out.
 *
 * Both are written for every event so a reconnecting client can catch up via Last-Event-ID
 * (PART 1 rule 42).
 */
@Injectable()
export class InAppEventBus implements OnModuleInit, OnModuleDestroy {
  private readonly commandClient: Redis;
  private readonly subscriberClient: Redis;
  private readonly listeners = new Set<(event: InAppLiveEvent) => void>();
  private readonly replayTtlSeconds: number;
  private subscribed = false;

  constructor(
    config: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(InAppEventBus.name);
    this.replayTtlSeconds = config.getOrThrow<number>('SSE_REPLAY_BUFFER_SECONDS');

    const redisUrl = config.getOrThrow<string>('REDIS_URL');

    this.commandClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: true,
      connectionName: 'notifhub-inapp-command',
    });

    this.subscriberClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectionName: 'notifhub-inapp-subscriber',
    });

    this.commandClient.on('error', (error: Error) => {
      this.logger.warn(
        { event: 'redis.inapp.command_error', err: error.message },
        'in-app redis command client error',
      );
    });

    this.subscriberClient.on('error', (error: Error) => {
      this.logger.warn(
        { event: 'redis.inapp.subscriber_error', err: error.message },
        'in-app redis subscriber client error',
      );
    });
  }

  async onModuleInit(): Promise<void> {
    this.subscriberClient.on('pmessage', (_pattern: string, _channel: string, message: string) =>
      this.handleMessage(message),
    );

    await this.subscriberClient.psubscribe(`${CHANNEL_PREFIX}*`);
    this.subscribed = true;

    this.logger.info(
      { event: 'inapp.bus.subscribed', pattern: `${CHANNEL_PREFIX}*` },
      'subscribed to in-app event channels',
    );
  }

  onMessage(listener: (event: InAppLiveEvent) => void): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Appends the event to the replay stream and publishes it live. Returns the stream id. */
  async publish(
    tenantId: string,
    recipientId: string,
    content: InAppEventContent,
  ): Promise<string> {
    const streamKey = `${STREAM_PREFIX}${tenantId}:${recipientId}`;
    const channel = `${CHANNEL_PREFIX}${tenantId}:${recipientId}`;
    const payload: StreamPayload = { tenantId, recipientId, content };

    const streamId = await this.commandClient.xadd(
      streamKey,
      'MAXLEN',
      '~',
      STREAM_MAX_LENGTH,
      '*',
      PAYLOAD_FIELD,
      JSON.stringify(payload),
    );

    if (streamId === null) {
      throw new Error('Redis XADD returned no stream id');
    }

    await this.commandClient
      .multi()
      .expire(streamKey, this.replayTtlSeconds)
      .publish(channel, JSON.stringify({ id: streamId, ...payload }))
      .exec();

    return streamId;
  }

  /** Reads buffered events newer than `afterId` (exclusive), ordered by stream id. */
  async replay(
    tenantId: string,
    recipientId: string,
    afterId: string | undefined,
  ): Promise<InAppStoredEvent[]> {
    const streamKey = `${STREAM_PREFIX}${tenantId}:${recipientId}`;
    const start = afterId !== undefined && afterId.length > 0 ? `(${afterId}` : '-';

    const entries = await this.commandClient.xrange(streamKey, start, '+', 'COUNT', REPLAY_PAGE_SIZE);
    const events: InAppStoredEvent[] = [];

    for (const [id, fields] of entries) {
      const payload = readField(fields, PAYLOAD_FIELD);

      if (payload === undefined) {
        continue;
      }

      const parsed = this.parseStreamPayload(payload);

      if (parsed !== null) {
        events.push({ id, content: parsed.content });
      }
    }

    events.sort((left, right) => compareStreamIds(left.id, right.id));

    return events;
  }

  async onModuleDestroy(): Promise<void> {
    this.listeners.clear();

    try {
      if (this.subscribed) {
        await this.subscriberClient.punsubscribe(`${CHANNEL_PREFIX}*`);
      }
    } catch (error) {
      this.logger.warn(
        {
          event: 'redis.inapp.unsubscribe_failed',
          err: error instanceof Error ? error.message : String(error),
        },
        'failed to unsubscribe in-app redis pattern',
      );
    }

    this.subscriberClient.disconnect();

    try {
      await this.commandClient.quit();
    } catch {
      this.commandClient.disconnect();
    }
  }

  private handleMessage(raw: string): void {
    const event = this.parseLiveMessage(raw);

    if (event === null) {
      return;
    }

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        this.logger.error(
          {
            event: 'inapp.bus.listener_failed',
            err: error instanceof Error ? error.message : String(error),
          },
          'in-app event listener failed',
        );
      }
    }
  }

  private parseLiveMessage(raw: string): InAppLiveEvent | null {
    try {
      const parsed: unknown = JSON.parse(raw);

      if (!isRecord(parsed)) {
        return null;
      }

      const { id, tenantId, recipientId } = parsed;

      if (
        typeof id !== 'string' ||
        typeof tenantId !== 'string' ||
        typeof recipientId !== 'string' ||
        !isRecord(parsed.content)
      ) {
        return null;
      }

      return {
        id,
        tenantId,
        recipientId,
        content: parsed.content as unknown as InAppEventContent,
      };
    } catch {
      this.logger.warn({ event: 'inapp.bus.invalid_message' }, 'discarded invalid in-app event message');
      return null;
    }
  }

  private parseStreamPayload(raw: string): StreamPayload | null {
    try {
      const parsed: unknown = JSON.parse(raw);

      if (!isRecord(parsed) || typeof parsed.tenantId !== 'string') {
        return null;
      }

      if (typeof parsed.recipientId !== 'string' || !isRecord(parsed.content)) {
        return null;
      }

      return {
        tenantId: parsed.tenantId,
        recipientId: parsed.recipientId,
        content: parsed.content as unknown as InAppEventContent,
      };
    } catch {
      this.logger.warn(
        { event: 'inapp.bus.invalid_stream_entry' },
        'discarded invalid in-app stream entry',
      );
      return null;
    }
  }
}

export function compareStreamIds(left: string, right: string): number {
  const leftValue = parseStreamId(left);
  const rightValue = parseStreamId(right);

  if (leftValue < rightValue) {
    return -1;
  }
  if (leftValue > rightValue) {
    return 1;
  }
  return 0;
}

function parseStreamId(id: string): bigint {
  const [milliseconds = '0', sequence = '0'] = id.split('-');

  try {
    return BigInt(milliseconds) * 1_000_000_000n + BigInt(sequence);
  } catch {
    return 0n;
  }
}

function readField(fields: string[], name: string): string | undefined {
  for (let index = 0; index < fields.length; index += 2) {
    if (fields[index] === name) {
      return fields[index + 1];
    }
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
