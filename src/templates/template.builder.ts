import { Channel } from '@prisma/client';
import type { TemplateValidationIssue } from './template.types';

/**
 * Server-side contract for the visual email builder document.
 *
 * The console owns HTML rendering; this module only validates and normalizes the JSON that is
 * stored beside `body`. Strict validation is intentional: a document that cannot round-trip
 * through the editor must not be persisted. The worker never reads this data.
 */

export const BUILDER_VERSION = 1;
export const BUILDER_MAX_BLOCKS = 200;
export const BUILDER_MAX_BYTES = 65_536;
export const BUILDER_MAX_TEXT = 10_000;
export const BUILDER_MAX_COLUMN_TEXT = 5_000;
export const BUILDER_MAX_LABEL = 500;
export const BUILDER_MAX_ALT = 500;
export const BUILDER_MAX_URL = 2_048;

const BLOCK_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const TEMPLATE_TOKEN_PATTERN = /^\{\{\s*[a-zA-Z_][a-zA-Z0-9_.]*\s*\}\}$/;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export type BuilderBlockType =
  | 'heading'
  | 'text'
  | 'image'
  | 'button'
  | 'divider'
  | 'spacer'
  | 'columns';

export interface BuilderHeadingBlock {
  id: string;
  type: 'heading';
  text: string;
  level: 1 | 2 | 3;
}

export interface BuilderTextBlock {
  id: string;
  type: 'text';
  text: string;
}

export interface BuilderImageBlock {
  id: string;
  type: 'image';
  url: string;
  alt: string;
  width: string;
}

export interface BuilderButtonBlock {
  id: string;
  type: 'button';
  label: string;
  url: string;
  align: 'left' | 'center' | 'right';
}

export interface BuilderDividerBlock {
  id: string;
  type: 'divider';
}

export interface BuilderSpacerBlock {
  id: string;
  type: 'spacer';
  height: string;
}

export interface BuilderColumnsBlock {
  id: string;
  type: 'columns';
  left: string;
  right: string;
}

export type BuilderBlock =
  | BuilderHeadingBlock
  | BuilderTextBlock
  | BuilderImageBlock
  | BuilderButtonBlock
  | BuilderDividerBlock
  | BuilderSpacerBlock
  | BuilderColumnsBlock;

export interface BuilderDocument {
  version: 1;
  blocks: BuilderBlock[];
}

export interface BuilderParseResult {
  document: BuilderDocument | null;
  issues: TemplateValidationIssue[];
}

const BLOCK_KEYS: Record<BuilderBlockType, readonly string[]> = {
  heading: ['id', 'type', 'text', 'level'],
  text: ['id', 'type', 'text'],
  image: ['id', 'type', 'url', 'alt', 'width'],
  button: ['id', 'type', 'label', 'url', 'align'],
  divider: ['id', 'type'],
  spacer: ['id', 'type', 'height'],
  columns: ['id', 'type', 'left', 'right'],
};

/**
 * Validates `builderData` for a channel and returns a normalized document.
 * An empty document (`null`/`undefined`) is valid for every channel.
 */
