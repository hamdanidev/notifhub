import { htmlToPlainText } from '../src/templates/template.text';

describe('htmlToPlainText', () => {
  it('mengubah paragraf, link, gambar, list, dan entitas', () => {
    const text = htmlToPlainText(
      '<div data-nh-text-skip>Preheader tersembunyi</div>' +
        '<p>Halo&nbsp;<b>Budi</b> &amp; rekan,</p>' +
        '<p><a href="https://example.com/orders/1?a=1&amp;b=2">Lacak pesanan</a></p>' +
        '<ul><li>Satu</li><li>Dua</li></ul>' +
        '<img src="https://example.com/a.png" alt="Paket">' +
        '<style>.x{color:red}</style>',
    );

    expect(text).not.toBeNull();
    expect(text).toContain('Halo Budi & rekan,');
    expect(text).toContain('Lacak pesanan (https://example.com/orders/1?a=1&b=2)');
    expect(text).toContain('- Satu');
    expect(text).toContain('- Dua');
    expect(text).toContain('Paket');
    expect(text).not.toContain('Preheader tersembunyi');
    expect(text).not.toContain('<p>');
    expect(text).not.toContain('color:red');
  });

  it('menghapus preheader legacy dan mengembalikan null untuk HTML kosong', () => {
    const legacy = htmlToPlainText(
      '<div style="display:none;max-height:0;overflow:hidden">Preheader</div><p>Isi</p>',
    );

    expect(legacy).toBe('Isi');
    expect(htmlToPlainText('   ')).toBeNull();
    expect(htmlToPlainText('<style>.x{}</style>')).toBeNull();
  });

  it('memakai teks alternatif gambar dan menghindari duplikasi link', () => {
    const text = htmlToPlainText(
      '<p><a href="https://example.com">https://example.com</a></p><img src="x">',
    );

    expect(text).toContain('https://example.com');
    expect(text).toContain('[gambar]');
    expect(text?.match(/https:\/\/example\.com/g)?.length).toBe(1);
  });
});
