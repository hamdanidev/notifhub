import type { SampleSession } from './session';

export type TestChannel = 'inapp' | 'email' | 'whatsapp';

export interface SessionInput {
  recipientId: string;
  tenant: string;
}

export interface NotifyInput {
  recipientId: string;
  channel: TestChannel;
  name: string;
}

export interface NotifyResult {
  notification_id: string;
  status: 'accepted';
}

type DevApiErrorKind = 'http' | 'network' | 'invalid_response' | 'aborted';

interface DevApiErrorOptions {
  status?: number;
  requestId?: string | null;
  kind?: DevApiErrorKind;
  cause?: unknown;
}

export class DevApiError extends Error {
  readonly status: number | undefined;
  readonly requestId: string | null;
  readonly kind: DevApiErrorKind;

  constructor(message: string, options: DevApiErrorOptions = {}) {
    super(message);
    this.name = 'DevApiError';
    this.status = options.status;
    this.requestId = options.requestId ?? null;
    this.kind = options.kind ?? 'http';

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function requestJson(path: string, body: unknown): Promise<unknown> {
  let response: Response;

  try {
    response = await fetch(path, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (cause: unknown) {
    throw new DevApiError('Tidak dapat menghubungi dev server sample.', {
      kind: 'network',
      cause,
    });
  }

  const text = await response.text();
  let payload: unknown;

  try {
    payload = text.trim().length === 0 ? undefined : JSON.parse(text);
  } catch {
    payload = undefined;
  }

  if (!response.ok) {
    const errorPayload = isRecord(payload) && isRecord(payload.error) ? payload.error : undefined;
    const message =
      errorPayload !== undefined && typeof errorPayload.message === 'string'
        ? errorPayload.message
        : `Dev server menolak request dengan status ${response.status}.`;

    throw new DevApiError(message, {
      status: response.status,
      requestId:
        errorPayload !== undefined && typeof errorPayload.requestId === 'string'
          ? errorPayload.requestId
          : null,
    });
  }

  if (payload === undefined) {
    throw new DevApiError('Dev server mengembalikan respons kosong.', {
      status: response.status,
      kind: 'invalid_response',
    });
  }

  return payload;
}

function isSampleSession(value: unknown): value is SampleSession {
  return (
    isRecord(value) &&
    typeof value.token === 'string' &&
    value.token.length > 0 &&
    value.tokenType === 'Bearer' &&
    typeof value.recipientId === 'string' &&
    value.recipientId.length > 0 &&
    typeof value.tenant === 'string' &&
    value.tenant.length > 0 &&
    typeof value.expiresAt === 'string' &&
    !Number.isNaN(Date.parse(value.expiresAt))
  );
}

function isNotifyResult(value: unknown): value is NotifyResult {
  return (
    isRecord(value) &&
    typeof value.notification_id === 'string' &&
    value.notification_id.length > 0 &&
    value.status === 'accepted'
  );
}

export async function createSession(input: SessionInput): Promise<SampleSession> {
  const payload = await requestJson('/dev/session', input);

  if (!isSampleSession(payload)) {
    throw new DevApiError('Respons /dev/session tidak dikenali.', { kind: 'invalid_response' });
  }

  return payload;
}

export async function sendTestNotification(input: NotifyInput): Promise<NotifyResult> {
  const payload = await requestJson('/dev/notify', input);

  if (!isNotifyResult(payload)) {
    throw new DevApiError('Respons /dev/notify tidak dikenali.', { kind: 'invalid_response' });
  }

  return payload;
}
