import { NotifHubError, toNotifHubError } from './errors';
import { sleep } from './http';
import { streamEvents, type SseMessage } from './sse-transport';
import type { InAppNotification, NotifHubLogEvent, RetryOptions } from './types';

const MAX_TRACKED_IDS = 500;

export interface SseConnectionOptions {
  url: string;
  getToken: () => string | Promise<string>;
  fetchImpl: typeof fetch;
  retry: RetryOptions;
  signal?: AbortSignal;
  lastEventId?: string;
  onOpen?: () => void;
  onNotification: (notification: InAppNotification) => void;
  onError?: (error: NotifHubError) => void;
  logger?: (event: NotifHubLogEvent) => void;
}

/**
 * Fetch-based SSE connection (never EventSource) with:
 * - Authorization header token injection,
 * - Last-Event-ID resume after reconnect,
 * - exponential backoff with jitter,
 * - bounded dedupe of replayed events,
 * - AbortSignal cancellation.
 */
export class SseConnection {
  private closed = false;
  private attempt = 0;
  private lastEventId: string | undefined;
  private activeController: AbortController | undefined;
  private readonly seenEventIds = new Set<string>();
  private readonly seenNotificationIds = new Set<string>();

  constructor(private readonly options: SseConnectionOptions) {
    this.lastEventId = options.lastEventId;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  start(): void {
    void this.connectLoop();
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.activeController?.abort();
  }

  private async connectLoop(): Promise<void> {
    while (!this.closed) {
      const attemptController = new AbortController();
      this.activeController = attemptController;

      const abortForwarder = (): void => attemptController.abort();
      const externalSignal = this.options.signal;

      if (externalSignal?.aborted === true) {
        this.close();
        return;
      }

      externalSignal?.addEventListener('abort', abortForwarder, { once: true });

      try {
        await this.runOnce(attemptController);

        if (this.closed || attemptController.signal.aborted) {
          return;
        }

        // The server closed the stream without an error: reconnect with backoff.
        this.attempt += 1;
        const delayMs = computeBackoffDelay(this.attempt, this.options.retry);

        this.options.logger?.({
          event: 'sse.reconnect',
          reason: 'stream_closed',
          attempt: this.attempt,
          delay_ms: delayMs,
          last_event_id: this.lastEventId ?? null,
        });

        await sleep(delayMs, externalSignal);
      } catch (error) {
        if (this.closed) {
          return;
        }

        const normalized = toNotifHubError(error);

        if (normalized.code === 'aborted' || attemptController.signal.aborted) {
          return;
        }

        this.options.onError?.(normalized);

        if (isFatal(normalized)) {
          this.close();
          return;
        }

        this.attempt += 1;
        const delayMs = computeBackoffDelay(this.attempt, this.options.retry);

        this.options.logger?.({
          event: 'sse.reconnect',
          reason: normalized.code,
          attempt: this.attempt,
          delay_ms: delayMs,
          last_event_id: this.lastEventId ?? null,
        });

        await sleep(delayMs, externalSignal);
      } finally {
        externalSignal?.removeEventListener('abort', abortForwarder);
      }
    }
  }

  private async runOnce(controller: AbortController): Promise<void> {
    const token = await this.options.getToken();
    const headers: Record<string, string> = {
      Accept: 'text/event-stream',
      Authorization: `Bearer ${token}`,
    };

    if (this.lastEventId !== undefined) {
      headers['Last-Event-ID'] = this.lastEventId;
    }

    await streamEvents({
      url: this.options.url,
      headers,
      signal: controller.signal,
      fetchImpl: this.options.fetchImpl,
      onOpen: async (response: Response): Promise<void> => {
        if (response.status === 401) {
          throw new NotifHubError('unauthorized', 'Subscriber token rejected', {
            status: 401,
          });
        }

        if (response.status === 403) {
          throw new NotifHubError('forbidden', 'Subscriber token is not allowed', {
            status: 403,
          });
        }

        if (!response.ok) {
          throw new NotifHubError(
            response.status >= 500 ? 'server_error' : 'bad_request',
            `SSE handshake failed with status ${response.status}`,
            { status: response.status, retryable: response.status >= 500 },
          );
        }

        const contentType = response.headers.get('content-type') ?? '';

        if (!contentType.includes('text/event-stream')) {
          throw new NotifHubError('invalid_response', 'Expected a text/event-stream response');
        }

        this.attempt = 0;
        this.options.onOpen?.();
      },
      onMessage: (message: SseMessage): void => {
        this.handleMessage(message);
      },
    });
  }

  private handleMessage(message: SseMessage): void {
    if (message.event !== undefined && message.event !== '' && message.event !== 'notification') {
      return;
    }

    if (message.id !== undefined && message.id.length > 0) {
      if (this.seenEventIds.has(message.id)) {
        return;
      }

      remember(this.seenEventIds, message.id);
      this.lastEventId = message.id;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(message.data);
    } catch {
      this.options.logger?.({ event: 'sse.invalid_event' });
      return;
    }

    if (!isInAppNotification(parsed)) {
      this.options.logger?.({ event: 'sse.invalid_event' });
      return;
    }

    if (this.seenNotificationIds.has(parsed.notificationId)) {
      return;
    }

    remember(this.seenNotificationIds, parsed.notificationId);
    this.options.onNotification(parsed);
  }
}

export function computeBackoffDelay(attempt: number, options: RetryOptions): number {
  const exponential = options.baseDelayMs * 2 ** Math.max(0, attempt - 1);
  const jitter = 1 + Math.random() * 0.25;

  return Math.min(options.maxDelayMs, Math.round(exponential * jitter));
}

function isFatal(error: NotifHubError): boolean {
  return (
    error.code === 'unauthorized' ||
    error.code === 'forbidden' ||
    error.code === 'not_found' ||
    error.code === 'bad_request' ||
    error.code === 'invalid_response'
  );
}

function remember(set: Set<string>, value: string): void {
  if (set.size >= MAX_TRACKED_IDS) {
    const oldest = set.values().next().value as string | undefined;
    if (oldest !== undefined) {
      set.delete(oldest);
    }
  }

  set.add(value);
}

function isInAppNotification(value: unknown): value is InAppNotification {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.notificationId === 'string' &&
    typeof candidate.templateKey === 'string' &&
    typeof candidate.body === 'string' &&
    typeof candidate.priority === 'number' &&
    typeof candidate.createdAt === 'string'
  );
}
