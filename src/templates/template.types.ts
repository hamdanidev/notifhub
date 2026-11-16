import type { Prisma } from '@prisma/client';

/** Template row plus the immutable assets referenced by that version. */
export type TemplateWithAssets = Prisma.NotificationTemplateGetPayload<{
  include: {
    layout: true;
    theme: true;
    partials: { include: { partial: true } };
  };
}>;

/** Minimal shape needed to render; used by saved templates and unsaved previews. */
export interface RenderableTemplate {
  id: string;
  key: string;
  channel: 'inapp' | 'email' | 'whatsapp' | 'sms';
  locale: string;
  subject: string | null;
  preheader: string | null;
  body: string;
  format: 'text' | 'html' | 'markdown';
  direction: 'auto' | 'ltr' | 'rtl';
  revision: number;
  strictVariables: boolean;
  variables: unknown;
  sampleData: unknown;
  builderData?: unknown;
  layout: { id: string; key: string; version: number; content: string } | null;
  theme: { id: string; key: string; version: number; tokens: unknown } | null;
  partials: Array<{
    partial: { id: string; key: string; version: number; content: string };
  }>;
  updatedAt: Date;
}

export type TemplateVariableType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'url'
  | 'email'
  | 'array';

export interface TemplateVariableDefinition {
  key: string;
  type: TemplateVariableType;
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

export interface TemplateValidationIssue {
  code: string;
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface RenderedTemplate {
  subject: string | null;
  preheader: string | null;
  body: string;
  /** Generated alternative part for email; `null` means HTML-only. */
  text: string | null;
  format: 'text' | 'html' | 'markdown';
  warnings: string[];
  missingVariables: string[];
}

export type TemplateRenderErrorCode =
  | 'template_render_failed'
  | 'template_variable_missing'
  | 'template_layout_invalid'
  | 'template_too_large';

/** Non-retryable template failure; workers translate it to BullMQ's UnrecoverableError. */
export class TemplateRenderError extends Error {
  constructor(
    readonly code: TemplateRenderErrorCode,
    message: string,
    readonly variables: string[] = [],
  ) {
    super(message);
    this.name = 'TemplateRenderError';
  }
}

export interface RenderContext {
  locale: string;
  language: string;
  direction: 'ltr' | 'rtl';
  isRtl: boolean;
}

export interface TemplatePreviewResult {
  subject: string | null;
  preheader: string | null;
  body: string;
  html: string | null;
  text: string | null;
  format: string;
  warnings: TemplateValidationIssue[];
  errors: TemplateValidationIssue[];
  missingVariables: string[];
  resolved: {
    locale: string;
    direction: 'ltr' | 'rtl';
    layout: { id: string; key: string; version: number } | null;
    theme: { id: string; key: string; version: number } | null;
    partials: Array<{ id: string; key: string; version: number }>;
  };
  bytes: number;
  renderMs: number;
}
