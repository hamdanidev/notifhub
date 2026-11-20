export interface WahaSendTextRequest {
  session: string;
  chatId: string;
  text: string;
  linkPreview: boolean;
}

export interface WahaSendTextResponse {
  id?: unknown;
  /** NOWEB returns the message key as `key.id`. */
  key?: unknown;
  /** Some engines put the message object under `_data`; kept as a defensive fallback. */
  _data?: unknown;
  message?: unknown;
}

export class WahaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'WahaApiError';
  }
}

/**
 * WAHA expects `chatId` as an international number without the leading `+`, suffixed with
 * `@c.us` (for example `628123456789@c.us`).
 */
export function toWahaChatId(phoneE164: string): string {
  return `${phoneE164.slice(1)}@c.us`;
}

/** Accepts `key.id` (NOWEB), top-level `id`, and the engine-specific `_data.id` fallback. */
export function extractWahaMessageId(payload: WahaSendTextResponse | null): string | null {
  if (payload === null) {
    return null;
  }

  if (isRecord(payload.key) && typeof payload.key.id === 'string' && payload.key.id.length > 0) {
    return normalizeWahaMessageId(payload.key.id);
  }

  if (typeof payload.id === 'string' && payload.id.length > 0) {
    return normalizeWahaMessageId(payload.id);
  }

  if (
    isRecord(payload._data) &&
    typeof payload._data.id === 'string' &&
    payload._data.id.length > 0
  ) {
    return normalizeWahaMessageId(payload._data.id);
  }

  return null;
}

/**
 * WAHA message ids are inconsistent across engines: a send can return the bare message id
 * (`3EB0...`) while `message.ack` uses `true_<chatId>_<messageId>` (or `true__<messageId>`).
 * Store and compare the bare id so the webhook can find the recipient.
 */
export function normalizeWahaMessageId(value: string): string {
  if (!/^(?:true|false)_/.test(value)) {
    return value;
  }

  const firstSeparator = value.indexOf('_');
  const secondSeparator = value.indexOf('_', firstSeparator + 1);

  return secondSeparator === -1 ? value : value.slice(secondSeparator + 1);
}

/** Extracts a short, log-safe error message from a WAHA error payload. */
export function extractWahaErrorMessage(payload: WahaSendTextResponse | null): string | null {
  if (payload === null) {
    return null;
  }

  return typeof payload.message === 'string' && payload.message.length > 0
    ? payload.message.slice(0, 300)
    : null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
