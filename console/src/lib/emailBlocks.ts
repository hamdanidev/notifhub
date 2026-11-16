import { escapeHtml } from './emailDesign';

export type EmailBlockType =
  | 'heading'
  | 'text'
  | 'image'
  | 'button'
  | 'divider'
  | 'spacer'
  | 'columns';

export interface EmailBlockBase {
  id: string;
  type: EmailBlockType;
}

export interface HeadingBlock extends EmailBlockBase {
  type: 'heading';
  text: string;
  level: 1 | 2 | 3;
}

export interface TextBlock extends EmailBlockBase {
  type: 'text';
  text: string;
}

export interface ImageBlock extends EmailBlockBase {
  type: 'image';
  url: string;
  alt: string;
  width: string;
}

export interface ButtonBlock extends EmailBlockBase {
  type: 'button';
  label: string;
  url: string;
  align: 'left' | 'center' | 'right';
}

export interface DividerBlock extends EmailBlockBase {
  type: 'divider';
}

export interface SpacerBlock extends EmailBlockBase {
  type: 'spacer';
  height: string;
}

export interface ColumnsBlock extends EmailBlockBase {
  type: 'columns';
  left: string;
  right: string;
}

export type EmailBlock =
  | HeadingBlock
  | TextBlock
  | ImageBlock
  | ButtonBlock
  | DividerBlock
  | SpacerBlock
  | ColumnsBlock;

export interface EmailBlockDocument {
  version: 1;
  blocks: EmailBlock[];
}

export const BLOCK_TYPES: Array<{ type: EmailBlockType; label: string }> = [
  { type: 'heading', label: 'Heading' },
  { type: 'text', label: 'Teks' },
  { type: 'image', label: 'Gambar' },
  { type: 'button', label: 'Tombol' },
  { type: 'divider', label: 'Divider' },
  { type: 'spacer', label: 'Spacer' },
  { type: 'columns', label: 'Dua kolom' },
];

export function createBlock(type: EmailBlockType): EmailBlock {
  const id = createId();

  switch (type) {
    case 'heading':
      return { id, type, text: 'Judul email', level: 1 };
    case 'text':
      return { id, type, text: 'Tulis isi email di sini.' };
    case 'image':
      return { id, type, url: '', alt: 'Gambar email', width: '552' };
    case 'button':
      return { id, type, label: 'Lihat detail', url: '{{cta.url}}', align: 'left' };
    case 'divider':
      return { id, type };
    case 'spacer':
      return { id, type, height: '24' };
    case 'columns':
      return { id, type, left: 'Kolom kiri', right: 'Kolom kanan' };
  }
}

export function defaultBlockDocument(): EmailBlockDocument {
  return {
    version: 1,
    blocks: [
      { id: createId(), type: 'heading', text: 'Halo {{nama}}', level: 1 },
      { id: createId(), type: 'text', text: 'Ini email dari tim kami.' },
      { id: createId(), type: 'button', label: 'Lihat detail', url: '{{cta.url}}', align: 'left' },
    ],
  };
}

const BLOCK_KEYS: Record<EmailBlockType, readonly string[]> = {
  heading: ['id', 'type', 'text', 'level'],
  text: ['id', 'type', 'text'],
  image: ['id', 'type', 'url', 'alt', 'width'],
  button: ['id', 'type', 'label', 'url', 'align'],
  divider: ['id', 'type'],
  spacer: ['id', 'type', 'height'],
  columns: ['id', 'type', 'left', 'right'],
};

export function parseBlockDocument(value: unknown): EmailBlockDocument | null {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.blocks)) {
    return null;
  }

  const blocks: EmailBlock[] = [];
  const seen = new Set<string>();

  for (const raw of value.blocks) {
    const block = parseBlock(raw);

    if (
      block === null ||
      seen.has(block.id) ||
      !isRecord(raw) ||
      !hasOnlyKnownKeys(raw, block.type)
    ) {
      // Never silently drop blocks: an unparseable document is opened in HTML mode so the
      // original body and builderData remain untouched.
      return null;
    }

    seen.add(block.id);
    blocks.push(block);
  }

  return { version: 1, blocks };
}

export function renderBlocksToHtml(document: EmailBlockDocument): string {
  return document.blocks.map(renderBlock).join('\n');
}

export function moveBlock<T>(items: T[], from: number, to: number): T[] {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= items.length ||
    to >= items.length
  ) {
    return items;
  }

  const next = [...items];
  const [current] = next.splice(from, 1);

  if (current === undefined) {
    return items;
  }

  next.splice(to, 0, current);

  return next;
}

export function blockLabel(type: EmailBlockType): string {
  return BLOCK_TYPES.find((item) => item.type === type)?.label ?? type;
}

