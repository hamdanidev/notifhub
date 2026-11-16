export type NotifHubErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'bad_request'
  | 'rate_limited'
  | 'server_error'
  | 'network_error'
  | 'aborted'
  | 'invalid_response';

export interface NotifHubErrorOptions {
  status?: number;
  requestId?: string | null;
  retryable?: boolean;
  retryAfterMs?: number;
  cause?: unknown;
}

/** Typed error surfaced by every SDK operation. */
export class NotifHubError extends Error {
  readonly code: NotifHubErrorCode;
  readonly status: number | undefined;
  readonly requestId: string | null;
  readonly retryable: boolean;
  readonly retryAfterMs: number | undefined;

  constructor(code: NotifHubErrorCode, message: string, options: NotifHubErrorOptions = {}) {
    super(message);
    this.name = 'NotifHubError';
    this.code = code;
    this.status = options.status;
    this.requestId = options.requestId ?? null;
    this.retryable = options.retryable ?? false;
    this.retryAfterMs = options.retryAfterMs;

    if (options.cause !== undefined) {
      Object.defineProperty(this, 'cause', {
        value: options.cause,
        enumerable: false,
        configurable: true,
        writable: true,
      });
    }
  }
}

export function isNotifHubError(value: unknown): value is NotifHubError {
  return value instanceof NotifHubError;
}

export function isAbortError(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    (value as { name?: unknown }).name === 'AbortError'
  );
}

export function toNotifHubError(
  error: unknown,
  fallback: NotifHubErrorCode = 'network_error',
): NotifHubError {
  if (error instanceof NotifHubError) {
    return error;
  }

  if (isAbortError(error)) {
    return new NotifHubError('aborted', 'Operation aborted');
  }

  if (error instanceof Error) {
    return new NotifHubError(fallback, error.message, { cause: error });
  }

  return new NotifHubError(fallback, String(error));
}
