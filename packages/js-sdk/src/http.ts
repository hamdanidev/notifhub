import {
  isAbortError,
  NotifHubError,
  toNotifHubError,
  type NotifHubErrorCode,
} from './errors';
import type { NotifHubLogEvent, RetryOptions } from './types';

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 5000,
};

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface HttpRequestOptions {
  signal?: AbortSignal;
  body?: unknown;
  /** Set to false for unauthenticated calls (admin login). Defaults to true. */
  auth?: boolean;
  /** Set to false for non-idempotent mutations that must not be retried. Defaults to true. */
  retry?: boolean;
}

/**
 * Small fetch wrapper: token injection per request, JSON handling, typed errors and
 * exponential-backoff retries for 5xx / 429 / network failures.
 */
export class HttpTransport {
  constructor(
    private readonly baseUrl: string,
    private readonly getToken: () => string | Promise<string>,
    private readonly fetchImpl: typeof fetch,
    private readonly retryOptions: RetryOptions,
    private readonly logger?: (event: NotifHubLogEvent) => void,
  ) {}

  async request<T>(
    method: HttpMethod,
    path: string,
    options: HttpRequestOptions = {},
  ): Promise<T> {
    let attempt = 0;

    for (;;) {
      attempt += 1;

      try {
        return await this.execute<T>(method, path, options);
      } catch (error) {
        const normalized = toNotifHubError(error);

        if (
          options.retry === false ||
          !normalized.retryable ||
          attempt >= this.retryOptions.maxAttempts
        ) {
          throw normalized;
        }

        const delayMs = computeDelay(attempt, this.retryOptions, normalized.retryAfterMs);

        this.logger?.({
          event: 'http.retry',
          method,
          path,
          attempt,
          delay_ms: delayMs,
          code: normalized.code,
        });

        await sleep(delayMs, options.signal);
      }
    }
  }

  private async execute<T>(
    method: HttpMethod,
    path: string,
    options: HttpRequestOptions,
  ): Promise<T> {
    const token = options.auth === false ? undefined : await this.getToken();
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    if (token !== undefined) {
      headers.Authorization = `Bearer ${token}`;
    }

    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    let response: Response;

    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: options.signal,
      });
    } catch (error) {
      throw toNetworkError(error);
    }

    if (!response.ok) {
      throw await toHttpError(response);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    try {
      return (await response.json()) as T;
    } catch (error) {
      throw new NotifHubError('invalid_response', 'Invalid JSON response from NotifHub', {
        status: response.status,
        retryable: false,
        cause: error,
      });
    }
  }
}

export function computeDelay(
  attempt: number,
  options: RetryOptions,
  retryAfterMs?: number,
): number {
  if (retryAfterMs !== undefined) {
    return Math.min(options.maxDelayMs, Math.max(0, retryAfterMs));
  }

  const exponential = options.baseDelayMs * 2 ** Math.max(0, attempt - 1);
  const jitter = 1 + Math.random() * 0.25;

  return Math.min(options.maxDelayMs, Math.round(exponential * jitter));
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new NotifHubError('aborted', 'Operation aborted'));
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;

    const onAbort = (): void => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      reject(new NotifHubError('aborted', 'Operation aborted'));
    };

    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function toHttpError(response: Response): Promise<NotifHubError> {
  const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
  let message = `Request failed with status ${response.status}`;
  let requestId: string | null = null;

  try {
    const text = await response.text();

    if (text.length > 0) {
      const parsed: unknown = JSON.parse(text);

      if (isRecord(parsed)) {
        const rawMessage = parsed.message;

        if (typeof rawMessage === 'string') {
          message = rawMessage;
        } else if (Array.isArray(rawMessage)) {
          const parts = rawMessage.filter((part): part is string => typeof part === 'string');
          if (parts.length > 0) {
            message = parts.join('; ');
          }
        }

        if (typeof parsed.requestId === 'string') {
          requestId = parsed.requestId;
        }
      }
    }
  } catch {
    // Keep the default message when the body is not JSON.
  }

  return new NotifHubError(mapStatus(response.status), message, {
    status: response.status,
    requestId,
    retryable: response.status === 429 || response.status >= 500,
    retryAfterMs,
  });
}

function mapStatus(status: number): NotifHubErrorCode {
  if (status === 400 || status === 422) {
    return 'bad_request';
  }
  if (status === 401) {
    return 'unauthorized';
  }
  if (status === 403) {
    return 'forbidden';
  }
  if (status === 404) {
    return 'not_found';
  }
  if (status === 429) {
    return 'rate_limited';
  }
  if (status >= 500) {
    return 'server_error';
  }

  return 'invalid_response';
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) {
    return undefined;
  }

  const seconds = Number(value);

  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }

  const timestamp = Date.parse(value);

  if (!Number.isNaN(timestamp)) {
    const delta = timestamp - Date.now();
    return delta > 0 ? delta : 0;
  }

  return undefined;
}

function toNetworkError(error: unknown): NotifHubError {
  if (isAbortError(error)) {
    return new NotifHubError('aborted', 'Request aborted');
  }

  return new NotifHubError('network_error', error instanceof Error ? error.message : String(error), {
    retryable: true,
    cause: error,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
