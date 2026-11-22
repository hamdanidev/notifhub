/**
 * Dependency-free line/word diff and visual block diff for template versions.
 *
 * Line diff uses LCS over the changed middle section only (common prefix/suffix trimmed) and
 * falls back to a coarse replace hunk when the matrix would be too large. Output is bounded so a
 * pathological template cannot blow up the API response.
 */

export const DIFF_MAX_LINES = 4_000;
export const DIFF_MAX_WORD_CELLS = 120_000;
export const DIFF_MAX_LINE_CELLS = 250_000;
export const DIFF_MAX_HUNKS = 500;
export const DIFF_MAX_CHANGED_BLOCKS = 200;

export type DiffHunkType = 'equal' | 'added' | 'removed';

export interface DiffHunk {
  type: DiffHunkType;
  value: string;
}

export interface LineDiff {
  hunks: DiffHunk[];
  addedLines: number;
  removedLines: number;
  truncated: boolean;
}

export interface WordDiff {
  hunks: DiffHunk[];
  truncated: boolean;
}

export interface BlockChange {
  index: number;
  type: string;
  fields: string[];
}

export interface BlockDiff {
  available: boolean;
  added: number;
  removed: number;
  changed: BlockChange[];
  truncated: boolean;
}

interface BuilderLikeBlock {
  type?: unknown;
  [key: string]: unknown;
}

const BLOCK_FIELDS: Record<string, readonly string[]> = {
  heading: ['text', 'level'],
  text: ['text'],
  image: ['url', 'alt', 'width'],
  button: ['label', 'url', 'align'],
  divider: [],
  spacer: ['height'],
  columns: ['left', 'right'],
};

export function diffLines(
  before: string,
  after: string,
  maxLines: number = DIFF_MAX_LINES,
): LineDiff {
  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);
  const truncatedInput = beforeLines.length > maxLines || afterLines.length > maxLines;
  const a = beforeLines.slice(0, maxLines);
  const b = afterLines.slice(0, maxLines);

  let prefix = 0;

  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) {
    prefix += 1;
  }

  let suffix = 0;

  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const middleA = a.slice(prefix, a.length - suffix);
  const middleB = b.slice(prefix, b.length - suffix);
  const hunks: DiffHunk[] = [];

  if (prefix > 0) {
    hunks.push({ type: 'equal', value: a.slice(0, prefix).join('\n') });
  }

  const middle = lcsHunks(middleA, middleB);
  hunks.push(...middle.hunks);

  if (suffix > 0) {
    hunks.push({
      type: 'equal',
      value: a.slice(a.length - suffix).join('\n'),
    });
  }

  const limited = limitHunks(hunks);

  return {
    hunks: limited.hunks,
    addedLines: middle.addedLines,
    removedLines: middle.removedLines,
    truncated:
      truncatedInput || middle.truncated || limited.truncated,
  };
}

export function diffWords(before: string, after: string): WordDiff {
  const a = tokenizeWords(before);
  const b = tokenizeWords(after);

  if (a.length * b.length > DIFF_MAX_WORD_CELLS) {
    return {
      hunks: compact([
        a.length === 0 ? null : { type: 'removed', value: a.join('') },
        b.length === 0 ? null : { type: 'added', value: b.join('') },
      ]),
      truncated: true,
    };
  }

  const middle = lcsHunks(a, b);

  return {
    hunks: limitHunks(middle.hunks).hunks,
    truncated: middle.truncated,
  };
}

export function diffBlocks(
  before: unknown,
  after: unknown,
): BlockDiff {
  const a = readBlocks(before);
  const b = readBlocks(after);

  if (a === null || b === null) {
    return { available: false, added: 0, removed: 0, changed: [], truncated: false };
  }

  const changed: BlockChange[] = [];
  const shared = Math.min(a.length, b.length);
  let truncated = false;

  for (let index = 0; index < shared; index += 1) {
    const left = a[index];
    const right = b[index];

    if (left === undefined || right === undefined) {
      continue;
    }

    const fields = changedFields(left, right);

    if (fields.length > 0) {
      changed.push({
        index,
        type: typeof right.type === 'string' ? right.type : 'unknown',
        fields,
      });
    }

    if (changed.length >= DIFF_MAX_CHANGED_BLOCKS) {
      truncated = true;
      break;
    }
  }

  return {
    available: true,
    added: Math.max(0, b.length - a.length),
    removed: Math.max(0, a.length - b.length),
    changed,
    truncated,
  };
}

