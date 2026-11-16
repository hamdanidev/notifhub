import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import type { SubscriberPrincipal } from '../auth/subscriber/subscriber.types';
import type { RequestWithSubscriber } from '../auth/subscriber/subscriber.types';
import { RequestContext } from '../common/request-context';
import { MetricsService } from '../metrics/metrics.service';
import {
  compareStreamIds,
  InAppEventBus,
  type InAppLiveEvent,
} from './in-app-event-bus.service';

const MIN_HEARTBEAT_MS = 15_000;
const MAX_HEARTBEAT_MS = 30_000;
const HEARTBEAT_COMMENT = ':\n\n';
const SSE_EVENT_NAME = 'notification';
const SSE_RETRY_HINT = 'retry: 5000\n\n';

/**
 * One connected SSE client. While the replay is running, live events are buffered and
 * later flushed in stream-id order so a client never sees an older event after a newer one.
 */
class SseSession {
  private readonly buffered: Array<{ id: string; data: string }> = [];
  private replaying = true;
  private closed = false;
  private lastDeliveredId: string | undefined;

  constructor(
    readonly tenantId: string,
    readonly recipientId: string,
    private readonly response: Response,
  ) {}

  get isClosed(): boolean {
    return this.closed;
  }

  writeEvent(id: string, data: string): void {
    if (this.closed) {
      return;
    }

    if (this.replaying) {
      this.buffered.push({ id, data });
      return;
    }

    if (this.lastDeliveredId !== undefined && compareStreamIds(id, this.lastDeliveredId) <= 0) {
      return;
    }

    try {
      this.response.write(`id: ${id}\nevent: ${SSE_EVENT_NAME}\ndata: ${data}\n\n`);
      this.lastDeliveredId = id;
    } catch {
      this.closed = true;
    }
  }

  finishReplay(): void {
    this.replaying = false;
    const pending = this.buffered.splice(0).sort((left, right) => compareStreamIds(left.id, right.id));

    for (const item of pending) {
      this.writeEvent(item.id, item.data);
    }
  }

  writeHeartbeat(): void {
    if (this.closed) {
      return;
    }

    try {
      this.response.write(HEARTBEAT_COMMENT);
    } catch {
      this.closed = true;
    }
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;

    try {
      this.response.end();
    } catch {
      // Response already destroyed by the client; nothing else to release.
    }
  }
}

/**
 * Tracks live SSE connections and fans out Pub/Sub events to them.
 * A single heartbeat timer covers all connections (interval clamped to 15-30 seconds).
 */
@Injectable()
export class SseConnectionRegistry implements OnModuleInit, OnModuleDestroy {
  private readonly sessions = new Map<string, Set<SseSession>>();
  private readonly heartbeatIntervalMs: number;
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private unsubscribeBus: (() => void) | undefined;

  constructor(
    private readonly eventBus: InAppEventBus,
    private readonly metrics: MetricsService,
    config: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SseConnectionRegistry.name);
    const heartbeatSeconds = config.getOrThrow<number>('SSE_HEARTBEAT_INTERVAL_SECONDS');
    this.heartbeatIntervalMs = Math.min(
      MAX_HEARTBEAT_MS,
      Math.max(MIN_HEARTBEAT_MS, Math.round(heartbeatSeconds * 1000)),
    );
  }

  onModuleInit(): void {
    this.unsubscribeBus = this.eventBus.onMessage((event) => this.deliver(event));

    this.heartbeatTimer = setInterval(() => this.heartbeatAll(), this.heartbeatIntervalMs);
    // Do not keep the process alive only for heartbeats.
    this.heartbeatTimer.unref();
  }

  onModuleDestroy(): void {
    this.unsubscribeBus?.();

    if (this.heartbeatTimer !== undefined) {
      clearInterval(this.heartbeatTimer);
    }

    for (const sessions of this.sessions.values()) {
      for (const session of sessions) {
        session.close();
      }
    }

    this.sessions.clear();
  }

  /** Writes the SSE headers, replays missed events, then streams live events. */
  async openStream(
    principal: SubscriberPrincipal,
    request: RequestWithSubscriber,
    response: Response,
    lastEventId: string | undefined,
  ): Promise<void> {
    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();
    response.write(SSE_RETRY_HINT);

    const session = new SseSession(principal.tenantId, principal.recipientId, response);
    this.register(session);
    this.metrics.sseConnectionsActive.inc();

    let cleanedUp = false;
    const cleanup = (): void => {
      if (cleanedUp) {
        return;
      }

      cleanedUp = true;
      this.unregister(session);
      this.metrics.sseConnectionsActive.dec();
      session.close();
    };

    request.on('close', cleanup);
    response.on('close', cleanup);
    response.on('error', cleanup);

    try {
      const missed = await this.eventBus.replay(
        principal.tenantId,
        principal.recipientId,
        lastEventId,
      );

      for (const event of missed) {
        session.writeEvent(event.id, JSON.stringify(event.content));
      }

      session.finishReplay();

      this.logger.info(
        {
          event: 'sse.connected',
          requestId: RequestContext.getRequestId(),
          tenant_id: principal.tenantId,
          recipient_id: principal.recipientId,
          replayed: missed.length,
          heartbeat_ms: this.heartbeatIntervalMs,
        },
        'in-app SSE connection established',
      );
    } catch (error) {
      // Continue with live delivery only; the client can retry the replay by reconnecting.
      session.finishReplay();

      this.logger.error(
        {
          event: 'sse.replay_failed',
          requestId: RequestContext.getRequestId(),
          tenant_id: principal.tenantId,
          recipient_id: principal.recipientId,
          err: error instanceof Error ? error.message : String(error),
        },
        'failed to replay missed in-app events, continuing with live delivery',
      );
    }
  }

  private deliver(event: InAppLiveEvent): void {
    const sessions = this.sessions.get(this.keyFor(event.tenantId, event.recipientId));

    if (sessions === undefined) {
      return;
    }

    const data = JSON.stringify(event.content);

    for (const session of sessions) {
      session.writeEvent(event.id, data);
    }
  }

  private heartbeatAll(): void {
    for (const sessions of this.sessions.values()) {
      for (const session of sessions) {
        session.writeHeartbeat();
      }
    }
  }

  private register(session: SseSession): void {
    const key = this.keyFor(session.tenantId, session.recipientId);
    const existing = this.sessions.get(key);

    if (existing !== undefined) {
      existing.add(session);
      return;
    }

    this.sessions.set(key, new Set([session]));
  }

  private unregister(session: SseSession): void {
    const key = this.keyFor(session.tenantId, session.recipientId);
    const sessions = this.sessions.get(key);

    if (sessions === undefined) {
      return;
    }

    sessions.delete(session);

    if (sessions.size === 0) {
      this.sessions.delete(key);
    }
  }

  private keyFor(tenantId: string, recipientId: string): string {
    return `${tenantId}:${recipientId}`;
  }
}
