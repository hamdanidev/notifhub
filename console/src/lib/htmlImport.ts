import type { EmailBlock, EmailBlockDocument } from './emailBlocks';

/**
 * Conservative HTML → `builderData` importer for the visual email builder.
 *
 * The subset is intentionally small: headings, paragraphs/text, images, standalone links as
 * buttons, and dividers. CSS is never imported; the builder regenerates styling from its own
 * inline styles plus the selected theme. Every dropped or transformed construct produces a
 * reported issue so nothing is lost silently.
 *
 * Parsing runs in the browser with `DOMParser`: the resulting document is inert (no scripts, no
 * resource loading) and only `textContent` / whitelisted attributes are read. Never assign the
 * imported HTML to `innerHTML`/`dangerouslySetInnerHTML`.
 */

export const IMPORT_MAX_INPUT_BYTES = 262_144;
export const IMPORT_MAX_NODES = 5_000;

const MAX_BLOCKS = 200;
const MAX_DOCUMENT_BYTES = 65_536;
const MAX_TEXT = 10_000;
const MAX_LABEL = 500;
const MAX_ALT = 500;
const MAX_URL = 2_048;
const MIN_IMAGE_WIDTH = 80;
const MAX_IMAGE_WIDTH = 600;
const DEFAULT_IMAGE_WIDTH = 552;

