import type { TemplateValidationIssue } from './template.types';

export const MAX_MARKDOWN_LINKS = 100;
export const MAX_MARKDOWN_LINES = 200;

export interface MarkdownRenderResult {
  html: string;
  text: string;
  warnings: string[];
}

interface InlineHandlers {
  onLink: () => void;
  onInvalidLink: (url: string) => void;
}

const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/;
const RAW_HTML_TAG = /<\s*\/?\s*[a-zA-Z][^>]*>/;
const LINK_PATTERN = /\[([^\]]+)\]\(([^()\s]+)\)/g;
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/**
 * Renders the supported markdown subset to safe HTML.
 *
 * The input is never treated as HTML: text segments are escaped, and the only tags in the output
 * are the ones this renderer emits. Links are limited to http/https/mailto.
 */
export function renderMarkdownSubset(source: string): MarkdownRenderResult {
  const warnings: string[] = [];
  const normalized = stripControlChars(source).replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let links = 0;

  const renderInlineText = (raw: string): string =>
    renderInline(raw, {
      onInvalidLink: (url) => {
        warnings.push(`tautan markdown diabaikan karena skema tidak diizinkan: ${truncate(url)}`);
      },
      onLink: () => {
        links += 1;
      },
    });

  const flushParagraph = (): void => {
    if (paragraph.length === 0) {
      return;
    }

    blocks.push(`<p>${renderInlineText(paragraph.join(' '))}</p>`);
    paragraph = [];
  };

  const flushList = (): void => {
    if (list === null) {
      return;
    }

    const tag = list.ordered ? 'ol' : 'ul';
    const items = list.items.map((item) => `<li>${renderInlineText(item)}</li>`).join('');
    blocks.push(`<${tag}>${items}</${tag}>`);
    list = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.trim().length === 0) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line.trim());

    if (heading !== null) {
      flushParagraph();
      flushList();
      const level = Math.min((heading[1]?.length ?? 1) + 2, 5);
      blocks.push(`<h${level}>${renderInlineText(heading[2] ?? '')}</h${level}>`);
      continue;
    }

    const unordered = /^\s*[-*]\s+(.+)$/.exec(line);
    const ordered = /^\s*\d+\.\s+(.+)$/.exec(line);

    if (unordered !== null || ordered !== null) {
      flushParagraph();
      const isOrdered = ordered !== null;

      if (list !== null && list.ordered !== isOrdered) {
        flushList();
      }

      if (list === null) {
        list = { ordered: isOrdered, items: [] };
      }

      list.items.push((unordered?.[1] ?? ordered?.[1] ?? '').trim());
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }

  flushParagraph();
  flushList();

  if (links > MAX_MARKDOWN_LINKS) {
    warnings.push(`markdown memuat lebih dari ${MAX_MARKDOWN_LINKS} tautan`);
  }

  return {
    html: blocks.join('\n'),
    text: markdownToPlainText(source),
    warnings,
  };
}

/** Strips markdown markers so clients that only know `body` still show readable text. */
export function markdownToPlainText(source: string): string {
  return stripControlChars(source)
    .replace(/\r\n?/g, '\n')
    .replace(/`([^`]+)`/g, '$1')
    .replace(LINK_PATTERN, '$1')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*(?:[-*]|\d+\.)[ \t]+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Validation used by save/publish/preview; render-time warnings are separate. */
export function validateMarkdownSubset(
  source: string,
  path: string,
): TemplateValidationIssue[] {
  const issues: TemplateValidationIssue[] = [];

  if (RAW_HTML_TAG.test(source)) {
    issues.push({
      code: 'markdown_raw_html',
      path,
      message: 'markdown tidak boleh memuat tag HTML mentah',
      severity: 'error',
    });
  }

  if (CONTROL_CHARS.test(source)) {
    issues.push({
      code: 'markdown_control_char',
      path,
      message: 'markdown memuat karakter kontrol yang tidak didukung',
      severity: 'error',
    });
  }

  const lines = stripControlChars(source).replace(/\r\n?/g, '\n').split('\n');

  if (lines.length > MAX_MARKDOWN_LINES) {
    issues.push({
      code: 'markdown_too_many_lines',
      path,
      message: `markdown maksimum ${MAX_MARKDOWN_LINES} baris`,
      severity: 'error',
    });
  }

  const links = [...source.matchAll(LINK_PATTERN)];

  if (links.length > MAX_MARKDOWN_LINKS) {
    issues.push({
      code: 'markdown_too_many_links',
      path,
      message: `markdown maksimum ${MAX_MARKDOWN_LINKS} tautan`,
      severity: 'error',
    });
  }

  for (const link of links) {
    const url = link[2] ?? '';

    if (sanitizeLink(url) === null) {
      issues.push({
        code: 'markdown_unsafe_link',
        path,
        message: `tautan markdown hanya boleh http/https/mailto: ${truncate(url)}`,
        severity: 'error',
      });
    }
  }

  return issues;
}

interface InlineHandlers {
  onLink: () => void;
  onInvalidLink: (url: string) => void;
}

function renderInline(raw: string, handlers: InlineHandlers): string {
  const tokens: string[] = [];
  let text = raw.replace(/`([^`]+)`/g, (_match, code: string) => {
    tokens.push(`<code>${escapeHtml(code)}</code>`);
    return placeholder(tokens.length - 1);
  });

  text = text.replace(LINK_PATTERN, (match, label: string, url: string) => {
    const safe = sanitizeLink(url);

    if (safe === null) {
      handlers.onInvalidLink(url);
      return label;
    }

    handlers.onLink();
    tokens.push(
      `<a href="${escapeHtml(safe)}" rel="noopener noreferrer">${escapeHtml(label)}</a>`,
    );
    return placeholder(tokens.length - 1);
  });

  text = escapeHtml(text);
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');

  return text.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => {
    return tokens[Number(index)] ?? '';
  });
}

function sanitizeLink(raw: string): string | null {
  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    return null;
  }

  try {
    const url = new URL(trimmed);

    if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
      return null;
    }

    return trimmed;
  } catch {
    return null;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function placeholder(index: number): string {
  return `\u0000${index}\u0000`;
}

function stripControlChars(value: string): string {
  return value.replace(new RegExp(CONTROL_CHARS.source, 'g'), '');
}

function truncate(value: string): string {
  return value.length <= 120 ? value : `${value.slice(0, 117)}...`;
}