export function parseBuilderDocument(channel: Channel, value: unknown): BuilderParseResult {
  if (value === null || value === undefined) {
    return { document: null, issues: [] };
  }

  if (channel !== Channel.email) {
    return {
      document: null,
      issues: [
        issue(
          'builder_channel_mismatch',
          'builderData',
          `builderData hanya didukung untuk channel email, bukan ${channel}`,
        ),
      ],
    };
  }

  if (!isRecord(value)) {
    return {
      document: null,
      issues: [issue('builder_invalid_document', 'builderData', 'builderData harus berupa objek JSON')],
    };
  }

  const issues: TemplateValidationIssue[] = [];

  let byteLength = 0;

  try {
    byteLength = Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return {
      document: null,
      issues: [issue('builder_invalid_document', 'builderData', 'builderData tidak dapat diserialisasi')],
    };
  }

  if (byteLength > BUILDER_MAX_BYTES) {
    issues.push(
      issue(
        'builder_too_large',
        'builderData',
        `builderData ${byteLength} byte melebihi batas ${BUILDER_MAX_BYTES} byte`,
      ),
    );
  }

  for (const key of Object.keys(value)) {
    if (key !== 'version' && key !== 'blocks') {
      issues.push(issue('builder_unknown_field', `builderData.${key}`, `field "${key}" tidak dikenal`));
    }
  }

  if (value.version !== BUILDER_VERSION) {
    issues.push(
      issue(
        'builder_unsupported_version',
        'builderData.version',
        `versi builderData harus ${BUILDER_VERSION}`,
      ),
    );
  }

  if (!Array.isArray(value.blocks)) {
    issues.push(
      issue('builder_invalid_document', 'builderData.blocks', 'blocks harus berupa array'),
    );

    return { document: null, issues };
  }

  if (value.blocks.length > BUILDER_MAX_BLOCKS) {
    issues.push(
      issue(
        'builder_too_many_blocks',
        'builderData.blocks',
        `builderData maksimum ${BUILDER_MAX_BLOCKS} block`,
      ),
    );
  }

  const blocks: BuilderBlock[] = [];
  const seenIds = new Set<string>();

  value.blocks.forEach((raw, index) => {
    const path = `builderData.blocks[${index}]`;
    const block = parseBlock(raw, path, issues);

    if (block === null) {
      return;
    }

    if (seenIds.has(block.id)) {
      issues.push(issue('builder_duplicate_id', `${path}.id`, `id block "${block.id}" duplikat`));
      return;
    }

    seenIds.add(block.id);
    blocks.push(block);
  });

  if (issues.some((item) => item.severity === 'error')) {
    return { document: null, issues };
  }

  return { document: { version: BUILDER_VERSION, blocks }, issues };
}

export function builderDocumentUsesColumns(document: BuilderDocument | null): boolean {
  return document !== null && document.blocks.some((block) => block.type === 'columns');
}

export function builderLegacyWarning(): TemplateValidationIssue {
  return {
    code: 'builder_legacy_invalid',
    path: 'builderData',
    message:
      'builderData tersimpan tidak lagi valid; template tetap dapat dipublish tetapi data builder perlu diperbaiki atau dihapus',
    severity: 'warning',
  };
}

function parseBlock(
  raw: unknown,
  path: string,
  issues: TemplateValidationIssue[],
): BuilderBlock | null {
  if (!isRecord(raw)) {
    issues.push(issue('builder_block_invalid', path, 'block harus berupa objek'));
    return null;
  }

  const type = raw.type;

  if (typeof type !== 'string' || !isBuilderBlockType(type)) {
    issues.push(
      issue(
        'builder_unknown_block_type',
        `${path}.type`,
        `tipe block tidak dikenal: ${String(type)}`,
      ),
    );
    return null;
  }

  const allowedKeys = BLOCK_KEYS[type];

  const id = readId(raw, path, issues);

  if (id === null) {
    return null;
  }

  for (const key of Object.keys(raw)) {
    if (!allowedKeys.includes(key)) {
      issues.push(
        issue('builder_unknown_field', `${path}.${key}`, `field "${key}" tidak dikenal untuk block ${type}`),
      );
    }
  }

  switch (type) {
    case 'heading': {
      const text = readString(raw, 'text', path, issues, BUILDER_MAX_TEXT);
      const level = readLevel(raw, path, issues);

      if (text === null || level === null) {
        return null;
      }

      return { id, type, text, level };
    }
    case 'text': {
      const text = readString(raw, 'text', path, issues, BUILDER_MAX_TEXT);

      return text === null ? null : { id, type, text };
    }
    case 'image': {
      const url = readUrl(raw, 'url', path, issues);
      const alt = readString(raw, 'alt', path, issues, BUILDER_MAX_ALT, '');
      const width = readDimension(raw, 'width', path, issues, 552, 80, 600);

      if (url === null || alt === null || width === null) {
        return null;
      }

      return { id, type, url, alt, width };
    }
    case 'button': {
      const label = readString(raw, 'label', path, issues, BUILDER_MAX_LABEL);
      const url = readUrl(raw, 'url', path, issues);
      const align = readAlign(raw, path, issues);

      if (label === null || url === null || align === null) {
        return null;
      }

      return { id, type, label, url, align };
    }
    case 'divider':
      return { id, type };
    case 'spacer': {
      const height = readDimension(raw, 'height', path, issues, 24, 4, 120);

      return height === null ? null : { id, type, height };
    }
    case 'columns': {
      const left = readString(raw, 'left', path, issues, BUILDER_MAX_COLUMN_TEXT);
      const right = readString(raw, 'right', path, issues, BUILDER_MAX_COLUMN_TEXT);

      if (left === null || right === null) {
        return null;
      }

      return { id, type, left, right };
    }
    default:
      return null;
  }
}

