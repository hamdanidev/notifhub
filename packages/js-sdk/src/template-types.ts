import type { Channel, Paged } from './admin-types';

export type TemplateStatus = 'draft' | 'published';
export type TemplateFormat = 'text' | 'html' | 'markdown';
export type TemplateDirection = 'auto' | 'ltr' | 'rtl';

export interface TemplateValidationIssue {
  code: string;
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

/** Template v2 row returned by the tenant Admin API (`view=summary` or `view=full`). */
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

export interface TemplateImageAsset {
  id: string;
  url: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  width: number;
  height: number;
  size: number;
  createdAt: string;
}

/**
 * Payload for creating a template v2 row. Named with the `V2` suffix so it does not clash with
 * the legacy `CreateTemplateInput` exported by `admin-types`.
 */
export interface CreateTemplateV2Input {
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

/** Payload for updating a template v2 row; see `CreateTemplateV2Input` for the name. */
export interface UpdateTemplateV2Input {
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

export interface TemplateListQuery {
  search?: string;
  channel?: Channel;
  status?: TemplateStatus;
  locale?: string;
  limit: number;
  offset: number;
  view?: 'summary' | 'full';
}

export type TemplateListResult = Paged<TemplateSummary>;

export type TemplateApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface TemplateApproval {
  id: string;
  templateId: string;
  templateVersion: number;
  revision: number;
  status: TemplateApprovalStatus;
  requestedBy: { adminId: string; email: string };
  requestedNote: string | null;
  reviewedBy: { adminId: string; email: string } | null;
  reviewNote: string | null;
  selfApproved: boolean;
  selfApprovalReason: string | null;
  requestedAt: string;
  reviewedAt: string | null;
  stale: boolean;
}

export interface TemplateApprovalQueueItem extends TemplateApproval {
  templateKey: string;
  channel: string;
  locale: string;
  templateSubject: string | null;
  templateStatus: string;
  templateActive: boolean;
}

export interface TemplateApprovalList {
  items: TemplateApproval[];
  total: number;
  limit: number;
  offset: number;
}

export interface TemplateApprovalQueue {
  items: TemplateApprovalQueueItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface TemplateApprovalQuery {
  status?: TemplateApprovalStatus;
  templateId?: string;
  limit?: number;
  offset?: number;
}

export interface TemplateDiffHunk {
  type: 'equal' | 'added' | 'removed';
  value: string;
}

export interface TemplateDiffVersion {
  id: string;
  version: number;
  revision: number;
  status: string;
  updatedAt: string;
  builderAvailable: boolean;
}

export interface TemplateDiffField {
  field: 'subject' | 'preheader' | 'body';
  changed: boolean;
  mode: 'word' | 'line';
  hunks: TemplateDiffHunk[];
  addedLines?: number;
  removedLines?: number;
  truncated: boolean;
}

export interface TemplateDiffBlockChange {
  index: number;
  type: string;
  fields: string[];
}

export interface TemplateDiffResult {
  templateId: string;
  key: string;
  channel: string;
  locale: string;
  from: TemplateDiffVersion;
  to: TemplateDiffVersion;
  fields: TemplateDiffField[];
  blocks: {
    available: boolean;
    added: number;
    removed: number;
    changed: TemplateDiffBlockChange[];
    truncated: boolean;
  };
  rendered: {
    from: { html: string | null; text: string | null; bytes: number; error: string | null };
    to: { html: string | null; text: string | null; bytes: number; error: string | null };
  };
  truncated: boolean;
}