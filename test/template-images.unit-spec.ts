import { detectImage } from '../src/template-images/template-images.types';

describe('detectImage', () => {
  it('mendeteksi PNG 1×1 dari magic bytes dan IHDR', () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2ZQAAAABJRU5ErkJggg==',
      'base64',
    );

    expect(detectImage(png)).toEqual({
      mimeType: 'image/png',
      extension: 'png',
      width: 1,
      height: 1,
    });
  });

  it('mendeteksi GIF dan menolak SVG/teks', () => {
    const gif = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x02, 0x00, 0x03, 0x00]);

    expect(detectImage(gif)).toMatchObject({
      mimeType: 'image/gif',
      width: 2,
      height: 3,
    });
    expect(detectImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(detectImage(Buffer.from('hello'))).toBeNull();
  });

  it('menolak PNG dengan dimensi nol', () => {
    const png = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
    png.write('IHDR', 12, 'ascii');
    png.writeUInt32BE(0, 16);
    png.writeUInt32BE(1, 20);

    expect(detectImage(png)).toBeNull();
  });
});
