import {
  moveBlock,
  parseBlockDocument,
  renderBlocksToHtml,
} from '../console/src/lib/emailBlocks';

describe('console email blocks', () => {
  it('memindahkan block tanpa memutasi array asal', () => {
    const blocks = ['a', 'b', 'c'];
    const moved = moveBlock(blocks, 0, 2);

    expect(moved).toEqual(['b', 'c', 'a']);
    expect(blocks).toEqual(['a', 'b', 'c']);
    expect(moveBlock(blocks, 1, 1)).toBe(blocks);
    expect(moveBlock(blocks, -1, 2)).toBe(blocks);
  });

  it('menolak dokumen yang terpotong atau berisi field tak dikenal', () => {
    expect(
      parseBlockDocument({
        version: 1,
        blocks: [
          { id: 'h1', type: 'heading', text: 'Halo', level: 1 },
          { id: 'b1', type: 'text', text: 'Isi' },
        ],
      }),
    ).toEqual({
      version: 1,
      blocks: [
        { id: 'h1', type: 'heading', text: 'Halo', level: 1 },
        { id: 'b1', type: 'text', text: 'Isi' },
      ],
    });

    expect(
      parseBlockDocument({
        version: 1,
        blocks: [{ id: 'b1', type: 'video', text: 'x' }],
      }),
    ).toBeNull();

    expect(
      parseBlockDocument({
        version: 1,
        blocks: [{ id: 'b1', type: 'text', text: 'x', extra: true }],
      }),
    ).toBeNull();
  });

  it('merender dua kolom dan tidak memuat script', () => {
    const html = renderBlocksToHtml({
      version: 1,
      blocks: [{ id: 'c1', type: 'columns', left: 'Kiri', right: 'Kanan' }],
    });

    expect(html).toContain('role="presentation"');
    expect(html).toContain('class="nh-col"');
    expect(html).not.toContain('<script');
  });
});
