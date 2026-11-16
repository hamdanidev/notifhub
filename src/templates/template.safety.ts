import type { TemplateValidationIssue } from './template.types';

const BLOCKED_TAGS = new Set([
  'script',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'textarea',
  'select',
  'button',
  'base',
  'link',
  'svg',
  'math',
]);

const REMOVE_CONTENT_TAGS = new Set(['script', 'iframe', 'object', 'embed', 'svg', 'math']);

const DANGEROUS_CSS = /(expression\s*\(|behavior\s*:|-moz-binding|@import|url\s*\(\s*['"]?\s*(?:javascript|vbscript|data)\s*:)/i;
const EVENT_ATTR = /\s+on[a-z0-9_-]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const URL_ATTR = /(\b(?:href|src|action|formaction|poster|background|xlink:href)\s*=\s*)(["'])([\s\S]*?)\2/gi;
const STYLE_TAG = /<style\b[^>]*>[\s\S]*?<\/style>/gi;
const META_REFRESH = /<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi;

export const ASSET_KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

export function validateEmailHtml(
  source: string,
  path: string,
): TemplateValidationIssue[] {
  const issues: TemplateValidationIssue[] = [];
  const tagPattern = /<\s*\/?\s*([a-zA-Z][a-zA-Z0-9-]*)\b/g;

  for (const match of source.matchAll(tagPattern)) {
    const tag = match[1]?.toLowerCase();

    if (tag !== undefined && BLOCKED_TAGS.has(tag)) {
      issues.push({
        code: 'unsafe_html',
        path,
        message: `tag <${tag}> tidak diizinkan di template email`,
        severity: 'error',
      });
    }
  }

  if (EVENT_ATTR.test(source)) {
    issues.push({
      code: 'unsafe_html_attribute',
      path,
      message: 'atribut event handler (on*) tidak diizinkan',
      severity: 'error',
    });
  }
  EVENT_ATTR.lastIndex = 0;

  for (const match of source.matchAll(URL_ATTR)) {
    const rawValue = match[3];

    if (rawValue !== undefined && isDangerousUrl(rawValue)) {
      issues.push({
        code: 'unsafe_url',
        path,
        message: `URL dengan skema berbahaya tidak diizinkan: ${truncate(rawValue)}`,
        severity: 'error',
      });
    }
  }

  if (DANGEROUS_CSS.test(source)) {
    issues.push({
      code: 'unsafe_css',
      path,
      message: 'CSS berbahaya (expression/behavior/@import/url javascript) tidak diizinkan',
      severity: 'error',
    });
  }

  if (META_REFRESH.test(source)) {
    issues.push({
      code: 'unsafe_meta',
      path,
      message: 'meta refresh tidak diizinkan',
      severity: 'error',
    });
  }
  META_REFRESH.lastIndex = 0;

  return issues;
}

export function sanitizeEmailHtml(html: string): { html: string; removed: number } {
  let removed = 0;
  let output = html;

  for (const tag of REMOVE_CONTENT_TAGS) {
    const paired = new RegExp(
      `<\\s*${tag}\\b[^>]*>[\\s\\S]*?<\\s*\\/\\s*${tag}\\s*>`,
      'gi',
    );
    output = output.replace(paired, () => {
      removed += 1;
      return '';
    });
  }

  output = output.replace(META_REFRESH, () => {
    removed += 1;
    return '';
  });

  output = output.replace(EVENT_ATTR, () => {
    removed += 1;
    return '';
  });

  output = output.replace(URL_ATTR, (full, prefix: string, quote: string, rawValue: string) => {
    if (!isDangerousUrl(rawValue)) {
      return full;
    }

    removed += 1;
    return `${prefix}${quote}#${quote}`;
  });

  output = output.replace(STYLE_TAG, (styleBlock) => {
    if (!DANGEROUS_CSS.test(styleBlock)) {
      return styleBlock;
    }

    removed += 1;
    return '';
  });

  output = output.replace(/\s+style\s*=\s*("[^"]*"|'[^']*')/gi, (full, quoted: string) => {
    if (!DANGEROUS_CSS.test(quoted)) {
      return full;
    }

    removed += 1;
    return '';
  });

  // Remove any remaining blocked opening/closing tags (including self-closing forms).
  output = output.replace(
    /<\s*\/?\s*(script|iframe|object|embed|form|input|textarea|select|button|base|link|svg|math)\b[^>]*>/gi,
    () => {
      removed += 1;
      return '';
    },
  );

  return { html: output, removed };
}

export function validateThemeTokens(tokens: unknown): TemplateValidationIssue[] {
  if (!isRecord(tokens)) {
    return [
      {
        code: 'invalid_theme',
        path: 'theme.tokens',
        message: 'tokens theme harus berupa objek JSON',
        severity: 'error',
      },
    ];
  }

  const issues: TemplateValidationIssue[] = [];
  let nodes = 0;

  const visit = (value: unknown, path: string, depth: number): void => {
    nodes += 1;

    if (nodes > 200) {
      issues.push({
        code: 'theme_too_large',
        path: 'theme.tokens',
        message: 'tokens theme terlalu banyak (maksimum 200 node)',
        severity: 'error',
      });
      return;
    }

    if (depth > 4) {
      issues.push({
        code: 'theme_too_deep',
        path,
        message: 'tokens theme terlalu dalam (maksimum 4 level)',
        severity: 'error',
      });
      return;
    }

    if (typeof value === 'string') {
      if (/[;{}<>"]/.test(value) || /url\s*\(/i.test(value) || DANGEROUS_CSS.test(value)) {
        issues.push({
          code: 'unsafe_theme_token',
          path,
          message: `nilai theme tidak boleh mengandung karakter/CSS berbahaya: ${truncate(value)}`,
          severity: 'error',
        });
      }
      return;
    }

    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        issues.push({
          code: 'invalid_theme_token',
          path,
          message: 'nilai theme number harus finite',
          severity: 'error',
        });
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((child, index) => {
        visit(child, `${path}[${index}]`, depth + 1);
      });
      return;
    }

    if (isRecord(value)) {
      for (const [key, child] of Object.entries(value)) {
        if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(key)) {
          issues.push({
            code: 'invalid_theme_key',
            path: `${path}.${key}`,
            message: `key theme tidak valid: ${key}`,
            severity: 'error',
          });
          continue;
        }

        visit(child, `${path}.${key}`, depth + 1);
      }
      return;
    }

    issues.push({
      code: 'invalid_theme_token',
      path,
      message: 'nilai theme harus string, number, array, atau objek',
      severity: 'error',
    });
  };

  for (const [key, value] of Object.entries(tokens)) {
    visit(value, `theme.${key}`, 1);
  }

  return dedupeIssues(issues);
}

export function sanitizeHeaderValue(value: string, maxLength = 255): string {
  return value.replace(/[\r\n\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

export function isDangerousUrl(value: string): boolean {
  const decoded = decodeHtmlEntities(value).trim();

  if (decoded.length === 0 || decoded.startsWith('#') || decoded.startsWith('/')) {
    return false;
  }

  if (decoded.startsWith('//')) {
    return false;
  }

  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(decoded);

  if (schemeMatch === null) {
    return false;
  }

  const scheme = schemeMatch[1]?.toLowerCase();

  return scheme !== 'http' && scheme !== 'https' && scheme !== 'mailto' && scheme !== 'tel';
}

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_full, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : _full;
    })
    .replace(/&#(\d+);?/g, (_full, decimal: string) => {
      const code = Number.parseInt(decimal, 10);
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : _full;
    })
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

export function dedupeIssues(issues: TemplateValidationIssue[]): TemplateValidationIssue[] {
  const seen = new Set<string>();
  const result: TemplateValidationIssue[] = [];

  for (const issue of issues) {
    const key = `${issue.code}:${issue.path}:${issue.message}`;

    if (!seen.has(key)) {
      seen.add(key);
      result.push(issue);
    }
  }

  return result;
}

function truncate(value: string): string {
  return value.length <= 80 ? value : `${value.slice(0, 77)}...`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
