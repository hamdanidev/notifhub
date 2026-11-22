import { diffBlocks, diffLines, diffWords } from '../src/templates/template.diff';

describe('template diff', () => {
  it('reports equal, added, and removed lines', () => {
    const result = diffLines('a\nb\nc', 'a\nB\nc\nd');

    expect(result.addedLines).toBe(2);
    expect(result.removedLines).toBe(1);
    expect(result.hunks.map((hunk) => hunk.type)).toContain('added');
    expect(result.hunks.map((hunk) => hunk.type)).toContain('removed');
    expect(result.truncated).toBe(false);
  });

  it('returns a single equal hunk for identical bodies', () => {
    const result = diffLines('same\nbody', 'same\nbody');

    expect(result.hunks).toEqual([{ type: 'equal', value: 'same\nbody' }]);
    expect(result.addedLines).toBe(0);
    expect(result.removedLines).toBe(0);
  });

  it('diffs words for subject-like fields', () => {
    const result = diffWords('Pesanan dikirim', 'Pesanan tiba');

    expect(result.hunks.some((hunk) => hunk.type === 'removed' && hunk.value.includes('dikirim'))).toBe(
      true,
    );
    expect(result.hunks.some((hunk) => hunk.type === 'added' && hunk.value.includes('tiba'))).toBe(true);
  });

  it('marks large inputs as truncated instead of building a huge matrix', () => {
    const before = Array.from({ length: 3_000 }, (_, index) => `line-${index}`).join('\n');
    const after = Array.from({ length: 3_000 }, (_, index) => `other-${index}`).join('\n');
    const result = diffLines(before, after, 1_000);

    expect(result.truncated).toBe(true);
    expect(result.hunks.length).toBeGreaterThan(0);
  });

  it('classifies block additions and field changes', () => {
    const before = {
      version: 1,
      blocks: [
        { id: 'b1', type: 'heading', text: 'Halo', level: 1 },
        { id: 'b2', type: 'text', text: 'Lama' },
      ],
    };
    const after = {
      version: 1,
      blocks: [
        { id: 'b1', type: 'heading', text: 'Halo', level: 1 },
        { id: 'b2', type: 'text', text: 'Baru' },
        { id: 'b3', type: 'divider' },
      ],
    };

    const result = diffBlocks(before, after);

    expect(result.available).toBe(true);
    expect(result.added).toBe(1);
    expect(result.removed).toBe(0);
    expect(result.changed).toEqual([{ index: 1, type: 'text', fields: ['text'] }]);
  });

  it('marks block diff as unavailable when one side has no builder data', () => {
    expect(diffBlocks(null, { blocks: [] })).toMatchObject({ available: false, added: 0 });
  });
});