function renderBlock(block: EmailBlock): string {
  switch (block.type) {
    case 'heading': {
      const tag = block.level === 1 ? 'h1' : block.level === 2 ? 'h2' : 'h3';
      const size =
        block.level === 1 ? '26px' : block.level === 2 ? '21px' : '17px';

      return `<${tag} style="margin:0 0 12px;font-family:{{default theme.font.family "Arial, Helvetica, sans-serif"}};font-size:${size};line-height:1.3;color:{{default theme.text.primary "#111827"}}">${multiline(block.text)}</${tag}>`;
    }
    case 'text':
      return `<p style="margin:0 0 16px;font-family:{{default theme.font.family "Arial, Helvetica, sans-serif"}};font-size:{{default theme.font.sizeBase "15px"}};line-height:1.6;color:{{default theme.text.primary "#111827"}}">${multiline(block.text)}</p>`;
    case 'image': {
      const src = safeResourceUrl(block.url);
      if (src.length === 0) {
        return `<p style="margin:0 0 16px;font-family:{{default theme.font.family "Arial, Helvetica, sans-serif"}};font-size:13px;color:{{default theme.text.muted "#6b7280"}}">[Gambar: isi URL gambar]</p>`;
      }

      const width = numericValue(block.width, 552, 80, 600);

      return `<p style="margin:0 0 16px"><img src="${escapeAttribute(src)}" alt="${escapeAttribute(block.alt)}" width="${width}" style="display:block;width:100%;max-width:${width}px;height:auto;border:0;border-radius:{{default theme.radius.md "8px"}}"></p>`;
    }
    case 'button': {
      const href = safeLinkUrl(block.url);
      const align = block.align;
      const label = multiline(block.label);

      return `<div style="margin:0 0 16px;text-align:${align}"><a href="${escapeAttribute(href)}" style="display:inline-block;padding:{{default theme.button.paddingY "12px"}} {{default theme.button.paddingX "20px"}};background:{{default theme.button.background "#0d6efd"}};color:{{default theme.button.color "#ffffff"}};border-radius:{{default theme.button.radius "6px"}};text-decoration:none;font-family:{{default theme.font.family "Arial, Helvetica, sans-serif"}};font-size:{{default theme.font.sizeBase "15px"}}">${label}</a></div>`;
    }
    case 'divider':
      return '<hr style="border:0;border-top:1px solid #e5e7eb;margin:20px 0">';
    case 'spacer': {
      const height = numericValue(block.height, 24, 4, 120);

      return `<div style="height:${height}px;line-height:${height}px;font-size:0">&nbsp;</div>`;
    }
    case 'columns':
      return (
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px">` +
        `<tr>` +
        `<td class="nh-col" width="50%" valign="top" style="width:50%;padding:0 8px 0 0;font-family:{{default theme.font.family "Arial, Helvetica, sans-serif"}};font-size:{{default theme.font.sizeBase "15px"}};line-height:1.6;color:{{default theme.text.primary "#111827"}}">${multiline(block.left)}</td>` +
        `<td class="nh-col" width="50%" valign="top" style="width:50%;padding:0 0 0 8px;font-family:{{default theme.font.family "Arial, Helvetica, sans-serif"}};font-size:{{default theme.font.sizeBase "15px"}};line-height:1.6;color:{{default theme.text.primary "#111827"}}">${multiline(block.right)}</td>` +
        `</tr></table>`
      );
  }
}

function parseBlock(value: unknown): EmailBlock | null {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return null;
  }

  const id = typeof value.id === 'string' && value.id.length > 0 ? value.id : null;

  if (id === null) {
    return null;
  }

  const type = value.type;

  if (type === 'heading') {
    const level = value.level === 2 ? 2 : value.level === 3 ? 3 : 1;
    return {
      id,
      type,
      text: stringValue(value.text, 'Judul email'),
      level,
    };
  }

  if (type === 'text') {
    return { id, type, text: stringValue(value.text, '') };
  }

  if (type === 'image') {
    return {
      id,
      type,
      url: stringValue(value.url, ''),
      alt: stringValue(value.alt, ''),
      width: stringValue(value.width, '552'),
    };
  }

  if (type === 'button') {
    return {
      id,
      type,
      label: stringValue(value.label, 'Lihat detail'),
      url: stringValue(value.url, '{{cta.url}}'),
      align: value.align === 'center' || value.align === 'right' ? value.align : 'left',
    };
  }

  if (type === 'divider') {
    return { id, type };
  }

  if (type === 'spacer') {
    return { id, type, height: stringValue(value.height, '24') };
  }

  if (type === 'columns') {
    return {
      id,
      type,
      left: stringValue(value.left, ''),
      right: stringValue(value.right, ''),
    };
  }

  return null;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function hasOnlyKnownKeys(
  raw: Record<string, unknown>,
  type: EmailBlockType,
): boolean {
  const allowed = BLOCK_KEYS[type];

  return Object.keys(raw).every((key) => allowed.includes(key));
}

function multiline(value: string): string {
  return escapeHtml(value).replace(/\n/g, '<br>');
}

function safeLinkUrl(value: string): string {
  const trimmed = value.trim();

  if (/^\{\{\s*[a-zA-Z_][a-zA-Z0-9_.]*\s*\}\}$/.test(trimmed)) {
    return trimmed;
  }

  return safeHttp(trimmed) ?? '#';
}

function safeResourceUrl(value: string): string {
  const trimmed = value.trim();

  if (/^\{\{\s*[a-zA-Z_][a-zA-Z0-9_.]*\s*\}\}$/.test(trimmed)) {
    return trimmed;
  }

  return safeHttp(trimmed) ?? '';
}

function safeHttp(value: string): string | null {
  if (value.length === 0) {
    return null;
  }

  try {
    const url = new URL(value);

    return url.protocol === 'http:' || url.protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

function numericValue(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  const valid = Number.isFinite(parsed) ? parsed : fallback;

  return Math.min(max, Math.max(min, Math.round(valid)));
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
