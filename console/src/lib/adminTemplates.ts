import { DEFAULT_RETRY_OPTIONS, HttpTransport } from '@notifhub/js';
import { API_BASE_URL } from '../env';
import { getToken } from './session';
import type {
  Channel,
  CreateTemplateInput,
  LayoutAsset,
  PartialAsset,
  PreviewInlineInput,
  PreviewResult,
  Paged,
  TemplateAuditEvent,
  TemplateListResult,
  TemplateMutation,
  TemplateStatus,
  TemplateSummary,
  TemplateTestSendHistory,
  TestSendResult,
  ThemeAsset,
  UpdateTemplateInput,
} from './templateTypes';

const transport = new HttpTransport(
  `${API_BASE_URL.replace(/\/+$/, '')}/api/v1/admin`,
  async () => getToken() ?? '',
  globalThis.fetch.bind(globalThis),
  DEFAULT_RETRY_OPTIONS,
);

type QueryValue = string | number | boolean | undefined;

function query(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, String(value));
    }
  }

  const serialized = search.toString();

  return serialized.length === 0 ? '' : `?${serialized}`;
}

export function listTemplates(params: {
  search?: string;
  channel?: Channel;
  status?: TemplateStatus;
  locale?: string;
  limit: number;
  offset: number;
  view?: 'summary' | 'full';
}): Promise<TemplateListResult> {
  return transport.request<TemplateListResult>(
    'GET',
    `/templates${query({
      search: params.search,
      channel: params.channel,
      status: params.status,
      locale: params.locale,
      limit: params.limit,
      offset: params.offset,
      view: params.view ?? 'summary',
    })}`,
  );
}

export function getTemplate(id: string): Promise<TemplateSummary> {
  return transport.request<TemplateSummary>('GET', `/templates/${encodeURIComponent(id)}`);
}

export function createTemplate(input: CreateTemplateInput): Promise<TemplateMutation> {
  return transport.request<TemplateMutation>('POST', '/templates', {
    body: input,
    retry: false,
  });
}

export function updateTemplate(
  id: string,
  input: UpdateTemplateInput,
): Promise<TemplateMutation> {
  return transport.request<TemplateMutation>(
    'PUT',
    `/templates/${encodeURIComponent(id)}`,
    { body: input, retry: false },
  );
}

export function deactivateTemplate(id: string): Promise<TemplateSummary> {
  return transport.request<TemplateSummary>(
    'DELETE',
    `/templates/${encodeURIComponent(id)}`,
    { retry: false },
  );
}

export function activateTemplate(id: string): Promise<TemplateSummary> {
  return transport.request<TemplateSummary>(
    'POST',
    `/templates/${encodeURIComponent(id)}/activate`,
    { retry: false },
  );
}

export function publishTemplate(
  id: string,
  expectedRevision: number,
  note?: string,
): Promise<TemplateMutation> {
  return transport.request<TemplateMutation>(
    'POST',
    `/templates/${encodeURIComponent(id)}/publish`,
    { body: { expectedRevision, ...(note === undefined ? {} : { note }) }, retry: false },
  );
}

export function cloneTemplate(
  id: string,
  input: { key?: string; locale?: string; version?: number; note?: string },
): Promise<TemplateMutation> {
  return transport.request<TemplateMutation>(
    'POST',
    `/templates/${encodeURIComponent(id)}/clone`,
    { body: input, retry: false },
  );
}

export function rollbackTemplate(
  id: string,
  sourceVersion: number,
  note?: string,
): Promise<TemplateMutation> {
  return transport.request<TemplateMutation>(
    'POST',
    `/templates/${encodeURIComponent(id)}/rollback`,
    { body: { sourceVersion, ...(note === undefined ? {} : { note }) }, retry: false },
  );
}

export function listTemplateVersions(id: string): Promise<TemplateSummary[]> {
  return transport.request<TemplateSummary[]>(
    'GET',
    `/templates/${encodeURIComponent(id)}/versions`,
  );
}

export function listTemplateAudit(
  id: string,
  limit = 50,
  offset = 0,
): Promise<Paged<TemplateAuditEvent>> {
  return transport.request<Paged<TemplateAuditEvent>>(
    'GET',
    `/templates/${encodeURIComponent(id)}/audit${query({ limit, offset })}`,
  );
}

export function listTemplateTestSends(
  id: string,
  limit = 20,
  offset = 0,
): Promise<Paged<TemplateTestSendHistory>> {
  return transport.request<Paged<TemplateTestSendHistory>>(
    'GET',
    `/templates/${encodeURIComponent(id)}/test-sends${query({ limit, offset })}`,
  );
}

export function previewInline(input: PreviewInlineInput): Promise<PreviewResult> {
  return transport.request<PreviewResult>('POST', '/templates/preview', {
    body: input,
    retry: false,
  });
}

export function previewSaved(
  id: string,
  input: { sampleData?: unknown; direction?: string } = {},
): Promise<PreviewResult> {
  return transport.request<PreviewResult>(
    'POST',
    `/templates/${encodeURIComponent(id)}/preview`,
    { body: input, retry: false },
  );
}

export function testSendTemplate(
  id: string,
  input: { recipient: string; requestKey?: string; sampleData?: unknown; note?: string },
): Promise<TestSendResult> {
  return transport.request<TestSendResult>(
    'POST',
    `/templates/${encodeURIComponent(id)}/test-send`,
    { body: input, retry: false },
  );
}

export function listLayouts(params: { limit?: number; offset?: number } = {}): Promise<
  Paged<LayoutAsset>
> {
  return transport.request<Paged<LayoutAsset>>(
    'GET',
    `/template-assets/layouts${query({ latest: true, ...params })}`,
  );
}

export function createLayout(input: {
  key: string;
  name: string;
  content: string;
}): Promise<LayoutAsset> {
  return transport.request<LayoutAsset>('POST', '/template-assets/layouts', {
    body: input,
    retry: false,
  });
}

export function listThemes(params: { limit?: number; offset?: number } = {}): Promise<
  Paged<ThemeAsset>
> {
  return transport.request<Paged<ThemeAsset>>(
    'GET',
    `/template-assets/themes${query({ latest: true, ...params })}`,
  );
}

export function createTheme(input: {
  key: string;
  name: string;
  tokens: Record<string, unknown>;
}): Promise<ThemeAsset> {
  return transport.request<ThemeAsset>('POST', '/template-assets/themes', {
    body: input,
    retry: false,
  });
}

export function listPartials(params: { limit?: number; offset?: number } = {}): Promise<
  Paged<PartialAsset>
> {
  return transport.request<Paged<PartialAsset>>(
    'GET',
    `/template-assets/partials${query({ latest: true, ...params })}`,
  );
}

export function createPartial(input: {
  key: string;
  name: string;
  content: string;
}): Promise<PartialAsset> {
  return transport.request<PartialAsset>('POST', '/template-assets/partials', {
    body: input,
    retry: false,
  });
}
