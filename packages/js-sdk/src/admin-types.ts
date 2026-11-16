export type Channel = 'inapp' | 'email' | 'whatsapp' | 'sms';
export type OverallStatus = 'pending' | 'partial' | 'sent' | 'failed';

export interface AdminProfile {
  id: string;
  email: string;
  role: string;
  tenantId: string;
}

export interface AdminLoginResult {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  admin: AdminProfile;
}

export interface Paged<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface ListQuery {
  limit?: number;
  offset?: number;
  search?: string;
}

export interface ApiKeySummary {
  id: string;
  name: string;
  tenantId: string;
  active: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface CreatedApiKey extends ApiKeySummary {
  key: string;
  keyPreview: string;
}

export interface ApiKeyInput {
  name: string;
  allowedOrigins?: string[];
  subscriberJwtSecret?: string;
}

export interface Template {
  id: string;
  tenantId: string;
  key: string;
  channel: Channel;
  locale: string;
  subject: string | null;
  body: string;
  version: number;
  active: boolean;
  fallbackProvider: string | null;
  fallbackChannel: Channel | null;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateQuery extends ListQuery {
  channel?: Channel;
  locale?: string;
  active?: boolean;
}

export interface CreateTemplateInput {
  key: string;
  channel: Channel;
  locale: string;
  subject?: string;
  body: string;
  version?: number;
  active?: boolean;
  fallbackProvider?: string;
  fallbackChannel?: Channel;
}

export interface UpdateTemplateInput {
  subject?: string;
  body?: string;
  active?: boolean;
  fallbackProvider?: string;
  fallbackChannel?: Channel;
}

export interface Subscriber {
  id: string;
  tenantId: string;
  externalId: string;
  email: string | null;
  phone: string | null;
  locale: string | null;
  timezone: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface Preference {
  id: string;
  recipientId: string;
  channel: Channel;
  enabled: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  timezone: string;
  updatedAt: string;
}

export interface PreferenceInput {
  enabled: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  timezone?: string;
}

export interface TopicSummary {
  key: string;
  isTimeBound: boolean;
  mode: string;
  displayName: string | null;
  createdAt: string;
  memberCount: number;
}

export interface TopicDetail extends TopicSummary {
  expiredCount: number;
  updatedAt: string;
}

export interface TopicMember {
  recipientId: string;
  addedAt: string;
  expiresAt: string | null;
}

export interface TopicMembers {
  topic: { key: string; isTimeBound: boolean; mode: string };
  members: TopicMember[];
  expiredCount: number;
}

export interface TopicMembersInput {
  members: Array<{ recipientId: string; expiresAt?: string }>;
  expiresAt?: string;
  isTimeBound?: boolean;
}

export interface TopicMutation {
  topic: { key: string; isTimeBound: boolean; mode: string };
  memberCount: number;
  removed?: number;
  added?: number;
  updated?: number;
}

export interface NotificationSummary {
  id: string;
  tenantId: string;
  templateKey: string;
  priority: number;
  overallStatus: OverallStatus;
  targetType: string;
  createdAt: string;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  pendingCount: number;
  skippedCount: number;
}

export interface NotificationDetail {
  notification: Record<string, unknown>;
  recipients: Record<string, unknown>[];
  deliveryAttempts: Record<string, unknown>[];
  deliveryEvents: Record<string, unknown>[];
}

export interface NotificationQuery extends ListQuery {
  status?: OverallStatus;
  templateKey?: string;
  from?: string;
  to?: string;
}

export interface NotifHubAdminClientOptions {
  baseUrl: string;
  getToken: () => string | undefined | Promise<string | undefined>;
  fetch?: typeof fetch;
  retry?: Partial<import('./types').RetryOptions>;
  logger?: (event: import('./types').NotifHubLogEvent) => void;
}
