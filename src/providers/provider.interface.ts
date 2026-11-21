import { Channel } from '@prisma/client';

/** Input passed to every provider implementation. */
export interface ProviderSendInput {
  notificationId: string;
  recipientId: string;
  tenantId: string;
  priority: number;
  templateKey: string;
  subject: string | null;
  body: string;
  /** Sanitized HTML body for in-app markdown; ignored by other channels. */
  bodyHtml?: string | null;
  /** Source format of the template; in-app consumes text/markdown. */
  format?: 'text' | 'html' | 'markdown';
  /** Optional plain-text alternative for email; ignored by text-only providers. */
  text?: string | null;
  data: Record<string, unknown>;
  /** Resolved destination (email/phone). In-app providers ignore it. */
  to: string;
}

export interface ProviderSendResult {
  providerMessageId: string | null;
}

export interface NotificationProvider {
  readonly name: string;
  readonly channel: Channel;
  send(input: ProviderSendInput): Promise<ProviderSendResult>;
}

/** Raised when a circuit breaker is open; retryable by BullMQ. */
export class ProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}

/** Raised when a provider is used without its required configuration. */
export class ProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderConfigurationError';
  }
}
