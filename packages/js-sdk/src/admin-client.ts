import type {
  AdminAuditQuery,
  AdminAuditResult,
  AdminLoginResult,
  AdminProfile,
  ApiKeyInput,
  ApiKeySummary,
  ComposeNotificationInput,
  ComposeNotificationResult,
  CreatedApiKey,
  CreateTemplateInput,
  ExportNotificationsQuery,
  ExportNotificationsResult,
  ListQuery,
  NotificationDetail,
  NotificationQuery,
  NotificationSummary,
  NotifHubAdminClientOptions,
  Paged,
  Preference,
  PreferenceInput,
  ResendNotificationInput,
  ResendNotificationResult,
  Subscriber,
  Template,
  TemplateQuery,
  TopicDetail,
  TopicMembers,
  TopicMembersInput,
  TopicMutation,
  TopicSummary,
  UpdateTemplateInput,
  Channel,
} from './admin-types';
import { DEFAULT_RETRY_OPTIONS, HttpTransport } from './http';
import type { RetryOptions } from './types';

const ADMIN_PREFIX = '/api/v1/admin';

/**
 * Client for the tenant Admin API.
 *
 * Uses the same HTTP transport as the in-app SDK: token injection, retries for safe calls,
 * typed errors and cancellation. Console applications must use this client instead of calling
 * the Admin API directly.
 */
export class NotifHubAdminClient {
  private readonly transport: HttpTransport;

  constructor(options: NotifHubAdminClientOptions) {
    if (typeof options.baseUrl !== 'string' || options.baseUrl.length === 0) {
      throw new TypeError('NotifHubAdminClient: baseUrl is required');
    }

    if (typeof options.getToken !== 'function') {
      throw new TypeError('NotifHubAdminClient: getToken is required');
    }

    const fetchImpl = options.fetch ?? globalThis.fetch;

    if (typeof fetchImpl !== 'function') {
      throw new TypeError('NotifHubAdminClient: fetch is not available; provide options.fetch');
    }

    const baseUrl = options.baseUrl.replace(/\/+$/, '');
    const retry: RetryOptions = { ...DEFAULT_RETRY_OPTIONS, ...options.retry };

    this.transport = new HttpTransport(
      `${baseUrl}${ADMIN_PREFIX}`,
      async () => (await options.getToken()) ?? '',
      fetchImpl.bind(globalThis),
      retry,
      options.logger,
    );
  }

  login(email: string, password: string): Promise<AdminLoginResult> {
    return this.transport.request<AdminLoginResult>('POST', '/auth/login', {
      auth: false,
      retry: false,
      body: { email, password },
    });
  }

  me(): Promise<AdminProfile> {
    return this.transport.request<AdminProfile>('GET', '/auth/me');
  }

  changePassword(currentPassword: string, newPassword: string): Promise<void> {
    return this.transport.request<void>('POST', '/auth/change-password', {
      retry: false,
      body: { currentPassword, newPassword },
    });
  }

  listApiKeys(): Promise<ApiKeySummary[]> {
    return this.transport.request<ApiKeySummary[]>('GET', '/api-keys');
  }

  createApiKey(input: ApiKeyInput): Promise<CreatedApiKey> {
    return this.transport.request<CreatedApiKey>('POST', '/api-keys', {
      retry: false,
      body: input,
    });
  }

  revokeApiKey(id: string): Promise<{ id: string; active: false }> {
    return this.transport.request<{ id: string; active: false }>(
      'POST',
      `/api-keys/${encodeURIComponent(id)}/revoke`,
    );
  }

  listTemplates(query: TemplateQuery = {}): Promise<Paged<Template>> {
    return this.transport.request<Paged<Template>>(
      'GET',
      `/templates${queryString({
        limit: query.limit,
        offset: query.offset,
        search: query.search,
        channel: query.channel,
        locale: query.locale,
        active: query.active,
      })}`,
    );
  }

  getTemplate(id: string): Promise<Template> {
    return this.transport.request<Template>('GET', `/templates/${encodeURIComponent(id)}`);
  }

  createTemplate(input: CreateTemplateInput): Promise<Template> {
    return this.transport.request<Template>('POST', '/templates', {
      retry: false,
      body: input,
    });
  }

  updateTemplate(id: string, input: UpdateTemplateInput): Promise<Template> {
    return this.transport.request<Template>('PUT', `/templates/${encodeURIComponent(id)}`, {
      body: input,
    });
  }

