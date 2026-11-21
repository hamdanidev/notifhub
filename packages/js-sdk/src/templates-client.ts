import type { NotifHubAdminClientOptions, Paged } from './admin-types';
import { NotifHubError } from './errors';
import { DEFAULT_RETRY_OPTIONS, HttpTransport } from './http';
import type { RetryOptions } from './types';
import type {
  CreateTemplateV2Input,
  LayoutAsset,
  PartialAsset,
  PreviewInlineInput,
  PreviewResult,
  TemplateAuditEvent,
  TemplateImageAsset,
  TemplateListQuery,
  TemplateListResult,
  TemplateMutation,
  TemplateSummary,
  TemplateTestSendHistory,
  TestSendResult,
  ThemeAsset,
  UpdateTemplateV2Input,
} from './template-types';

const ADMIN_PREFIX = '/api/v1/admin';

/**
 * Client for the tenant Admin API template v2 surface: templates, versions, audit, preview,
 * test send, layout/theme/partial assets, and template image upload.
 *
 * It lives next to `NotifHubAdminClient` instead of adding methods there because the legacy
 * template methods return the v1 `Template` shape, while this client returns `TemplateSummary`
 * (revision, format, status, builder data, resolved layout/theme/partials).
 */
export class NotifHubTemplatesClient {
  private readonly transport: HttpTransport;
  private readonly baseUrl: string;
  private readonly getToken: () => string | undefined | Promise<string | undefined>;
  private readonly fetchImpl: typeof fetch;

  constructor(options: NotifHubAdminClientOptions) {
    if (typeof options.baseUrl !== 'string' || options.baseUrl.length === 0) {
      throw new TypeError('NotifHubTemplatesClient: baseUrl is required');
    }

    if (typeof options.getToken !== 'function') {
      throw new TypeError('NotifHubTemplatesClient: getToken is required');
    }

    const fetchImpl = options.fetch ?? globalThis.fetch;

    if (typeof fetchImpl !== 'function') {
      throw new TypeError(
        'NotifHubTemplatesClient: fetch is not available; provide options.fetch',
      );
    }

    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.getToken = options.getToken;
    this.fetchImpl = fetchImpl.bind(globalThis);

    const retry: RetryOptions = { ...DEFAULT_RETRY_OPTIONS, ...options.retry };

    this.transport = new HttpTransport(
      `${this.baseUrl}${ADMIN_PREFIX}`,
      async () => (await options.getToken()) ?? '',
      this.fetchImpl,
      retry,
      options.logger,
    );
  }

  listTemplates(query: TemplateListQuery): Promise<TemplateListResult> {
    return this.transport.request<TemplateListResult>(
      'GET',
      `/templates${queryString({
        search: query.search,
        channel: query.channel,
        status: query.status,
        locale: query.locale,
        limit: query.limit,
        offset: query.offset,
        view: query.view ?? 'summary',
      })}`,
    );
  }

  getTemplate(id: string): Promise<TemplateSummary> {
    return this.transport.request<TemplateSummary>(
      'GET',
      `/templates/${encodeURIComponent(id)}`,
    );
  }

  createTemplate(input: CreateTemplateV2Input): Promise<TemplateMutation> {
    return this.transport.request<TemplateMutation>('POST', '/templates', {
      body: input,
      retry: false,
    });
  }

  updateTemplate(id: string, input: UpdateTemplateV2Input): Promise<TemplateMutation> {
    return this.transport.request<TemplateMutation>(
      'PUT',
      `/templates/${encodeURIComponent(id)}`,
      { body: input, retry: false },
    );
  }

  deactivateTemplate(id: string): Promise<TemplateSummary> {
    return this.transport.request<TemplateSummary>(
      'DELETE',
      `/templates/${encodeURIComponent(id)}`,
      { retry: false },
    );
  }

  activateTemplate(id: string): Promise<TemplateSummary> {
    return this.transport.request<TemplateSummary>(
      'POST',
      `/templates/${encodeURIComponent(id)}/activate`,
      { retry: false },
    );
  }

