import { Injectable } from '@nestjs/common';
import { Channel, TemplateFormat, type TemplateDirection } from '@prisma/client';
import { TemplateRenderer, resolveDirection } from '../../templates/template.render';
import {
  collectReferencedVariables,
  parseVariableSchema,
  validateSampleData,
} from '../../templates/template.variables';
import {
  dedupeIssues,
  sanitizeHeaderValue,
  validateEmailHtml,
  validateThemeTokens,
} from '../../templates/template.safety';
import {
  TemplateRenderError,
  type RenderableTemplate,
  type TemplateValidationIssue,
} from '../../templates/template.types';

const TEXT_LIMITS: Partial<Record<Channel, number>> = {
  inapp: 10_000,
  whatsapp: 4_096,
  sms: 1_600,
};

const EMAIL_WARNING_BYTES = 102_400;

export interface ValidationOptions {
  /** Legacy create/update keeps accepting an empty email subject; new drafts do not. */
  legacySubject?: boolean;
}

/**
 * Central validation used by save, publish, preview and test send. Draft saves may persist the
 * returned errors; publish/test send treat any error as blocking.
 */
@Injectable()
export class AdminTemplateValidationService {
  private readonly renderer = new TemplateRenderer();

  validate(
    template: RenderableTemplate,
    options: ValidationOptions = {},
  ): TemplateValidationIssue[] {
    const issues: TemplateValidationIssue[] = [];
    const expectedFormat =
      template.channel === Channel.email ? TemplateFormat.html : TemplateFormat.text;

    if (template.format !== expectedFormat) {
      issues.push({
        code: 'template_channel_mismatch',
        path: 'format',
        message: `channel ${template.channel} hanya mendukung format ${expectedFormat}`,
        severity: 'error',
      });
    }

    const hasEmailAssets =
      template.layout !== null || template.theme !== null || template.partials.length > 0;

    if (template.channel !== Channel.email && hasEmailAssets) {
      issues.push({
        code: 'template_channel_mismatch',
        path: 'layoutId',
        message: 'layout/theme/partial hanya didukung untuk channel email',
        severity: 'error',
      });
    }

    if (template.channel === Channel.email) {
      if (template.subject === null || template.subject.trim().length === 0) {
        issues.push({
          code: 'missing_subject',
          path: 'subject',
          message: 'subject email wajib diisi sebelum publish',
          severity: options.legacySubject === true ? 'warning' : 'error',
        });
      }

      if (template.preheader !== null && template.preheader.length > 200) {
        issues.push({
          code: 'preheader_too_long',
          path: 'preheader',
          message: 'preheader maksimum 200 karakter',
          severity: 'error',
        });
      }

      issues.push(...validateEmailHtml(template.body, 'body'));

      if (template.layout !== null) {
        issues.push(...validateEmailHtml(template.layout.content, 'layout'));
        const placeholders = template.layout.content.match(/\{\{\{\s*body\s*\}\}\}/g) ?? [];

        if (placeholders.length !== 1) {
          issues.push({
            code: 'template_layout_invalid',
            path: 'layout',
            message: 'layout email harus memuat tepat satu {{{body}}}',
            severity: 'error',
          });
        }
      } else {
        issues.push({
          code: 'missing_layout',
          path: 'layout',
          message: 'template email tanpa layout: preheader/theme tidak diterapkan',
          severity: 'warning',
        });
      }

      for (const link of template.partials) {
        issues.push(
          ...validateEmailHtml(link.partial.content, `partials.${link.partial.key}`),
        );
      }

      if (template.theme !== null) {
        issues.push(...validateThemeTokens(template.theme.tokens));
      }
    } else {
      if (
        template.channel !== Channel.inapp &&
        template.subject !== null &&
        template.subject.trim().length > 0
      ) {
        issues.push({
          code: 'subject_not_supported',
          path: 'subject',
          message: `subject tidak didukung untuk channel ${template.channel}`,
          severity: 'error',
        });
      }
      if (template.preheader !== null && template.preheader.length > 0) {
        issues.push({
          code: 'preheader_not_supported',
          path: 'preheader',
          message: 'preheader hanya didukung untuk email',
          severity: 'error',
        });
      }
    }

    const parsed = parseVariableSchema(template.variables);
    issues.push(...parsed.issues);
    issues.push(...validateSampleData(parsed.schema, template.sampleData));

    const sample =
      isRecord(template.sampleData) ? template.sampleData : {};

    try {
      const rendered = this.renderer.render(
        { ...template, strictVariables: true },
        sample,
      );

      const limit = TEXT_LIMITS[template.channel];

      if (limit !== undefined && [...rendered.body].length > limit) {
        issues.push({
          code: 'template_too_large',
          path: 'body',
          message: `body ${template.channel} melebihi ${limit} karakter setelah render`,
          severity: 'error',
        });
      }

      if (template.channel === Channel.email) {
        const bytes = Buffer.byteLength(rendered.body, 'utf8');

        if (bytes > EMAIL_WARNING_BYTES) {
          issues.push({
            code: 'email_size_warning',
            path: 'body',
            message: `HTML email ${bytes} byte (> 100 KB) berisiko dipotong Gmail`,
            severity: 'warning',
          });
        }
      }
    } catch (error) {
      if (error instanceof TemplateRenderError) {
        issues.push({
          code: error.code,
          path: 'body',
          message: error.message,
          severity: 'error',
        });
      } else {
        issues.push({
          code: 'template_render_failed',
          path: 'body',
          message: error instanceof Error ? error.message : 'template gagal dirender',
          severity: 'error',
        });
      }
    }

    const declared = new Set(parsed.schema.variables.map((variable) => variable.key));
    const referenced = new Set(
      collectReferencedVariables([
        template.subject ?? '',
        template.preheader ?? '',
        template.body,
        template.layout?.content ?? '',
        ...template.partials.map((link) => link.partial.content),
      ]),
    );

    for (const key of referenced) {
      if (isKnownHelperOrContext(key)) {
        continue;
      }

      if (!declared.has(key)) {
        issues.push({
          code: 'undeclared_variable',
          path: key,
          message: `variabel "${key}" dipakai tetapi tidak dideklarasikan di schema`,
          severity: 'warning',
        });
      }
    }

    for (const key of declared) {
      if (!referenced.has(key)) {
        issues.push({
          code: 'unused_variable',
          path: key,
          message: `variabel "${key}" dideklarasikan tetapi tidak dipakai`,
          severity: 'warning',
        });
      }
    }

    return dedupeIssues(issues);
  }

