import { Channel } from '@prisma/client';
import { parseBuilderDocument } from '../src/templates/template.builder';

const validBlock = { id: 'b1', type: 'text', text: 'Halo' };

function codes(value: unknown, channel: Channel = Channel.email): string[] {
  return parseBuilderDocument(channel, value).issues.map((issue) => issue.code);
}

describe('parseBuilderDocument', () => {
  it('menerima dokumen valid dan mengisi default', () => {
    const result = parseBuilderDocument(Channel.email, {
      version: 1,
      blocks: [
        { id: 'h1', type: 'heading', text: 'Judul' },
        { id: 'i1', type: 'image', url: 'https://example.com/a.png' },
      ],
    });

    expect(result.issues).toEqual([]);
    expect(result.document).toEqual({
      version: 1,
      blocks: [
        { id: 'h1', type: 'heading', text: 'Judul', level: 1 },
        { id: 'i1', type: 'image', url: 'https://example.com/a.png', alt: '', width: '552' },
      ],
    });
  });

  it('menolak versi, tipe, field, dan id yang tidak valid', () => {
    expect(codes({ version: 2, blocks: [] })).toContain('builder_unsupported_version');
    expect(
      codes({ version: 1, blocks: [{ id: 'b1', type: 'video', text: 'x' }] }),
    ).toContain('builder_unknown_block_type');
    expect(
      codes({ version: 1, blocks: [{ id: 'b1', type: 'toString', text: 'x' }] }),
    ).toContain('builder_unknown_block_type');
    expect(
      codes({ version: 1, blocks: [{ ...validBlock, extra: true }] }),
    ).toContain('builder_unknown_field');
    expect(
      codes({
        version: 1,
        blocks: [
          { id: 'dup', type: 'text', text: 'a' },
          { id: 'dup', type: 'text', text: 'b' },
        ],
      }),
    ).toContain('builder_duplicate_id');
  });

  it('menolak URL berbahaya', () => {
    expect(
      codes({
        version: 1,
        blocks: [{ id: 'i1', type: 'image', url: 'javascript:alert(1)' }],
      }),
    ).toContain('builder_url_unsafe');

    expect(
      codes({
        version: 1,
        blocks: [{ id: 'i1', type: 'image', url: '{{image.url}}' }],
      }),
    ).toEqual([]);
  });

  it('menolak channel non-email', () => {
    expect(
      codes({ version: 1, blocks: [validBlock] }, Channel.inapp),
    ).toContain('builder_channel_mismatch');
  });

  it('menolak jumlah block dan ukuran JSON berlebih', () => {
    const tooMany = Array.from({ length: 201 }, (_, index) => ({
      id: `b${index}`,
      type: 'text',
      text: 'x',
    }));

    expect(codes({ version: 1, blocks: tooMany })).toContain('builder_too_many_blocks');

    const oversized = Array.from({ length: 7 }, (_, index) => ({
      id: `big${index}`,
      type: 'text',
      text: 'x'.repeat(10_000),
    }));

    expect(codes({ version: 1, blocks: oversized })).toContain('builder_too_large');
  });
});