  publishTemplate(
    id: string,
    expectedRevision: number,
    note?: string,
  ): Promise<TemplateMutation> {
    return this.transport.request<TemplateMutation>(
      'POST',
      `/templates/${encodeURIComponent(id)}/publish`,
      {
        body: { expectedRevision, ...(note === undefined ? {} : { note }) },
        retry: false,
      },
    );
  }

  cloneTemplate(
    id: string,
    input: { key?: string; locale?: string; version?: number; note?: string },
  ): Promise<TemplateMutation> {
    return this.transport.request<TemplateMutation>(
      'POST',
      `/templates/${encodeURIComponent(id)}/clone`,
      { body: input, retry: false },
    );
  }

  rollbackTemplate(
    id: string,
    sourceVersion: number,
    note?: string,
  ): Promise<TemplateMutation> {
    return this.transport.request<TemplateMutation>(
      'POST',
      `/templates/${encodeURIComponent(id)}/rollback`,
      {
        body: { sourceVersion, ...(note === undefined ? {} : { note }) },
        retry: false,
      },
    );
  }

  listTemplateVersions(id: string): Promise<TemplateSummary[]> {
    return this.transport.request<TemplateSummary[]>(
      'GET',
      `/templates/${encodeURIComponent(id)}/versions`,
    );
  }

  listTemplateAudit(
    id: string,
    limit = 50,
    offset = 0,
  ): Promise<Paged<TemplateAuditEvent>> {
    return this.transport.request<Paged<TemplateAuditEvent>>(
      'GET',
      `/templates/${encodeURIComponent(id)}/audit${queryString({ limit, offset })}`,
    );
  }

  listTemplateTestSends(
    id: string,
    limit = 20,
    offset = 0,
  ): Promise<Paged<TemplateTestSendHistory>> {
    return this.transport.request<Paged<TemplateTestSendHistory>>(
      'GET',
      `/templates/${encodeURIComponent(id)}/test-sends${queryString({ limit, offset })}`,
    );
  }

  previewInline(input: PreviewInlineInput): Promise<PreviewResult> {
    return this.transport.request<PreviewResult>('POST', '/templates/preview', {
      body: input,
      retry: false,
    });
  }

  previewSaved(
    id: string,
    input: { sampleData?: unknown; direction?: string } = {},
  ): Promise<PreviewResult> {
    return this.transport.request<PreviewResult>(
      'POST',
      `/templates/${encodeURIComponent(id)}/preview`,
      { body: input, retry: false },
    );
  }

  testSendTemplate(
    id: string,
    input: { recipient: string; requestKey?: string; sampleData?: unknown; note?: string },
  ): Promise<TestSendResult> {
    return this.transport.request<TestSendResult>(
      'POST',
      `/templates/${encodeURIComponent(id)}/test-send`,
      { body: input, retry: false },
    );
  }

  listLayouts(params: { limit?: number; offset?: number } = {}): Promise<Paged<LayoutAsset>> {
    return this.transport.request<Paged<LayoutAsset>>(
      'GET',
      `/template-assets/layouts${queryString({ latest: true, ...params })}`,
    );
  }

  createLayout(input: {
    key: string;
    name: string;
    content: string;
  }): Promise<LayoutAsset> {
    return this.transport.request<LayoutAsset>('POST', '/template-assets/layouts', {
      body: input,
      retry: false,
    });
  }

  getLayout(id: string): Promise<LayoutAsset> {
    return this.transport.request<LayoutAsset>(
      'GET',
      `/template-assets/layouts/${encodeURIComponent(id)}`,
    );
  }

  deleteLayout(id: string): Promise<void> {
    return this.transport.request<void>(
      'DELETE',
      `/template-assets/layouts/${encodeURIComponent(id)}`,
      { retry: false },
    );
  }

