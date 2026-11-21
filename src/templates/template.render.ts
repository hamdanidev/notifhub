import { createHash } from 'node:crypto';
import Handlebars from 'handlebars';
import type { TemplateDirection } from '@prisma/client';
import {
  TemplateRenderError,
  type RenderContext,
  type RenderableTemplate,
  type RenderedTemplate,
  type TemplateValidationIssue,
} from './template.types';
import { prepareTemplateData, parseVariableSchema } from './template.variables';
import { sanitizeEmailHtml, sanitizeHeaderValue } from './template.safety';
import { htmlToPlainText } from './template.text';
import { renderMarkdownSubset } from './template.markdown';

const MAX_CACHE_ENTRIES = 200;
const MAX_EMAIL_BYTES = 262_144;

type CompiledTemplate = ReturnType<typeof Handlebars.compile>;

interface CompiledTemplateSet {
  subject: CompiledTemplate;
  preheader: CompiledTemplate;
  body: CompiledTemplate;
  layout: CompiledTemplate | null;
  hasLayout: boolean;
  warnings: string[];
}

/**
 * Compiles and renders one immutable template version. Delegates are cached by template id +
 * revision; a new version always produces a new row/revision, so cache entries never need
 * invalidation when an admin publishes a change.
 */
export class TemplateRenderer {
  private readonly cache = new Map<string, CompiledTemplateSet>();

  render(
    template: RenderableTemplate,
    input: Record<string, unknown>,
  ): RenderedTemplate {
    const parsed = parseVariableSchema(template.variables);
    const warnings: string[] = parsed.issues.map((issue) => issue.message);
    const prepared = prepareTemplateData(parsed.schema, input, template.strictVariables);
    const compiled = this.getCompiled(template);
    warnings.push(...compiled.warnings);

    const context = this.buildContext(template);
    const runtimeOptions = {
      allowProtoPropertiesByDefault: false,
      allowProtoMethodsByDefault: false,
    };
    const subjectRaw = compiled.subject(prepared.data, runtimeOptions);
    const preheaderRaw = compiled.preheader(prepared.data, runtimeOptions);
    const bodyRaw = compiled.body(prepared.data, runtimeOptions);

    let body = bodyRaw;
    let bodyHtml: string | null = null;

    if (compiled.layout !== null) {
      body = compiled.layout(
        {
          ...prepared.data,
          body: bodyRaw,
          subject: subjectRaw,
          preheader: preheaderRaw,
          locale: context.locale,
          lang: context.language,
          dir: context.direction,
          isRtl: context.isRtl,
          theme: template.theme?.tokens ?? {},
        },
        runtimeOptions,
      );
    }

    if (template.format === 'markdown') {
      const markdown = renderMarkdownSubset(body);
      body = markdown.text;
      bodyHtml = markdown.html;
      warnings.push(...markdown.warnings);
    }

    if (template.format === 'html') {
      const sanitized = sanitizeEmailHtml(body);

      if (sanitized.removed > 0) {
        warnings.push(
          `output email dibersihkan oleh sanitizer (${sanitized.removed} konstruksi berbahaya)`,
        );
        body = sanitized.html;
      }

      if (Buffer.byteLength(body, 'utf8') > MAX_EMAIL_BYTES) {
        throw new TemplateRenderError(
          'template_too_large',
          `rendered email melebihi ${MAX_EMAIL_BYTES} byte`,
        );
      }
    }

    let text: string | null = null;

    if (template.channel === 'email' && template.format === 'html') {
      try {
        text = htmlToPlainText(body);
      } catch {
        text = null;
        warnings.push('plain text tidak dapat digenerate; email dikirim HTML-only');
      }
    }

    return {
      subject:
        template.subject === null
          ? null
          : sanitizeHeaderValue(subjectRaw, 255),
      preheader:
        template.preheader === null ? null : sanitizeHeaderValue(preheaderRaw, 200),
      body,
      bodyHtml,
      text,
      format: template.format,
      warnings: [...new Set(warnings)],
      missingVariables: prepared.missing,
    };
  }

  private getCompiled(template: RenderableTemplate): CompiledTemplateSet {
    const key = [
      template.id,
      template.revision,
      template.format,
      hashContent(
        [
          template.subject ?? '',
          template.preheader ?? '',
          template.body,
          template.layout?.content ?? '',
          ...template.partials.map((link) => link.partial.content),
        ].join('\u0000'),
      ),
    ].join(':');
    const cached = this.cache.get(key);

    if (cached !== undefined) {
      return cached;
    }

    const compiled = this.compile(template);

    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      this.cache.clear();
    }

    this.cache.set(key, compiled);

