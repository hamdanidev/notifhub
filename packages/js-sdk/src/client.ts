import { DEFAULT_RETRY_OPTIONS, HttpTransport } from './http';
import { SseConnection } from './sse';
import type {
  ChannelPreference,
  GetNotificationsParams,
  InAppNotification,
  NotifHubClientOptions,
  NotificationHandlers,
  NotificationPage,
  NotifHubLogEvent,
  PreferenceChannel,
  ReadReceipt,
  RetryOptions,
  SubscriberPreferences,
  SubscribeOptions,
  Subscription,
  UpdatePreferenceInput,
} from './types';

/**
 * Headless NotifHub client for browser and Node applications.
 *
 * All HTTP and SSE traffic goes through this client: token injection, retries, reconnect
 * and typed errors are handled here, never by consumers.
 */
export class NotifHubClient {
  private readonly baseUrl: string;
  private readonly getToken: () => string | Promise<string>;
  private readonly fetchImpl: typeof fetch;
  private readonly retryOptions: RetryOptions;
  private readonly logger: ((event: NotifHubLogEvent) => void) | undefined;
  private readonly transport: HttpTransport;
  private readonly lifecycle = new AbortController();
  private readonly subscriptions = new Set<SseConnection>();

  constructor(options: NotifHubClientOptions) {
    if (typeof options.baseUrl !== 'string' || options.baseUrl.length === 0) {
      throw new TypeError('NotifHubClient: baseUrl is required');
    }

    if (typeof options.getToken !== 'function') {
      throw new TypeError('NotifHubClient: getToken is required');
    }

    const fetchImpl = options.fetch ?? globalThis.fetch;

    if (typeof fetchImpl !== 'function') {
      throw new TypeError('NotifHubClient: fetch is not available; provide options.fetch');
    }

    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.getToken = options.getToken;
    this.fetchImpl = fetchImpl.bind(globalThis);
    this.retryOptions = { ...DEFAULT_RETRY_OPTIONS, ...options.retry };
    this.logger = options.logger;
    this.transport = new HttpTransport(
      this.baseUrl,
      this.getToken,
      this.fetchImpl,
      this.retryOptions,
      this.logger,
    );
  }

  getNotifications(params: GetNotificationsParams = {}): Promise<NotificationPage> {
    const query = new URLSearchParams();

    if (params.limit !== undefined) {
      query.set('limit', String(params.limit));
    }

    if (params.cursor !== undefined) {
      query.set('cursor', params.cursor);
    }

    const search = query.toString();
    const suffix = search.length > 0 ? `?${search}` : '';

    return this.transport.request<NotificationPage>(
      'GET',
      `/api/v1/in-app/notifications${suffix}`,
      { signal: params.signal },
    );
  }

  markRead(notificationId: string, options: { signal?: AbortSignal } = {}): Promise<ReadReceipt> {
    return this.transport.request<ReadReceipt>(
      'POST',
      `/api/v1/in-app/notifications/${encodeURIComponent(notificationId)}/read`,
      { signal: options.signal },
    );
  }

  /**
   * Reads the end-user preference center snapshot. All three channels are always returned; a
   * channel without a stored row comes back with the effective defaults (`isDefault: true`).
   */
  getPreferences(options: { signal?: AbortSignal } = {}): Promise<SubscriberPreferences> {
    return this.transport.request<SubscriberPreferences>(
      'GET',
      '/api/v1/subscriber/preferences',
      { signal: options.signal },
    );
  }

  /**
   * Replaces the preference of one channel (full snapshot for that channel). Omitted fields are
   * cleared, matching the backend `PUT` semantics.
   */
  updatePreference(
    channel: PreferenceChannel,
    input: UpdatePreferenceInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<ChannelPreference> {
    return this.transport.request<ChannelPreference>(
      'PUT',
      `/api/v1/subscriber/preferences/${encodeURIComponent(channel)}`,
      { body: input, signal: options.signal },
    );
  }

  subscribe(handlers: NotificationHandlers, options: SubscribeOptions = {}): Subscription {
    const signal = combineSignals(
      [this.lifecycle.signal, options.signal].filter(
        (candidate): candidate is AbortSignal => candidate !== undefined,
      ),
    );

    const connection = new SseConnection({
      url: `${this.baseUrl}/api/v1/in-app/stream`,
      getToken: this.getToken,
      fetchImpl: this.fetchImpl,
      retry: this.retryOptions,
      signal,
      lastEventId: options.lastEventId,
      onNotification: (notification: InAppNotification) =>
        handlers.onNotification(notification),
      onOpen: handlers.onOpen,
      onError: handlers.onError,
      logger: this.logger,
    });

    this.subscriptions.add(connection);
    connection.start();

    return {
      close: (): void => {
        connection.close();
        this.subscriptions.delete(connection);
      },
      get closed(): boolean {
        return connection.isClosed;
      },
    };
  }

  /** Closes every subscription created by this client. The instance is reusable afterwards. */
  close(): void {
    this.lifecycle.abort();

    for (const subscription of this.subscriptions) {
      subscription.close();
    }

    this.subscriptions.clear();
  }
}

function combineSignals(signals: AbortSignal[]): AbortSignal | undefined {
  const [first, ...rest] = signals;

  if (first === undefined) {
    return undefined;
  }

  if (rest.length === 0) {
    return first;
  }

  const controller = new AbortController();
  const abort = (): void => controller.abort();

  for (const signal of [first, ...rest]) {
    if (signal.aborted) {
      controller.abort();
      return controller.signal;
    }

    signal.addEventListener('abort', abort, { once: true });
  }

  return controller.signal;
}
