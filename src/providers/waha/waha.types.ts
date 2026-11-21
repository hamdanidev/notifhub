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

/**
 * Accepts both id shapes WAHA engines use: a plain string (`3EB0...` or `true_<jid>_<id>`)
 * and the object form returned by browser engines such as WEBJS
 * (`{ id: "3EB0...", _serialized: "true_<jid>_<id>" }`).
 */
function extractWahaIdValue(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) {
    return normalizeWahaMessageId(value);
  }

  if (isRecord(value)) {
    if (typeof value._serialized === 'string' && value._serialized.length > 0) {
      return normalizeWahaMessageId(value._serialized);
    }

    if (typeof value.id === 'string' && value.id.length > 0) {
      return normalizeWahaMessageId(value.id);
    }
  }

  return null;
}

/** Accepts `key.id` (NOWEB), top-level `id`, and the engine-specific `_data.id` fallback. */
export function extractWahaMessageId(payload: WahaSendTextResponse | null): string | null {
  if (payload === null) {
    return null;
  }

  if (isRecord(payload.key)) {
    const fromKey = extractWahaIdValue(payload.key.id);

    if (fromKey !== null) {
      return fromKey;
    }
  }

  const direct = extractWahaIdValue(payload.id);

  if (direct !== null) {
    return direct;
  }

  if (isRecord(payload._data)) {
    const fromData = extractWahaIdValue(payload._data.id);

    if (fromData !== null) {
      return fromData;
    }
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
