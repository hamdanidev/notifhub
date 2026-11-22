import { describe, expect, it } from 'vitest';
import type { EmailBlock } from './emailBlocks';
import { parseBlockDocument, renderBlocksToHtml } from './emailBlocks';
import { importHtmlToBlocks } from './htmlImport';

function imported(html: string): {
  result: ReturnType<typeof importHtmlToBlocks>;
  blocks: Array<Record<string, unknown>>;
  codes: string[];
} {
  const result = importHtmlToBlocks(html);
  const blocks = (result.document?.blocks ?? []).map((block) => {
    const copy: Record<string, unknown> = { ...block };
    delete copy.id;
    return copy;
  });

  return {
    result,
    blocks,
    codes: result.issues.map((issue) => issue.code),
  };
}

describe('importHtmlToBlocks', () => {
  it('maps headings h1-h3 to levels and clamps h4-h6 to level 3', () => {
    const mapped = imported('<h1>A</h1><h2>B</h2><h3>C</h3>');

    expect(mapped.result.document).not.toBeNull();
    expect(mapped.blocks).toEqual([
      { type: 'heading', text: 'A', level: 1 },
      { type: 'heading', text: 'B', level: 2 },
      { type: 'heading', text: 'C', level: 3 },
    ]);

    const clamped = imported('<h4>D</h4>');

    expect(clamped.blocks).toEqual([{ type: 'heading', text: 'D', level: 3 }]);
    expect(clamped.codes).toContain('import_heading_level_clamped');
  });

  it('maps paragraphs, line breaks, and stray text in document order', () => {
    const mapped = imported(
      '<p>Baris satu<br>Baris dua</p>\n<p>Paragraf kedua</p>\nteks liar',
    );

    expect(mapped.blocks).toEqual([
      { type: 'text', text: 'Baris satu\nBaris dua' },
      { type: 'text', text: 'Paragraf kedua' },
      { type: 'text', text: 'teks liar' },
    ]);
  });

  it('treats a div with inline content as one text block and a wrapper div as a container', () => {
    expect(imported('<div>Halo <em>dunia</em></div>').blocks).toEqual([
      { type: 'text', text: 'Halo dunia' },
    ]);
    expect(imported('<div><p>Satu</p><p>Dua</p></div>').blocks).toEqual([
      { type: 'text', text: 'Satu' },
      { type: 'text', text: 'Dua' },
    ]);
  });

  it('decodes entities once and normalizes non-breaking spaces and whitespace', () => {
    const mapped = imported('<p>  A &amp; B&nbsp;&nbsp;C   </p>');

    expect(mapped.blocks).toEqual([{ type: 'text', text: 'A & B C' }]);
  });

  it('keeps inline formatting text but drops the formatting with a warning', () => {
    const mapped = imported('<p>Halo <strong>dunia</strong> dan <code>kode</code></p>');

    expect(mapped.blocks).toEqual([{ type: 'text', text: 'Halo dunia dan kode' }]);
    expect(mapped.codes).toContain('import_inline_formatting_dropped');
    expect(mapped.result.document?.blocks[0]).not.toHaveProperty('html');
  });

  it('keeps inline anchor text, drops the link, and does not create a button', () => {
    const mapped = imported('<p>Klik <a href="https://example.com/x">di sini</a> sekarang</p>');

    expect(mapped.blocks).toEqual([{ type: 'text', text: 'Klik di sini sekarang' }]);
    expect(mapped.codes).toContain('import_inline_link_dropped');
  });

  it('maps a standalone anchor to a button and reads alignment from the container', () => {
    const mapped = imported(
      '<div style="text-align:center"><a href="https://example.com/beli">Beli</a></div>',
    );

    expect(mapped.blocks).toEqual([
      { type: 'button', label: 'Beli', url: 'https://example.com/beli', align: 'center' },
    ]);
  });

  it('treats a lone top-level anchor as a button', () => {
    const mapped = imported('<a href="https://example.com/masuk">Masuk</a>');

    expect(mapped.blocks).toEqual([
      { type: 'button', label: 'Masuk', url: 'https://example.com/masuk', align: 'left' },
    ]);
    expect(mapped.codes).not.toContain('import_inline_link_dropped');
  });

  it('accepts a Handlebars URL token for buttons and images', () => {
    const mapped = imported(
      '<p><a href="{{cta.url}}">Lacak</a></p><img src="{{image.url}}" alt="Paket">',
    );

    expect(mapped.blocks).toEqual([
      { type: 'button', label: 'Lacak', url: '{{cta.url}}', align: 'left' },
      { type: 'image', url: '{{image.url}}', alt: 'Paket', width: '552' },
    ]);
  });

  it('maps a linked image to an image block and warns that the link was dropped', () => {
    const mapped = imported(
      '<a href="https://example.com"><img src="https://cdn.example.com/a.png" alt="A"></a>',
    );

    expect(mapped.blocks).toEqual([
      { type: 'image', url: 'https://cdn.example.com/a.png', alt: 'A', width: '552' },
    ]);
    expect(mapped.codes).toContain('import_image_link_dropped');
  });

  it('reads image width from attribute or style and clamps it to 80-600', () => {
    expect(
      imported('<img src="https://x.test/a.png" width="900">').blocks[0]?.width,
    ).toBe('600');
    expect(
      imported('<img src="https://x.test/a.png" width="40">').blocks[0]?.width,
    ).toBe('80');
    expect(
      imported('<img src="https://x.test/a.png" style="width:600px;color:red">').blocks[0]?.width,
    ).toBe('600');
    expect(
      imported('<img src="https://x.test/a.png" style="width:100%">').blocks[0]?.width,
    ).toBe('552');
  });

  it('drops unsafe or relative URLs but keeps the block with an empty URL', () => {
    const image = imported('<img src="javascript:alert(1)" alt="X">');
    expect(image.blocks).toEqual([{ type: 'image', url: '', alt: 'X', width: '552' }]);
    expect(image.codes).toContain('import_url_unsafe');

    const relative = imported('<img src="/local/a.png" alt="Y">');
    expect(relative.blocks[0]?.url).toBe('');
    expect(relative.codes).toContain('import_url_unsafe');

    const missing = imported('<img alt="Z">');
    expect(missing.blocks[0]?.url).toBe('');
    expect(missing.codes).toContain('import_image_src_missing');

    const dataButton = imported('<p><a href="data:text/html,x">Klik</a></p>');
    expect(dataButton.blocks[0]).toMatchObject({ type: 'button', url: '' });
    expect(dataButton.codes).toContain('import_url_unsafe');
  });

  it('maps hr to a divider', () => {
    expect(imported('<p>A</p><hr><p>B</p>').blocks).toEqual([
      { type: 'text', text: 'A' },
      { type: 'divider' },
      { type: 'text', text: 'B' },
    ]);
  });

  it('unwraps a single-cell table and rejects a multi-cell table', () => {
    expect(imported('<table><tr><td><p>Isi</p></td></tr></table>').blocks).toEqual([
      { type: 'text', text: 'Isi' },
    ]);

    const rejected = imported('<table><tr><td>A</td><td>B</td></tr></table>');
    expect(rejected.result.document).toBeNull();
    expect(rejected.codes).toContain('import_multi_cell_table_unsupported');
  });

  it('skips hidden elements such as a preheader', () => {
    const mapped = imported(
      '<div style="display:none">Preheader tersembunyi</div><p>Isi terlihat</p>',
    );

    expect(mapped.blocks).toEqual([{ type: 'text', text: 'Isi terlihat' }]);
    expect(mapped.codes).toContain('import_hidden_element_skipped');
    expect(mapped.result.summary.ignoredElements).toBe(1);
  });

  it('rejects unsafe elements, lists, block-level unknown tags, and Handlebars blocks', () => {
    const cases: Array<{ html: string; code: string }> = [
      { html: '<p>x</p><script>alert(1)</script>', code: 'import_unsafe_element' },
      { html: '<p>x</p><svg onload="alert(1)"></svg>', code: 'import_unsafe_element' },
      { html: '<ul><li>x</li></ul>', code: 'import_list_unsupported' },
      { html: '<blockquote>x</blockquote>', code: 'import_unsupported_element' },
      { html: '<p>{{#if a}}x{{/if}}</p>', code: 'import_handlebars_block_unsupported' },
      {
        html: '<p><a href="{{#if a}}https://x.test{{/if}}">x</a></p>',
        code: 'import_handlebars_block_unsupported',
      },
    ];

    for (const item of cases) {
      const mapped = imported(item.html);
      expect(mapped.result.document).toBeNull();
      expect(mapped.codes).toContain(item.code);
    }
  });

  it('preserves Handlebars variable tokens in text and labels', () => {
    const mapped = imported(
      '<h1>Halo {{nama}}</h1><p>Total {{{total}}}</p><p><a href="{{cta.url}}">{{cta.label}}</a></p>',
    );

    expect(mapped.blocks).toEqual([
      { type: 'heading', text: 'Halo {{nama}}', level: 1 },
      { type: 'text', text: 'Total {{{total}}}' },
      { type: 'button', label: '{{cta.label}}', url: '{{cta.url}}', align: 'left' },
    ]);
  });

  it('counts dropped CSS rules and style declarations', () => {
    const mapped = imported(
      '<style>.a{color:red}.b{color:blue}</style><p style="color:red">A</p>',
    );

    expect(mapped.blocks).toEqual([{ type: 'text', text: 'A' }]);
    expect(mapped.codes).toContain('import_css_dropped');
    expect(mapped.result.summary.droppedCssRules).toBe(2);
    expect(mapped.result.summary.droppedStyleAttributes).toBe(1);
  });

  it('drops conditional and plain comments with warnings', () => {
    const mapped = imported(
      '<p>A</p><!--[if mso]><div>outlook</div><![endif]--><!-- komentar biasa -->',
    );

    expect(mapped.blocks).toEqual([{ type: 'text', text: 'A' }]);
    expect(mapped.codes).toContain('import_conditional_comment_dropped');
    expect(mapped.codes).toContain('import_comment_dropped');
  });

  it('rejects empty input and input without importable blocks', () => {
    expect(imported('').codes).toContain('import_no_blocks');
    expect(imported('   \n  ').codes).toContain('import_no_blocks');
    expect(imported('<div></div>').codes).toContain('import_no_blocks');
  });

  it('enforces input, node, block, text, and document limits', () => {
    expect(
      importHtmlToBlocks('<p>x</p>', { maxInputBytes: 4 }).issues.map((issue) => issue.code),
    ).toContain('import_input_too_large');

    expect(
      importHtmlToBlocks('<p>a</p><p>b</p><p>c</p>', { maxNodes: 2 }).issues.map(
        (issue) => issue.code,
      ),
    ).toContain('import_too_many_nodes');

    const manyBlocks = Array.from({ length: 201 }, () => '<p>x</p>').join('');
    expect(importHtmlToBlocks(manyBlocks).issues.map((issue) => issue.code)).toContain(
      'import_block_limit',
    );

    const longText = `<p>${'x'.repeat(10_001)}</p>`;
    expect(importHtmlToBlocks(longText).issues.map((issue) => issue.code)).toContain(
      'import_text_too_long',
    );

    const largeDocument = Array.from({ length: 7 }, () => `<p>${'x'.repeat(10_000)}</p>`).join('');
    expect(importHtmlToBlocks(largeDocument).issues.map((issue) => issue.code)).toContain(
      'import_document_too_large',
    );
  });

  it('produces unique, schema-valid block ids and no extra fields', () => {
    const result = importHtmlToBlocks('<h1>A</h1><p>B</p><hr>');
    const blocks = result.document?.blocks ?? [];

    expect(blocks).toHaveLength(3);

    const ids = blocks.map((block) => block.id);

    expect(new Set(ids).size).toBe(3);

    for (const id of ids) {
      expect(id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    }

    expect(Object.keys(blocks[0] ?? {}).sort()).toEqual(['id', 'level', 'text', 'type']);
    expect(parseBlockDocument(result.document)).not.toBeNull();
  });

  it('round-trips through the builder renderer without leaking source tags', () => {
    const result = importHtmlToBlocks(
      '<h1>Halo {{nama}}</h1><p>Pesanan <strong>INV-001</strong> dikirim.</p>' +
        '<img src="https://cdn.example.com/box.png" alt="Paket" width="600">' +
        '<p><a href="https://example.com/lacak">Lacak</a></p><hr>',
    );

    expect(result.document).not.toBeNull();

    const html = renderBlocksToHtml(result.document!);

    expect(html).toContain('<h1');
    expect(html).toContain('Pesanan INV-001 dikirim.');
    expect(html).toContain('src="https://cdn.example.com/box.png"');
    expect(html).toContain('href="https://example.com/lacak"');
    expect(html).toContain('<hr');
    expect(html).not.toContain('<strong>');
  });

  it('reads a full document and counts its head styles', () => {
    const mapped = imported(
      '<!doctype html><html><head><style>.a{color:red}.b{color:blue}</style></head>' +
        '<body><p>Isi</p></body></html>',
    );

    expect(mapped.blocks).toEqual([{ type: 'text', text: 'Isi' }]);
    expect(mapped.result.summary.droppedCssRules).toBe(2);
    expect(mapped.result.summary.blocks).toBe(1);
    expect(mapped.result.summary.byType).toEqual({ text: 1 });
    expect(mapped.result.summary.bytes).toBeGreaterThan(0);
  });

  it('ignores whitespace indentation between tags without counting ignored elements', () => {
    const result = importHtmlToBlocks(
      ['<div>', '  <p>Satu</p>', '  <p>Dua</p>', '</div>'].join('\n'),
    );

    expect(result.document?.blocks.map((block) => block.type)).toEqual(['text', 'text']);
    expect(result.summary.ignoredElements).toBe(0);
  });

  it('keeps block type union narrow in the returned document', () => {
    const result = importHtmlToBlocks('<h1>A</h1><img src="https://x.test/a.png"><hr>');
    const types: EmailBlock['type'][] = (result.document?.blocks ?? []).map((block) => block.type);

    expect(types).toEqual(['heading', 'image', 'divider']);
  });
});