function lcsHunks(
  a: string[],
  b: string[],
): { hunks: DiffHunk[]; addedLines: number; removedLines: number; truncated: boolean } {
  if (a.length === 0 && b.length === 0) {
    return { hunks: [], addedLines: 0, removedLines: 0, truncated: false };
  }

  if (a.length === 0) {
    return {
      hunks: [{ type: 'added', value: b.join('\n') }],
      addedLines: b.length,
      removedLines: 0,
      truncated: false,
    };
  }

  if (b.length === 0) {
    return {
      hunks: [{ type: 'removed', value: a.join('\n') }],
      addedLines: 0,
      removedLines: a.length,
      truncated: false,
    };
  }

  if (a.length * b.length > DIFF_MAX_LINE_CELLS) {
    return {
      hunks: [
        { type: 'removed', value: a.join('\n') },
        { type: 'added', value: b.join('\n') },
      ],
      addedLines: b.length,
      removedLines: a.length,
      truncated: true,
    };
  }

  const rows = a.length;
  const cols = b.length;
  const table = new Uint32Array((rows + 1) * (cols + 1));

  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      const position = i * (cols + 1) + j;
      table[position] =
        a[i] === b[j]
          ? (table[(i + 1) * (cols + 1) + (j + 1)] ?? 0) + 1
          : Math.max(
              table[(i + 1) * (cols + 1) + j] ?? 0,
              table[i * (cols + 1) + (j + 1)] ?? 0,
            );
    }
  }

  const hunks: DiffHunk[] = [];
  let addedLines = 0;
  let removedLines = 0;
  let i = 0;
  let j = 0;

  while (i < rows && j < cols) {
    if (a[i] === b[j]) {
      pushHunk(hunks, 'equal', a[i] ?? '');
      i += 1;
      j += 1;
      continue;
    }

    const down = table[(i + 1) * (cols + 1) + j] ?? 0;
    const right = table[i * (cols + 1) + (j + 1)] ?? 0;

    if (down >= right) {
      pushHunk(hunks, 'removed', a[i] ?? '');
      removedLines += 1;
      i += 1;
    } else {
      pushHunk(hunks, 'added', b[j] ?? '');
      addedLines += 1;
      j += 1;
    }
  }

  while (i < rows) {
    pushHunk(hunks, 'removed', a[i] ?? '');
    removedLines += 1;
    i += 1;
  }

  while (j < cols) {
    pushHunk(hunks, 'added', b[j] ?? '');
    addedLines += 1;
    j += 1;
  }

  return { hunks, addedLines, removedLines, truncated: false };
}

function pushHunk(hunks: DiffHunk[], type: DiffHunkType, line: string): void {
  const last = hunks[hunks.length - 1];

  if (last !== undefined && last.type === type) {
    last.value = `${last.value}\n${line}`;
    return;
  }

  hunks.push({ type, value: line });
}

function limitHunks(hunks: DiffHunk[]): { hunks: DiffHunk[]; truncated: boolean } {
  if (hunks.length <= DIFF_MAX_HUNKS) {
    return { hunks, truncated: false };
  }

  return { hunks: hunks.slice(0, DIFF_MAX_HUNKS), truncated: true };
}

function splitLines(value: string): string[] {
  return value.split('\n');
}

function tokenizeWords(value: string): string[] {
  return value.split(/(\s+)/).filter((token) => token.length > 0);
}

function readBlocks(value: unknown): BuilderLikeBlock[] | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const blocks = (value as { blocks?: unknown }).blocks;

  if (!Array.isArray(blocks)) {
    return null;
  }

  return blocks.filter(
    (block): block is BuilderLikeBlock =>
      typeof block === 'object' && block !== null && !Array.isArray(block),
  );
}

function changedFields(left: BuilderLikeBlock, right: BuilderLikeBlock): string[] {
  if (left.type !== right.type) {
    return ['type'];
  }

  const type = typeof right.type === 'string' ? right.type : '';
  const fields = BLOCK_FIELDS[type] ?? [];

  return fields.filter((field) => JSON.stringify(left[field]) !== JSON.stringify(right[field]));
}

function compact<T>(values: Array<T | null>): T[] {
  return values.filter((value): value is T => value !== null);
}
