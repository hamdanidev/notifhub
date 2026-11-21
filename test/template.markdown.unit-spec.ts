import {
  markdownToPlainText,
  MAX_MARKDOWN_LINES,
  MAX_MARKDOWN_LINKS,
  renderMarkdownSubset,
  validateMarkdownSubset,
} from '../src/templates/template.markdown';

describe('template markdown subset', () => {
  it('merender paragraf, tebal, miring, kode, heading, dan list', () => {
    const result = renderMarkdownSubset(
      '# Judul\n\nHalo **Budi**, ini *miring* dan `kode`.\n\n- satu\n- dua\n\n1. satu\n2. dua',
    );

    expect(result.html).toContain('<h3>Judul</h3>');
    expect(result.html).toContain('<p>Halo <strong>Budi</strong>, ini <em>miring</em> dan <code>kode</code>.</p>');
    expect(result.html).toContain('<ul><li>satu</li><li>dua</li></ul>');
    expect(result.html).toContain('<ol><li>satu</li><li>dua</li></ol>');
    expect(result.warnings).toEqual([]);
  });

  it('mengizinkan link http/https/mailto dengan rel aman', () => {
    const result = renderMarkdownSubset(
      '[contoh](https://example.com/a?b=1) dan [email](mailto:test@example.com)',
    );

    expect(result.html).toContain(
      '<a href="https://example.com/a?b=1" rel="noopener noreferrer">contoh</a>',
    );
    expect(result.html).toContain(
      '<a href="mailto:test@example.com" rel="noopener noreferrer">email</a>',
    );
  });

  it('mengabaikan link dengan skema berbahaya dan menulis warning', () => {
    const result = renderMarkdownSubset('[klik](javascript:alert) dan [data](data:text/html,x)');

    expect(result.html).not.toContain('javascript:');
    expect(result.html).not.toContain('data:text/html');
    expect(result.html).toContain('klik');
    expect(result.warnings.length).toBe(2);
  });

  it('meng-escape HTML mentah sehingga tidak ada tag yang lolos', () => {
    const result = renderMarkdownSubset('<script>alert(1)</script> <img src=x onerror=alert(1)>');

    expect(result.html).not.toContain('<script>');
    expect(result.html).not.toContain('<img');
    expect(result.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('menghasilkan plain text tanpa marker markdown', () => {
    const text = markdownToPlainText(
      '# Judul\n\nHalo **Budi** dan *kawan*, lihat [tautan](https://example.com).\n\n- satu\n- dua',
    );

    expect(text).toBe('Judul\n\nHalo Budi dan kawan, lihat tautan.\n\nsatu\ndua');
  });

  it('validasi menolak HTML mentah, karakter kontrol, dan link tidak aman', () => {
    const raw = validateMarkdownSubset('<b>tebal</b>', 'body');
    expect(raw.some((issue) => issue.code === 'markdown_raw_html')).toBe(true);

    const control = validateMarkdownSubset('halo\u0007dunia', 'body');
    expect(control.some((issue) => issue.code === 'markdown_control_char')).toBe(true);

    const unsafe = validateMarkdownSubset('[x](javascript:alert)', 'body');
    expect(unsafe.some((issue) => issue.code === 'markdown_unsafe_link')).toBe(true);
  });

  it('validasi membatasi jumlah baris dan tautan', () => {
    const tooManyLines = validateMarkdownSubset(
      Array.from({ length: MAX_MARKDOWN_LINES + 1 }, () => 'baris').join('\n'),
      'body',
    );
    expect(tooManyLines.some((issue) => issue.code === 'markdown_too_many_lines')).toBe(true);

    const tooManyLinks = validateMarkdownSubset(
      Array.from({ length: MAX_MARKDOWN_LINKS + 1 }, (_, index) => `[x](https://example.com/${index})`).join(
        '\n',
      ),
      'body',
    );
    expect(tooManyLinks.some((issue) => issue.code === 'markdown_too_many_links')).toBe(true);
  });
});
