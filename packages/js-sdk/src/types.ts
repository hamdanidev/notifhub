import type { NotifHubError } from './errors';

/** A rendered in-app notification delivered over SSE or returned by the catch-up API. */
export interface InAppNotification {
  notificationId: string;
  templateKey: string;
  subject: string | null;
  body: string | null;
  /** Sanitized HTML for markdown templates; absent/null for plain-text templates. */
  bodyHtml?: string | null;
  /** Template body format; `markdown` means `bodyHtml` is the rendered version. */
  format?: 'text' | 'markdown';
  data: Record<string, unknown>;
  priority: number;
  status?: string;
  createdAt: string;
  readAt?: string | null;
}

export interface NotificationPage {
  items: InAppNotification[];
  nextCursor: string | null;
}

export interface ReadReceipt {
  notificationId: string;
  readAt: string;
}

/** Channels offered by the end-user preference center (sms has no provider yet). */
export type PreferenceChannel = 'inapp' | 'email' | 'whatsapp';

/** One channel preference. `isDefault` is true when no row is stored for that channel. */
export interface ChannelPreference {
  channel: PreferenceChannel;
  enabled: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  timezone: string;
  isDefault: boolean;
  updatedAt: string | null;
}

/** Result of `getPreferences()`: profile context plus the three channels. */
export interface SubscriberPreferences {
  recipientId: string;
  locale: string | null;
  timezone: string;
  channels: ChannelPreference[];
}

/** Body of `updatePreference()`. Quiet hours must be sent together or omitted. */
export interface UpdatePreferenceInput {
  enabled: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  timezone?: string;
}

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface NotifHubLogEvent {
  event: string;
  [key: string]: unknown;
}

export interface NotificationHandlers {
  onNotification: (notification: InAppNotification) => void;
  onOpen?: () => void;
  onError?: (error: NotifHubError) => void;
}

export interface SubscribeOptions {
  signal?: AbortSignal;
  lastEventId?: string;
}

export interface GetNotificationsParams {
  limit?: number;
  cursor?: string;
  signal?: AbortSignal;
}

export interface NotifHubClientOptions {
  baseUrl: string;
  getToken: () => string | Promise<string>;
  fetch?: typeof fetch;
  retry?: Partial<RetryOptions>;
  logger?: (event: NotifHubLogEvent) => void;
}

export interface Subscription {
  close(): void;
  readonly closed: boolean;
}