    return compiled;
  }

  private compile(template: RenderableTemplate): CompiledTemplateSet {
    const env = Handlebars.create();
    registerHelpers(env);

    for (const link of template.partials) {
      env.registerPartial(link.partial.key, link.partial.content);
    }

    const textMode = template.format !== 'html';
    const warnings: string[] = [];

    let layout: CompiledTemplate | null = null;

    if (template.layout !== null) {
      const bodyPlaceholders = template.layout.content.match(/\{\{\{\s*body\s*\}\}\}/g) ?? [];

      if (bodyPlaceholders.length !== 1) {
        throw new TemplateRenderError(
          'template_layout_invalid',
          'layout email harus memuat tepat satu {{{body}}}',
        );
      }

      layout = env.compile(template.layout.content, {
        noEscape: false,
        strict: false,
      });
    } else if (template.channel === 'email') {
      warnings.push('template email tidak memakai layout; preheader/theme tidak diterapkan');
    }

    return {
      subject: env.compile(template.subject ?? '', {
        noEscape: true,
        strict: false,
      }),
      preheader: env.compile(template.preheader ?? '', {
        noEscape: true,
        strict: false,
      }),
      body: env.compile(template.body, {
        noEscape: textMode,
        strict: false,
      }),
      layout,
      hasLayout: layout !== null,
      warnings,
    };
  }

  private buildContext(template: RenderableTemplate): RenderContext {
    const locale = template.locale.trim();
    const language = locale.split('-')[0]?.toLowerCase() ?? locale.toLowerCase();
    const direction = resolveDirection(template.direction, language);

    return {
      locale,
      language,
      direction,
      isRtl: direction === 'rtl',
    };
  }
}

export function resolveDirection(
  configured: TemplateDirection,
  language: string,
): 'ltr' | 'rtl' {
  if (configured === 'ltr' || configured === 'rtl') {
    return configured;
  }

  return RTL_LANGUAGES.has(language) ? 'rtl' : 'ltr';
}

const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur', 'ps', 'sd', 'ug', 'yi', 'dv', 'ku']);

export function localeCandidates(
  requested: string | undefined,
  defaultLocale: string,
): string[] {
  const candidates: string[] = [];
  const add = (value: string): void => {
    const trimmed = value.trim();

    if (trimmed.length > 0 && !candidates.includes(trimmed)) {
      candidates.push(trimmed);
    }
  };

  if (requested !== undefined) {
    add(requested);
    add(normalizeLocale(requested));

    const language = requested.split('-')[0];

    if (language !== undefined) {
      add(language.toLowerCase());
    }
  }

  add(defaultLocale);
  add(normalizeLocale(defaultLocale));

  return candidates.slice(0, 5);
}

export function normalizeLocale(locale: string): string {
  const parts = locale.trim().split('-');

  if (parts.length === 0) {
    return locale.trim().toLowerCase();
  }

  const [language, ...rest] = parts;
  const normalized = [language?.toLowerCase() ?? ''];

  for (const part of rest) {
    normalized.push(part.length === 2 ? part.toUpperCase() : part);
  }

  return normalized.join('-');
}

export function templateValidationWarnings(
  issues: TemplateValidationIssue[],
): string[] {
  return issues.map((issue) => issue.message);
}

function registerHelpers(env: typeof Handlebars): void {
  env.registerHelper('uppercase', (value: unknown) => String(value ?? '').toUpperCase());
  env.registerHelper('lowercase', (value: unknown) => String(value ?? '').toLowerCase());
  env.registerHelper('trim', (value: unknown) => String(value ?? '').trim());
  env.registerHelper('urlencode', (value: unknown) => encodeURIComponent(String(value ?? '')));
  env.registerHelper('default', (value: unknown, fallback: unknown) =>
    value === undefined || value === null || value === '' ? fallback : value,
  );
  env.registerHelper('eq', (left: unknown, right: unknown) => left === right);
  env.registerHelper('ne', (left: unknown, right: unknown) => left !== right);
  env.registerHelper('gt', (left: unknown, right: unknown) => Number(left) > Number(right));
  env.registerHelper('lt', (left: unknown, right: unknown) => Number(left) < Number(right));
  env.registerHelper('and', (...args: unknown[]) => args.slice(0, -1).every(Boolean));
  env.registerHelper('or', (...args: unknown[]) => args.slice(0, -1).some(Boolean));
  env.registerHelper('not', (value: unknown) => !value);
  env.registerHelper(
    'formatDate',
    (value: unknown, style?: unknown, timezone?: unknown) => formatDate(value, style, timezone),
  );
  env.registerHelper(
    'currency',
    (value: unknown, currency?: unknown, locale?: unknown) =>
      formatCurrency(value, currency, locale),
  );
}

function formatDate(value: unknown, style: unknown, timezone: unknown): string {
  if (value === undefined || value === null || value === '') {
    return '';
  }

  const date = value instanceof Date ? value : new Date(String(value));

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  const mode = typeof style === 'string' ? style : 'date';
  const tz = typeof timezone === 'string' && timezone.length > 0 ? timezone : 'UTC';

  if (mode === 'iso') {
    return date.toISOString();
  }

  const options: Intl.DateTimeFormatOptions =
    mode === 'datetime'
      ? { dateStyle: 'medium', timeStyle: 'short', timeZone: tz }
      : mode === 'time'
        ? { timeStyle: 'short', timeZone: tz }
        : { dateStyle: 'medium', timeZone: tz };

  try {
    return new Intl.DateTimeFormat('id-ID', options).format(date);
  } catch {
    return date.toISOString();
  }
}

function formatCurrency(value: unknown, currency: unknown, locale: unknown): string {
  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    return '';
  }

  const currencyCode = typeof currency === 'string' && /^[A-Z]{3}$/.test(currency) ? currency : 'IDR';
  const localeName = typeof locale === 'string' && locale.length > 0 ? locale : 'id-ID';

  try {
    return new Intl.NumberFormat(localeName, {
      style: 'currency',
      currency: currencyCode,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return String(amount);
  }
}

function hashContent(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}
