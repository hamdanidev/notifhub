export interface WhatsAppTextMessageRequest {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'text';
  text: { preview_url: boolean; body: string };
}

export interface WhatsAppSendResponse {
  messaging_product?: string;
  messages?: Array<{ id?: string }>;
  error?: {
    message?: string;
    type?: string;
    code?: number;
  };
}

export class WhatsAppApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'WhatsAppApiError';
  }
}

const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

/**
 * Normalizes a phone number for the WhatsApp Cloud API: strips spaces, dashes and
 * parentheses and requires an E.164 value starting with `+` (8-15 digits).
 * Returns null when the value cannot be normalized.
 */
export function normalizeWhatsAppNumber(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') {
    return null;
  }

  const cleaned = raw.replace(/[\s\-()]/g, '');

  return E164_PATTERN.test(cleaned) ? cleaned : null;
}

export function looksLikePhoneNumber(raw: string | null | undefined): raw is string {
  return normalizeWhatsAppNumber(raw) !== null;
}