  listThemes(params: { limit?: number; offset?: number } = {}): Promise<Paged<ThemeAsset>> {
    return this.transport.request<Paged<ThemeAsset>>(
      'GET',
      `/template-assets/themes${queryString({ latest: true, ...params })}`,
    );
  }

  createTheme(input: {
    key: string;
    name: string;
    tokens: Record<string, unknown>;
  }): Promise<ThemeAsset> {
    return this.transport.request<ThemeAsset>('POST', '/template-assets/themes', {
      body: input,
      retry: false,
    });
  }

  getTheme(id: string): Promise<ThemeAsset> {
    return this.transport.request<ThemeAsset>(
      'GET',
      `/template-assets/themes/${encodeURIComponent(id)}`,
    );
  }

  deleteTheme(id: string): Promise<void> {
    return this.transport.request<void>(
      'DELETE',
      `/template-assets/themes/${encodeURIComponent(id)}`,
      { retry: false },
    );
  }

  listPartials(params: { limit?: number; offset?: number } = {}): Promise<Paged<PartialAsset>> {
    return this.transport.request<Paged<PartialAsset>>(
      'GET',
      `/template-assets/partials${queryString({ latest: true, ...params })}`,
    );
  }

  createPartial(input: {
    key: string;
    name: string;
    content: string;
  }): Promise<PartialAsset> {
    return this.transport.request<PartialAsset>('POST', '/template-assets/partials', {
      body: input,
      retry: false,
    });
  }

  getPartial(id: string): Promise<PartialAsset> {
    return this.transport.request<PartialAsset>(
      'GET',
      `/template-assets/partials/${encodeURIComponent(id)}`,
    );
  }

  deletePartial(id: string): Promise<void> {
    return this.transport.request<void>(
      'DELETE',
      `/template-assets/partials/${encodeURIComponent(id)}`,
      { retry: false },
    );
  }

  /**
   * Multipart upload is not handled by `HttpTransport` (JSON-only bodies), so it is implemented
   * here with the injected fetch/token while still surfacing `NotifHubError`.
   */
  async uploadTemplateImage(file: Blob): Promise<TemplateImageAsset> {
    const token = await this.getToken();

    if (token === undefined || token.length === 0) {
      throw new NotifHubError(
        'unauthorized',
        'Admin session token is not available; sign in again',
      );
    }

    const form = new FormData();
    form.append('file', file);

    let response: Response;

    try {
      response = await this.fetchImpl(`${this.baseUrl}${ADMIN_PREFIX}/template-assets/images`, {
        method: 'POST',
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
        body: form,
      });
    } catch (error) {
      throw new NotifHubError(
        'network_error',
        error instanceof Error ? error.message : String(error),
        { retryable: true, cause: error },
      );
    }

    if (!response.ok) {
      throw await toUploadError(response);
    }

    try {
      return (await response.json()) as TemplateImageAsset;
    } catch (error) {
      throw new NotifHubError('invalid_response', 'Invalid JSON response from NotifHub', {
        status: response.status,
        retryable: false,
        cause: error,
      });
    }
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

async function toUploadError(response: Response): Promise<NotifHubError> {
  let message = `Upload failed with status ${response.status}`;

  try {
    const payload: unknown = await response.json();

    if (typeof payload === 'object' && payload !== null) {
      const raw = (payload as { message?: unknown }).message;

      if (typeof raw === 'string' && raw.length > 0) {
        message = raw;
      }
    }
  } catch {
    // Keep the default message when the body is not JSON.
  }

  const code =
    response.status === 400 || response.status === 422
      ? 'bad_request'
      : response.status === 401
        ? 'unauthorized'
        : response.status === 403
          ? 'forbidden'
          : response.status === 404
            ? 'not_found'
            : response.status === 429
              ? 'rate_limited'
              : response.status >= 500
                ? 'server_error'
                : 'invalid_response';

  return new NotifHubError(code, message, {
    status: response.status,
    retryable: response.status === 429 || response.status >= 500,
  });
}