function readId(
  raw: Record<string, unknown>,
  path: string,
  issues: TemplateValidationIssue[],
): string | null {
  const value = raw.id;

  if (typeof value !== 'string' || !BLOCK_ID_PATTERN.test(value)) {
    issues.push(
      issue(
        'builder_block_invalid',
        `${path}.id`,
        'id block harus 1–64 karakter dan hanya berisi huruf, angka, "_" atau "-"',
      ),
    );
    return null;
  }

  return value;
}

function readString(
  raw: Record<string, unknown>,
  key: string,
  path: string,
  issues: TemplateValidationIssue[],
  maxLength: number,
  fallback?: string,
): string | null {
  const value = raw[key];

  if (value === undefined && fallback !== undefined) {
    return fallback;
  }

  if (typeof value !== 'string') {
    issues.push(issue('builder_block_invalid', `${path}.${key}`, `${key} harus berupa string`));
    return null;
  }

  if (value.length > maxLength) {
    issues.push(
      issue(
        'builder_block_invalid',
        `${path}.${key}`,
        `${key} maksimum ${maxLength} karakter`,
      ),
    );
    return null;
  }

  if (CONTROL_CHARACTERS.test(value)) {
    issues.push(
      issue('builder_block_invalid', `${path}.${key}`, `${key} mengandung karakter kontrol`),
    );
    return null;
  }

  return value;
}

function readUrl(
  raw: Record<string, unknown>,
  key: string,
  path: string,
  issues: TemplateValidationIssue[],
): string | null {
  const value = readString(raw, key, path, issues, BUILDER_MAX_URL, '');

  if (value === null || value.trim().length === 0) {
    return value;
  }

  if (!isSafeBuilderUrl(value)) {
    issues.push(
      issue(
        'builder_url_unsafe',
        `${path}.${key}`,
        `${key} harus URL http/https atau token {{...}}`,
      ),
    );
    return null;
  }

  return value.trim();
}

function readLevel(
  raw: Record<string, unknown>,
  path: string,
  issues: TemplateValidationIssue[],
): 1 | 2 | 3 | null {
  const value = raw.level;

  if (value === undefined) {
    return 1;
  }

  if (value !== 1 && value !== 2 && value !== 3) {
    issues.push(
      issue('builder_block_invalid', `${path}.level`, 'level harus 1, 2, atau 3'),
    );
    return null;
  }

  return value;
}

function readAlign(
  raw: Record<string, unknown>,
  path: string,
  issues: TemplateValidationIssue[],
): 'left' | 'center' | 'right' | null {
  const value = raw.align;

  if (value === undefined) {
    return 'left';
  }

  if (value !== 'left' && value !== 'center' && value !== 'right') {
    issues.push(
      issue('builder_block_invalid', `${path}.align`, 'align harus left, center, atau right'),
    );
    return null;
  }

  return value;
}

function readDimension(
  raw: Record<string, unknown>,
  key: string,
  path: string,
  issues: TemplateValidationIssue[],
  fallback: number,
  min: number,
  max: number,
): string | null {
  const value = raw[key];

  if (value === undefined || value === '') {
    return String(fallback);
  }

  if (typeof value !== 'string' && typeof value !== 'number') {
    issues.push(
      issue('builder_block_invalid', `${path}.${key}`, `${key} harus berupa angka`),
    );
    return null;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    issues.push(
      issue(
        'builder_block_invalid',
        `${path}.${key}`,
        `${key} harus angka ${min}–${max}`,
      ),
    );
    return null;
  }

  return String(Math.round(parsed));
}

function isSafeBuilderUrl(value: string): boolean {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return true;
  }

  if (TEMPLATE_TOKEN_PATTERN.test(trimmed)) {
    return true;
  }

  try {
    const url = new URL(trimmed);

    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isBuilderBlockType(value: string): value is BuilderBlockType {
  return Object.prototype.hasOwnProperty.call(BLOCK_KEYS, value);
}

function issue(
  code: string,
  path: string,
  message: string,
): TemplateValidationIssue {
  return { code, path, message, severity: 'error' };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