const TOKEN_PATTERN = /^\{\{\s*[a-zA-Z_][a-zA-Z0-9_.]*\s*\}\}$/;
const HANDLEBARS_BLOCK_PATTERN = /\{\{\s*(?:[#^/>!]|else\b)/;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const CONDITIONAL_COMMENT_PATTERN = /\[if\s|\[endif\]/i;
const COMMENT_NODE = 128;

const UNSAFE_TAGS = new Set([
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
  'video',
  'audio',
  'canvas',
  'source',
  'track',
]);

const CONTAINER_TAGS = new Set([
  'div',
  'section',
  'article',
  'header',
  'footer',
  'main',
  'center',
  'figure',
  'figcaption',
  'td',
  'th',
  'tr',
  'tbody',
  'thead',
  'tfoot',
]);

const INLINE_TAGS = new Set([
  'strong',
  'em',
  'code',
  'span',
  'font',
  'b',
  'i',
  'u',
  'small',
  'label',
  'abbr',
  'sub',
  'sup',
  'mark',
  's',
  'strike',
  'del',
  'ins',
  'big',
  'tt',
  'time',
  'var',
  'kbd',
  'samp',
  'q',
  'cite',
  'dfn',
  'bdi',
  'bdo',
  'wbr',
]);

const FORMATTING_TAGS = new Set([...INLINE_TAGS]);

/** Block-level HTML we deliberately refuse instead of guessing a mapping. */
const UNSUPPORTED_BLOCK_TAGS = new Set([
  'blockquote',
  'pre',
  'address',
  'aside',
  'nav',
  'dl',
  'dt',
  'dd',
  'details',
  'summary',
  'fieldset',
  'legend',
  'hgroup',
  'menu',
  'dir',
  'template',
  'slot',
  'picture',
  'map',
  'area',
  'marquee',
  'frameset',
]);

const READ_STYLE_PROPERTIES = new Set([
  'text-align',
  'width',
  'max-width',
  'display',
  'visibility',
  'opacity',
  'max-height',
  'mso-hide',
]);

const BLOCK_DESCENDANT_SELECTOR = [
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'div',
  'section',
  'article',
  'header',
  'footer',
  'main',
  'center',
  'figure',
  'figcaption',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'ul',
  'ol',
  'li',
  'blockquote',
  'video',
  'audio',
  'canvas',
  'script',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'style',
  'link',
  'base',
  'svg',
  'math',
].join(',');

export interface HtmlImportOptions {
  /** Maximum size of the pasted/read HTML in UTF-8 bytes. Default 262_144. */
  maxInputBytes?: number;
  /** Maximum number of elements traversed. Default 5_000. */
  maxNodes?: number;
}

export interface HtmlImportIssue {
  code: string;
  severity: 'error' | 'warning';
  element?: string;
  path: string;
  message: string;
}

export interface HtmlImportSummary {
  blocks: number;
  byType: Partial<Record<EmailBlock['type'], number>>;
  droppedCssRules: number;
  droppedStyleAttributes: number;
  ignoredElements: number;
  bytes: number;
}

export interface HtmlImportResult {
  document: EmailBlockDocument | null;
  issues: HtmlImportIssue[];
  summary: HtmlImportSummary;
}

interface CollectedInline {
  text: string;
  formatting: boolean;
  links: string[];
}

interface ImportContext {
  issues: HtmlImportIssue[];
  summary: HtmlImportSummary;
  blocks: EmailBlock[];
  counter: number;
  styleCounted: WeakSet<Element>;
  blockLimitReported: boolean;
}

export function importHtmlToBlocks(
  html: string,
  options: HtmlImportOptions = {},
): HtmlImportResult {
  const summary = emptySummary();
  const issues: HtmlImportIssue[] = [];
  const maxInputBytes = options.maxInputBytes ?? IMPORT_MAX_INPUT_BYTES;
  const maxNodes = options.maxNodes ?? IMPORT_MAX_NODES;

  if (typeof html !== 'string') {
    issues.push(errorIssue('import_invalid_input', 'input', 'HTML harus berupa string.'));
    return { document: null, issues, summary };
  }

  const inputBytes = utf8ByteLength(html);

  if (inputBytes > maxInputBytes) {
    issues.push(
      errorIssue(
        'import_input_too_large',
        'input',
        `HTML ${inputBytes} byte melebihi batas ${maxInputBytes} byte.`,
      ),
    );
    return { document: null, issues, summary };
  }

  if (html.trim().length === 0) {
    issues.push(errorIssue('import_no_blocks', 'body', 'HTML kosong; tidak ada yang dapat diimpor.'));
    return { document: null, issues, summary };
  }

  if (typeof DOMParser === 'undefined') {
    issues.push(
      errorIssue('import_parser_unavailable', 'input', 'DOMParser tidak tersedia di lingkungan ini.'),
    );
    return { document: null, issues, summary };
  }

  let parsed: Document;

  try {
    parsed = new DOMParser().parseFromString(html, 'text/html');
  } catch {
    issues.push(errorIssue('import_parse_failed', 'input', 'HTML tidak dapat diparse.'));
    return { document: null, issues, summary };
  }

  const body = parsed.body;

  if (body === null) {
    issues.push(errorIssue('import_parse_failed', 'body', 'HTML tidak memiliki body yang dapat dibaca.'));
    return { document: null, issues, summary };
  }

  const elementCount = body.querySelectorAll('*').length;

  if (elementCount > maxNodes) {
    issues.push(
      errorIssue(
        'import_too_many_nodes',
        'body',
        `HTML memiliki ${elementCount} elemen, melebihi batas ${maxNodes}.`,
      ),
    );
    return { document: null, issues, summary };
  }

  // CSS is never imported: count the rules we are about to drop.
  const styleTexts = [
    ...Array.from(parsed.head.querySelectorAll('style')),
    ...Array.from(body.querySelectorAll('style')),
  ].map((element) => element.textContent ?? '');

  summary.droppedCssRules = styleTexts.reduce(
    (total, text) => total + countOccurrences(text, '{'),
    0,
  );

  if (summary.droppedCssRules > 0) {
    issues.push(
      warningIssue(
        'import_css_dropped',
        'style',
        `${summary.droppedCssRules} aturan CSS dibuang; builder memakai theme dan inline style sendiri.`,
      ),
    );
  }

  collectCommentIssues(body, issues, summary);

  for (const element of Array.from(body.querySelectorAll('*'))) {
    const tag = element.tagName.toLowerCase();

    if (!UNSAFE_TAGS.has(tag)) {
      continue;
    }

    issues.push(
      errorIssue('import_unsafe_element', elementPath(element), `Elemen <${tag}> tidak diizinkan.`),
    );
  }

  const context: ImportContext = {
    issues,
    summary,
    blocks: [],
    counter: 0,
    styleCounted: new WeakSet<Element>(),
    blockLimitReported: false,
  };

  if (!hasErrors(issues)) {
    walkNodes(context, Array.from(body.childNodes), 'body');
  }

  summary.blocks = context.blocks.length;
  summary.byType = countTypes(context.blocks);

  if (!hasErrors(issues) && context.blocks.length === 0) {
    issues.push(
      errorIssue(
        'import_no_blocks',
        'body',
        'Tidak ada heading, paragraf, gambar, tombol, atau divider yang dapat diimpor.',
      ),
    );
  }

  if (hasErrors(issues)) {
    return { document: null, issues, summary };
  }

  const document: EmailBlockDocument = { version: 1, blocks: context.blocks };
  const bytes = utf8ByteLength(JSON.stringify(document));
  summary.bytes = bytes;

  if (bytes > MAX_DOCUMENT_BYTES) {
    issues.push(
      errorIssue(
        'import_document_too_large',
        'builderData',
        `builderData ${bytes} byte melebihi batas ${MAX_DOCUMENT_BYTES} byte.`,
      ),
    );

    return { document: null, issues, summary };
  }

  return { document, issues, summary };
}

function walkNodes(context: ImportContext, nodes: ChildNode[], path: string): void {
  let buffer: string[] = [];
  let formatting = false;
  let links: string[] = [];

  const flush = (): void => {
    if (buffer.length === 0) {
      formatting = false;
      links = [];
      return;
    }

    const collected: CollectedInline = {
      text: buffer.join(''),
      formatting,
      links,
    };

    buffer = [];
    formatting = false;
    links = [];

    // Whitespace-only text between tags is indentation, not content: skip it without
    // counting an ignored element.
    if (normalizeBlockText(collected.text).length === 0) {
      return;
    }

    pushTextBlock(context, collected, path);
  };

  for (const node of nodes) {
    if (node.nodeType === 3) {
      buffer.push(node.nodeValue ?? '');
      continue;
    }

    if (node.nodeType !== 1) {
      continue;
    }

    const element = node as Element;
    const tag = element.tagName.toLowerCase();

    if (tag === 'style' || tag === 'title' || tag === 'meta' || tag === 'head') {
      continue;
    }

    if (isHidden(element)) {
      reportHidden(context, element);
      continue;
    }

    recordStyle(context, element);

    if (tag === 'br') {
      buffer.push('\n');
      continue;
    }

    if (tag === 'img') {
      flush();
      pushImage(context, element);
      continue;
    }

    if (tag === 'a') {
      const image = singleImageChild(element);

      if (image !== null) {
        flush();
        const href = (element.getAttribute('href') ?? '').trim();

        if (href.length > 0) {
          context.issues.push(
            warningIssue(
              'import_image_link_dropped',
              elementPath(element),
              `Link pada gambar dibuang (${truncate(href, 120)}); tambahkan block tombol bila perlu.`,
            ),
          );
        }

        pushImage(context, image);
        continue;
      }

      if (hasBlockContent(element)) {
        flush();
        walkNodes(context, Array.from(element.childNodes), elementPath(element));
        continue;
      }

      const parent = element.parentElement;

      if (parent !== null && standaloneAnchor(parent) === element) {
        // A lone anchor at the top level is a call-to-action, not inline text.
        flush();
        pushButton(context, element, textAlignOf(parent));
        continue;
      }

      const collected = collectInline(context, element);
      buffer.push(collected.text);
      formatting = formatting || collected.formatting;
      links = [...links, ...collected.links];
      continue;
    }

    if (tag === 'hr') {
      flush();
      pushDivider(context);
      continue;
    }

    if (isHeading(tag)) {
      flush();
      pushHeading(context, element, tag);
      continue;
    }

    if (tag === 'p') {
      flush();
      pushParagraph(context, element);
      continue;
    }

    if (tag === 'ul' || tag === 'ol' || tag === 'li') {
      flush();
      context.issues.push(
        errorIssue(
          'import_list_unsupported',
          elementPath(element),
          `Daftar <${tag}> tidak didukung; impor dibatalkan.`,
        ),
      );
      continue;
    }

    if (tag === 'table') {
      flush();
      pushTable(context, element);
      continue;
    }

    if (CONTAINER_TAGS.has(tag)) {
      flush();
      pushContainer(context, element);
      continue;
    }

    if (INLINE_TAGS.has(tag)) {
      if (hasBlockContent(element)) {
        flush();
        walkNodes(context, Array.from(element.childNodes), elementPath(element));
        continue;
      }

      const collected = collectInline(context, element);
      buffer.push(collected.text);
      formatting = formatting || collected.formatting;
      links = [...links, ...collected.links];
      continue;
    }

    if (hasBlockContent(element) || UNSUPPORTED_BLOCK_TAGS.has(tag)) {
      flush();
      context.issues.push(
        errorIssue(
          'import_unsupported_element',
          elementPath(element),
          `Elemen <${tag}> tidak didukung; impor dibatalkan.`,
        ),
      );
      continue;
    }

    collectUnknownInline(context, element, (collected) => {
      buffer.push(collected.text);
      formatting = formatting || collected.formatting;
      links = [...links, ...collected.links];
    });
  }

  flush();
}

function pushParagraph(context: ImportContext, element: Element): void {
  const anchor = standaloneAnchor(element);

  if (anchor !== null) {
    pushButton(context, anchor, textAlignOf(element));
    return;
  }

  if (isInlineOnly(element)) {
    pushTextBlock(context, collectInline(context, element), elementPath(element));
    return;
  }

  walkNodes(context, Array.from(element.childNodes), elementPath(element));
}

function pushContainer(context: ImportContext, element: Element): void {
  const anchor = standaloneAnchor(element);

  if (anchor !== null) {
    pushButton(context, anchor, textAlignOf(element));
    return;
  }

  if (isInlineOnly(element)) {
    pushTextBlock(context, collectInline(context, element), elementPath(element));
    return;
  }

  walkNodes(context, Array.from(element.childNodes), elementPath(element));
}

function pushTable(context: ImportContext, table: Element): void {
  const cells = table.querySelectorAll('td, th');

  if (cells.length > 1) {
    context.issues.push(
      errorIssue(
        'import_multi_cell_table_unsupported',
        elementPath(table),
        `Tabel dengan ${cells.length} sel tidak didukung; susun ulang sebagai block atau gunakan mode HTML.`,
      ),
    );
    context.summary.ignoredElements += 1;
    return;
  }

  const cell = cells[0];

  if (cell !== undefined) {
    pushContainer(context, cell);
    return;
  }

  walkNodes(context, Array.from(table.childNodes), elementPath(table));
}

function pushHeading(
  context: ImportContext,
  element: Element,
  tag: string,
): void {
  const rawLevel = Number(tag.slice(1));
  const level = (rawLevel >= 2 ? (rawLevel >= 3 ? 3 : 2) : 1) as 1 | 2 | 3;

  if (rawLevel > 3) {
    context.issues.push(
      warningIssue(
        'import_heading_level_clamped',
        elementPath(element),
        `<${tag}> diubah menjadi heading level 3 (schema hanya mendukung level 1–3).`,
      ),
    );
  }

  const collected = collectInline(context, element);
  const text = prepareContent(context, collected.text, elementPath(element));

  if (text === null) {
    context.summary.ignoredElements += 1;
    return;
  }

  if (text.length > MAX_TEXT) {
    context.issues.push(
      errorIssue(
        'import_text_too_long',
        elementPath(element),
        `Teks heading ${text.length} karakter melebihi batas ${MAX_TEXT}.`,
      ),
    );
    return;
  }

  reportInlineLoss(context, collected, elementPath(element));
  pushBlock(context, { id: nextId(context), type: 'heading', text, level });
}

function pushTextBlock(context: ImportContext, collected: CollectedInline, path: string): void {
  const text = prepareContent(context, collected.text, path);

  if (text === null) {
    context.summary.ignoredElements += 1;
    return;
  }

  if (text.length > MAX_TEXT) {
    context.issues.push(
      errorIssue(
        'import_text_too_long',
        path,
        `Teks ${text.length} karakter melebihi batas ${MAX_TEXT}.`,
      ),
    );
    return;
  }

  reportInlineLoss(context, collected, path);
  pushBlock(context, { id: nextId(context), type: 'text', text });
}

function pushButton(
  context: ImportContext,
  anchor: Element,
  align: 'left' | 'center' | 'right',
): void {
  const collected = collectInline(context, anchor);
  const label = prepareContent(context, collected.text, elementPath(anchor));

  if (label === null) {
    context.summary.ignoredElements += 1;
    return;
  }

  if (label.length > MAX_LABEL) {
    context.issues.push(
      errorIssue(
        'import_field_too_long',
        elementPath(anchor),
        `Label tombol ${label.length} karakter melebihi batas ${MAX_LABEL}.`,
      ),
    );
    return;
  }

  if (collected.formatting) {
    context.issues.push(
      warningIssue(
        'import_inline_formatting_dropped',
        elementPath(anchor),
        'Format inline pada label tombol dibuang.',
      ),
    );
  }

  const url = resolveUrl(context, anchor.getAttribute('href'), 'button', elementPath(anchor));

  pushBlock(context, { id: nextId(context), type: 'button', label, url, align });
}

function pushImage(context: ImportContext, image: Element): void {
  const element = elementPath(image);
  const url = resolveUrl(context, image.getAttribute('src'), 'image', element);
  const alt = normalizeAlt(image.getAttribute('alt') ?? '');

  if (alt.length > MAX_ALT) {
    context.issues.push(
      errorIssue(
        'import_field_too_long',
        element,
        `Alt gambar ${alt.length} karakter melebihi batas ${MAX_ALT}.`,
      ),
    );
    return;
  }

  pushBlock(context, {
    id: nextId(context),
    type: 'image',
    url,
    alt,
    width: imageWidth(image),
  });
}

function pushDivider(context: ImportContext): void {
  pushBlock(context, { id: nextId(context), type: 'divider' });
}

function pushBlock(context: ImportContext, block: EmailBlock): void {
  if (context.blocks.length >= MAX_BLOCKS) {
    if (!context.blockLimitReported) {
      context.blockLimitReported = true;
      context.issues.push(
        errorIssue(
          'import_block_limit',
          'builderData.blocks',
          `Hasil impor melebihi batas ${MAX_BLOCKS} block.`,
        ),
      );
    }

    return;
  }

  context.blocks.push(block);
}

function collectInline(context: ImportContext, node: Node): CollectedInline {
  const collected: CollectedInline = { text: '', formatting: false, links: [] };
  visitInline(context, node, collected);

  return collected;
}

function visitInline(context: ImportContext, node: Node, collected: CollectedInline): void {
  if (node.nodeType === 3) {
    collected.text += node.nodeValue ?? '';
    return;
  }

  if (node.nodeType !== 1) {
    return;
  }

  const element = node as Element;
  const tag = element.tagName.toLowerCase();

  if (isHidden(element)) {
    reportHidden(context, element);
    return;
  }

  recordStyle(context, element);

  if (tag === 'br') {
    collected.text += '\n';
    return;
  }

  if (tag === 'img') {
    collected.text += element.getAttribute('alt') ?? '';
    return;
  }

  if (tag === 'a') {
    collected.links.push((element.getAttribute('href') ?? '').trim());
  }

  if (FORMATTING_TAGS.has(tag)) {
    collected.formatting = true;
  }

  for (const child of Array.from(element.childNodes)) {
    visitInline(context, child, collected);
  }
}

function collectUnknownInline(
  context: ImportContext,
  element: Element,
  apply: (collected: CollectedInline) => void,
): void {
  context.issues.push(
    warningIssue(
      'import_unknown_inline_flattened',
      elementPath(element),
      `Elemen <${element.tagName.toLowerCase()}> tidak dikenal; hanya teksnya yang diimpor.`,
    ),
  );
  apply(collectInline(context, element));
}

function prepareContent(
  context: ImportContext,
  raw: string,
  path: string,
): string | null {
  const text = normalizeBlockText(raw);

  if (text.length === 0) {
    return null;
  }

  if (HANDLEBARS_BLOCK_PATTERN.test(text)) {
    context.issues.push(
      errorIssue(
        'import_handlebars_block_unsupported',
        path,
        'Blok/partial/komentar Handlebars tidak didukung; gunakan mode HTML.',
      ),
    );
    return null;
  }

  return text;
}

function reportInlineLoss(
  context: ImportContext,
  collected: CollectedInline,
  path: string,
): void {
  if (collected.formatting) {
    context.issues.push(
      warningIssue(
        'import_inline_formatting_dropped',
        path,
        'Format inline (tebal/miring/kode/span) dibuang; teks dipertahankan.',
      ),
    );
  }

  for (const link of collected.links) {
    if (link.length === 0) {
      continue;
    }

    context.issues.push(
      warningIssue(
        'import_inline_link_dropped',
        path,
        `Link inline dibuang (${truncate(link, 120)}); teks dipertahankan.`,
      ),
    );
  }
}

function reportHidden(context: ImportContext, element: Element): void {
  context.summary.ignoredElements += 1;
  context.issues.push(
    warningIssue(
      'import_hidden_element_skipped',
      elementPath(element),
      `Elemen <${element.tagName.toLowerCase()}> tersembunyi dan dilewati.`,
    ),
  );
}

function recordStyle(context: ImportContext, element: Element): void {
  const style = element.getAttribute('style');

  if (style === null || style.trim().length === 0) {
    return;
  }

  if (context.styleCounted.has(element)) {
    return;
  }

  context.styleCounted.add(element);

  let dropped = false;

  for (const declaration of style.split(';')) {
    const separator = declaration.indexOf(':');

    if (separator <= 0) {
      continue;
    }

    const property = declaration.slice(0, separator).trim().toLowerCase();

    if (property.length > 0 && !READ_STYLE_PROPERTIES.has(property)) {
      dropped = true;
    }
  }

  if (dropped) {
    context.summary.droppedStyleAttributes += 1;
  }
}

function resolveUrl(
  context: ImportContext,
  rawValue: string | null,
  kind: 'image' | 'button',
  path: string,
): string {
  const value = (rawValue ?? '').trim();

  if (value.length === 0) {
    context.issues.push(
      warningIssue(
        kind === 'image' ? 'import_image_src_missing' : 'import_url_unsafe',
        path,
        kind === 'image'
          ? 'Gambar tanpa src didukung builder; URL dikosongkan.'
          : 'Tombol tanpa URL http/https; URL dikosongkan.',
      ),
    );
    return '';
  }

  if (HANDLEBARS_BLOCK_PATTERN.test(value)) {
    context.issues.push(
      errorIssue(
        'import_handlebars_block_unsupported',
        path,
        'URL memuat blok/partial/komentar Handlebars; gunakan mode HTML.',
      ),
    );
    return '';
  }

  if (value.length > MAX_URL) {
    context.issues.push(
      errorIssue('import_url_too_long', path, `URL ${value.length} karakter melebihi batas ${MAX_URL}.`),
    );
    return '';
  }

  if (TOKEN_PATTERN.test(value)) {
    return value;
  }

  if (isHttpUrl(value)) {
    return value;
  }

  context.issues.push(
    warningIssue(
      'import_url_unsafe',
      path,
      `URL ${truncate(value, 120)} bukan http/https; dikosongkan.`,
    ),
  );

  return '';
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);

    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function imageWidth(image: Element): string {
  const style = parseStyle(image.getAttribute('style'));
  const candidates = [
    image.getAttribute('width') ?? undefined,
    style['width'],
    style['max-width'],
  ];

  for (const candidate of candidates) {
    if (candidate === undefined) {
      continue;
    }

    const match = /^(\d{1,4})(?:px)?$/i.exec(candidate.trim());
    const digits = match?.[1];

    if (digits === undefined) {
      continue;
    }

    const parsed = Number(digits);

    if (Number.isFinite(parsed)) {
      return String(Math.min(MAX_IMAGE_WIDTH, Math.max(MIN_IMAGE_WIDTH, Math.round(parsed))));
    }
  }

  return String(DEFAULT_IMAGE_WIDTH);
}

function textAlignOf(element: Element): 'left' | 'center' | 'right' {
  let current: Element | null = element;

  while (current !== null) {
    const style = parseStyle(current.getAttribute('style'));
    const value = style['text-align']?.toLowerCase();

    if (value === 'center' || value === 'right' || value === 'left') {
      return value;
    }

    if (current.tagName.toLowerCase() === 'body') {
      break;
    }

    current = current.parentElement;
  }

  return 'left';
}

function parseStyle(value: string | null): Record<string, string> {
  const result: Record<string, string> = {};

  if (value === null || value.length === 0) {
    return result;
  }

  for (const declaration of value.split(';')) {
    const separator = declaration.indexOf(':');

    if (separator <= 0) {
      continue;
    }

    const property = declaration.slice(0, separator).trim().toLowerCase();
    const parsed = declaration
      .slice(separator + 1)
      .replace(/!important/gi, '')
      .trim();

    if (property.length > 0 && parsed.length > 0) {
      result[property] = parsed;
    }
  }

  return result;
}

function isHidden(element: Element): boolean {
  if (element.hasAttribute('hidden')) {
    return true;
  }

  const style = parseStyle(element.getAttribute('style'));
  const display = style['display']?.toLowerCase();

  if (display === 'none') {
    return true;
  }

  const visibility = style['visibility']?.toLowerCase();

  if (visibility === 'hidden' || visibility === 'collapse') {
    return true;
  }

  const opacity = style['opacity'];

  if (opacity !== undefined && Number(opacity) === 0) {
    return true;
  }

  const maxHeight = style['max-height']?.toLowerCase();

  if (maxHeight === '0' || maxHeight === '0px') {
    return true;
  }

  const msoHide = style['mso-hide']?.toLowerCase();

  return msoHide === 'all';
}

function isInlineOnly(element: Element): boolean {
  return !hasBlockContent(element);
}

function hasBlockContent(element: Element): boolean {
  return (
    element.querySelector(BLOCK_DESCENDANT_SELECTOR) !== null ||
    element.querySelector('img') !== null
  );
}

function meaningfulChildren(element: Element): Node[] {
  return Array.from(element.childNodes).filter((child) => {
    if (child.nodeType === 1) {
      return true;
    }

    if (child.nodeType === 3) {
      return (child.nodeValue ?? '').trim().length > 0;
    }

    return false;
  });
}

function standaloneAnchor(element: Element): Element | null {
  const children = meaningfulChildren(element);

  if (children.length !== 1) {
    return null;
  }

  const only = children[0];

  if (only === undefined || only.nodeType !== 1) {
    return null;
  }

  const candidate = only as Element;

  if (candidate.tagName.toLowerCase() !== 'a') {
    return null;
  }

  if (singleImageChild(candidate) !== null) {
    return null;
  }

  if ((candidate.textContent ?? '').trim().length === 0) {
    return null;
  }

  return candidate;
}

function singleImageChild(element: Element): Element | null {
  const children = meaningfulChildren(element);

  if (children.length !== 1) {
    return null;
  }

  const only = children[0];

  if (only === undefined || only.nodeType !== 1) {
    return null;
  }

  const candidate = only as Element;

  return candidate.tagName.toLowerCase() === 'img' ? candidate : null;
}

function isHeading(tag: string): boolean {
  return tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6';
}

function normalizeBlockText(value: string): string {
  const withoutControls = value.replace(CONTROL_CHARACTERS, '');
  const normalizedNewlines = withoutControls.replace(/\r\n?/g, '\n');
  const collapsed = normalizedNewlines.replace(/[^\S\n]+/g, ' ');

  return collapsed
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeAlt(value: string): string {
  return value.replace(CONTROL_CHARACTERS, '').replace(/\s+/g, ' ').trim();
}

function elementPath(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;

  while (current !== null) {
    const tag = current.tagName.toLowerCase();

    if (tag === 'html' || tag === 'body') {
      break;
    }

    const parent: Element | null = current.parentElement;

    if (parent === null) {
      break;
    }

    const siblings = Array.from(parent.children);
    parts.unshift(`${tag}:nth-child(${siblings.indexOf(current) + 1})`);
    current = parent;
  }

  return ['body', ...parts].join(' > ');
}

function collectCommentIssues(
  body: HTMLElement,
  issues: HtmlImportIssue[],
  summary: HtmlImportSummary,
): void {
  const walker = body.ownerDocument.createTreeWalker(body, COMMENT_NODE);
  let plain = 0;
  let node = walker.nextNode();

  while (node !== null) {
    const text = node.nodeValue ?? '';

    if (CONDITIONAL_COMMENT_PATTERN.test(text)) {
      issues.push(
        warningIssue(
          'import_conditional_comment_dropped',
          'body',
          'Komentar kondisional (MSO) dibuang; layout email tidak diimpor.',
        ),
      );
    } else {
      plain += 1;
    }

    node = walker.nextNode();
  }

  if (plain > 0) {
    summary.ignoredElements += plain;
    issues.push(
      warningIssue(
        'import_comment_dropped',
        'body',
        `${plain} komentar HTML dibuang.`,
      ),
    );
  }
}

function countOccurrences(value: string, needle: string): number {
  let count = 0;

  for (const character of value) {
    if (character === needle) {
      count += 1;
    }
  }

  return count;
}

function countTypes(blocks: EmailBlock[]): Partial<Record<EmailBlock['type'], number>> {
  const counts: Partial<Record<EmailBlock['type'], number>> = {};

  for (const block of blocks) {
    counts[block.type] = (counts[block.type] ?? 0) + 1;
  }

  return counts;
}

function nextId(context: ImportContext): string {
  context.counter += 1;
  const suffix =
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const id = `imp-${context.counter}-${suffix}`;

  return id.length <= 64 ? id : id.slice(0, 64);
}

function hasErrors(issues: HtmlImportIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'error');
}

function emptySummary(): HtmlImportSummary {
  return {
    blocks: 0,
    byType: {},
    droppedCssRules: 0,
    droppedStyleAttributes: 0,
    ignoredElements: 0,
    bytes: 0,
  };
}

function errorIssue(
  code: string,
  path: string,
  message: string,
  element?: string,
): HtmlImportIssue {
  return element === undefined
    ? { code, severity: 'error', path, message }
    : { code, severity: 'error', path, message, element };
}

function warningIssue(
  code: string,
  path: string,
  message: string,
  element?: string,
): HtmlImportIssue {
  return element === undefined
    ? { code, severity: 'warning', path, message }
    : { code, severity: 'warning', path, message, element };
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}
