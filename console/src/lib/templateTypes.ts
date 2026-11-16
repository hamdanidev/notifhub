export type Channel = 'inapp' | 'email' | 'whatsapp' | 'sms';
export type TemplateStatus = 'draft' | 'published';
export type TemplateFormat = 'text' | 'html' | 'markdown';
export type TemplateDirection = 'auto' | 'ltr' | 'rtl';

export interface TemplateValidationIssue {
  code: string;
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface TemplateSummary {
  id: string;
  tenantId: string;
  key: string;
  channel: Channel;
  locale: string;
  subject: string | null;
  preheader: string | null;
  body: string | null;
  bodyPreview: string;
  format: TemplateFormat;
  direction: TemplateDirection;
  version: number;
  revision: number;
  status: TemplateStatus;
  active: boolean;
  strictVariables: boolean;
  variables: unknown;
  sampleData: unknown;
  builderData: unknown;
  layoutId: string | null;
  themeId: string | null;
  partialIds: string[];
  layout: { id: string; key: string; version: number; name: string } | null;
  theme: { id: string; key: string; version: number; name: string } | null;
  fallbackProvider: string | null;
  fallbackChannel: Channel | null;
  publishedAt: string | null;
  publishedByAdminId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateMutation extends TemplateSummary {
  validation: TemplateValidationIssue[];
}

export interface TemplateListResult {
  items: TemplateSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface TemplateVariableDefinition {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'url' | 'email' | 'array';
  required?: boolean;
  description?: string;
  example?: unknown;
  default?: unknown;
  pii?: boolean;
}

export interface TemplateVariableSchema {
  version?: number;
  variables: TemplateVariableDefinition[];
}

export interface PreviewResult {
  subject: string | null;
  preheader: string | null;
  body: string;
  html: string | null;
  text: string | null;
  format: TemplateFormat;
  warnings: TemplateValidationIssue[];
  errors: TemplateValidationIssue[];
  missingVariables: string[];
  resolved: {
    locale: string;
    direction: TemplateDirection;
    layout: { id: string; key: string; version: number } | null;
    theme: { id: string; key: string; version: number } | null;
    partials: Array<{ id: string; key: string; version: number }>;
  };
  bytes: number;
  renderMs: number;
}

export interface TestSendResult {
  status: 'sent' | 'simulated' | 'failed';
  mode: 'development' | 'staging' | 'production';
  channel: Channel;
  provider: string;
  providerMessageId: string | null;
  recipientMasked: string;
  auditId: string;
  error?: string;
}

export interface TemplateAuditEvent {
  id: string;
  action: string;
  templateVersion: number;
  actorAdminId: string | null;
  actorEmail: string | null;
  note: string | null;
  metadata: unknown;
  createdAt: string;
}

export interface TemplateTestSendHistory {
  id: string;
  templateVersion: number;
  channel: Channel;
  recipientMasked: string;
  status: string;
  providerName: string | null;
  providerMessageId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  requestedByAdminId: string | null;
  createdAt: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface LayoutAsset {
  id: string;
  tenantId: string;
  key: string;
  version: number;
  name: string;
  content: string | null;
  contentPreview: string;
  usageCount: number;
  createdAt: string;
}

export interface ThemeAsset {
  id: string;
  tenantId: string;
  key: string;
  version: number;
  name: string;
  tokens: Record<string, unknown> | null;
  tokenKeys: string[];
  usageCount: number;
  createdAt: string;
}

export interface PartialAsset {
  id: string;
  tenantId: string;
  key: string;
  version: number;
  name: string;
  content: string | null;
  contentPreview: string;
  usageCount: number;
  createdAt: string;
}

export interface CreateTemplateInput {
  key: string;
  channel: Channel;
  locale: string;
  subject?: string | null;
  preheader?: string | null;
  body: string;
  format?: TemplateFormat;
  direction?: TemplateDirection;
  version?: number;
  active?: boolean;
  status?: TemplateStatus;
  strictVariables?: boolean;
  variables?: unknown;
  sampleData?: unknown;
  builderData?: unknown;
  layoutId?: string | null;
  themeId?: string | null;
  partialIds?: string[];
  fallbackProvider?: string | null;
  fallbackChannel?: Channel | null;
  note?: string;
}

export interface UpdateTemplateInput {
  subject?: string | null;
  preheader?: string | null;
  body?: string;
  format?: TemplateFormat;
  direction?: TemplateDirection;
  active?: boolean;
  strictVariables?: boolean;
  variables?: unknown;
  sampleData?: unknown;
  builderData?: unknown;
  layoutId?: string | null;
  themeId?: string | null;
  partialIds?: string[];
  fallbackProvider?: string | null;
  fallbackChannel?: Channel | null;
  expectedRevision?: number;
  note?: string;
}

export interface PreviewInlineInput {
  channel: Channel;
  format?: TemplateFormat;
  subject?: string | null;
  preheader?: string | null;
  body: string;
  locale?: string;
  direction?: TemplateDirection;
  strictVariables?: boolean;
  variables?: unknown;
  sampleData?: unknown;
  layoutId?: string | null;
  themeId?: string | null;
  partialIds?: string[];
}