  deactivateTemplate(id: string): Promise<Template> {
    return this.transport.request<Template>('DELETE', `/templates/${encodeURIComponent(id)}`);
  }

  listSubscribers(query: ListQuery = {}): Promise<Paged<Subscriber>> {
    return this.transport.request<Paged<Subscriber>>(
      'GET',
      `/subscribers${queryString({
        limit: query.limit,
        offset: query.offset,
        search: query.search,
      })}`,
    );
  }

  getSubscriber(externalId: string): Promise<Subscriber> {
    return this.transport.request<Subscriber>(
      'GET',
      `/subscribers/${encodeURIComponent(externalId)}`,
    );
  }

  listPreferences(externalId: string): Promise<Preference[]> {
    return this.transport.request<Preference[]>(
      'GET',
      `/subscribers/${encodeURIComponent(externalId)}/preferences`,
    );
  }

  upsertPreference(
    externalId: string,
    channel: Channel,
    input: PreferenceInput,
  ): Promise<Preference> {
    return this.transport.request<Preference>(
      'PUT',
      `/subscribers/${encodeURIComponent(externalId)}/preferences/${channel}`,
      { body: input },
    );
  }

  listTopics(query: ListQuery = {}): Promise<Paged<TopicSummary>> {
    return this.transport.request<Paged<TopicSummary>>(
      'GET',
      `/topics${queryString({ limit: query.limit, offset: query.offset, search: query.search })}`,
    );
  }

  getTopic(key: string): Promise<TopicDetail> {
    return this.transport.request<TopicDetail>('GET', `/topics/${encodeURIComponent(key)}`);
  }

  listTopicMembers(key: string, includeExpired = false): Promise<TopicMembers> {
    return this.transport.request<TopicMembers>(
      'GET',
      `/topics/${encodeURIComponent(key)}/members${queryString({ includeExpired })}`,
    );
  }

  replaceTopicMembers(key: string, input: TopicMembersInput): Promise<TopicMutation> {
    return this.transport.request<TopicMutation>(
      'PUT',
      `/topics/${encodeURIComponent(key)}/members`,
      { body: input },
    );
  }

  addTopicMembers(key: string, input: TopicMembersInput): Promise<TopicMutation> {
    return this.transport.request<TopicMutation>(
      'POST',
      `/topics/${encodeURIComponent(key)}/members`,
      { retry: false, body: input },
    );
  }

  listNotifications(query: NotificationQuery = {}): Promise<Paged<NotificationSummary>> {
    return this.transport.request<Paged<NotificationSummary>>(
      'GET',
      `/notifications${queryString({
        limit: query.limit,
        offset: query.offset,
        search: query.search,
        status: query.status,
        templateKey: query.templateKey,
        from: query.from,
        to: query.to,
      })}`,
    );
  }

  getNotification(id: string): Promise<NotificationDetail> {
    return this.transport.request<NotificationDetail>(
      'GET',
      `/notifications/${encodeURIComponent(id)}`,
    );
  }

  resendNotification(
    id: string,
    input: ResendNotificationInput,
  ): Promise<ResendNotificationResult> {
    return this.transport.request<ResendNotificationResult>(
      'POST',
      `/notifications/${encodeURIComponent(id)}/resend`,
      { retry: false, body: input },
    );
  }

  exportNotifications(
    query: ExportNotificationsQuery = {},
  ): Promise<ExportNotificationsResult> {
    return this.transport.request<ExportNotificationsResult>(
      'GET',
      `/notifications/export${queryString({
        limit: query.limit,
        offset: query.offset,
        search: query.search,
        status: query.status,
        templateKey: query.templateKey,
        from: query.from,
        to: query.to,
      })}`,
    );
  }

  listAudit(query: AdminAuditQuery = {}): Promise<AdminAuditResult> {
    return this.transport.request<AdminAuditResult>(
      'GET',
      `/audit${queryString({
        action: query.action,
        from: query.from,
        to: query.to,
        limit: query.limit,
        offset: query.offset,
      })}`,
    );
  }

  composeNotification(input: ComposeNotificationInput): Promise<ComposeNotificationResult> {
    return this.transport.request<ComposeNotificationResult>('POST', '/notifications', {
      retry: false,
      body: input,
    });
  }
}

type QueryValue = string | number | boolean | undefined;

function queryString(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') {
      continue;
    }

    search.set(key, String(value));
  }

  const serialized = search.toString();

  return serialized.length > 0 ? `?${serialized}` : '';
}