  errors(issues: TemplateValidationIssue[]): TemplateValidationIssue[] {
    return issues.filter((issue) => issue.severity === 'error');
  }

  warnings(issues: TemplateValidationIssue[]): TemplateValidationIssue[] {
    return issues.filter((issue) => issue.severity === 'warning');
  }

  compileError(message: string, path = 'body'): TemplateValidationIssue {
    return {
      code: 'template_render_failed',
      path,
      message,
      severity: 'error',
    };
  }
}

export function buildRenderable(input: {
  id?: string;
  key?: string;
  channel: Channel;
  locale: string;
  subject: string | null;
  preheader: string | null;
  body: string;
  format: TemplateFormat;
  direction: TemplateDirection;
  revision?: number;
  strictVariables: boolean;
  variables: unknown;
  sampleData: unknown;
  layout: RenderableTemplate['layout'];
  theme: RenderableTemplate['theme'];
  partials: RenderableTemplate['partials'];
  updatedAt?: Date;
}): RenderableTemplate {
  return {
    id: input.id ?? 'preview',
    key: input.key ?? 'preview',
    channel: input.channel,
    locale: input.locale,
    subject: input.subject,
    preheader: input.preheader,
    body: input.body,
    format: input.format,
    direction: input.direction,
    revision: input.revision ?? 0,
    strictVariables: input.strictVariables,
    variables: input.variables,
    sampleData: input.sampleData,
    layout: input.layout,
    theme: input.theme,
    partials: input.partials,
    updatedAt: input.updatedAt ?? new Date(0),
  };
}

export function directionFor(locale: string, configured: TemplateDirection): 'ltr' | 'rtl' {
  const language = locale.split('-')[0]?.toLowerCase() ?? locale.toLowerCase();

  return resolveDirection(configured, language);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const KNOWN_CONTEXT = new Set([
  'theme',
  'locale',
  'lang',
  'dir',
  'isRtl',
  'subject',
  'preheader',
  'body',
  'formatDate',
  'currency',
  'uppercase',
  'lowercase',
  'trim',
  'urlencode',
  'default',
  'eq',
  'ne',
  'gt',
  'lt',
  'and',
  'or',
  'not',
  'if',
  'unless',
  'each',
  'with',
  'lookup',
]);

function isKnownHelperOrContext(key: string): boolean {
  return KNOWN_CONTEXT.has(key) || key.startsWith('theme.');
}

// Re-exported for callers that sanitize a user-provided subject before sending.
export { sanitizeHeaderValue };
