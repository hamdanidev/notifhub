export type TemplateImageMimeType =
  | 'image/png'
  | 'image/jpeg'
  | 'image/webp'
  | 'image/gif';

export interface DetectedImage {
  mimeType: TemplateImageMimeType;
  extension: 'png' | 'jpg' | 'webp' | 'gif';
  width: number;
  height: number;
}

export interface UploadedImageFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

/**
 * Detects a supported raster image from its bytes. The declared multipart content type is
 * intentionally ignored: it is attacker-controlled.
 */
export function detectImage(buffer: Buffer): DetectedImage | null {
  const png = detectPng(buffer);

  if (png !== null) {
    return png;
  }

  const jpeg = detectJpeg(buffer);

  if (jpeg !== null) {
    return jpeg;
  }

  const gif = detectGif(buffer);

  if (gif !== null) {
    return gif;
  }

  return detectWebp(buffer);
}

function detectPng(buffer: Buffer): DetectedImage | null {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return null;
  }

  if (buffer.toString('ascii', 12, 16) !== 'IHDR') {
    return null;
  }

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);

  return validDimensions(width, height)
    ? { mimeType: 'image/png', extension: 'png', width, height }
    : null;
}

function detectGif(buffer: Buffer): DetectedImage | null {
  if (buffer.length < 10) {
    return null;
  }

  const header = buffer.toString('ascii', 0, 6);

  if (header !== 'GIF87a' && header !== 'GIF89a') {
    return null;
  }

  const width = buffer.readUInt16LE(6);
  const height = buffer.readUInt16LE(8);

  return validDimensions(width, height)
    ? { mimeType: 'image/gif', extension: 'gif', width, height }
    : null;
}

function detectJpeg(buffer: Buffer): DetectedImage | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }

  let offset = 2;

  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    let markerOffset = offset;

    while (markerOffset < buffer.length && buffer[markerOffset] === 0xff) {
      markerOffset += 1;
    }

    if (markerOffset >= buffer.length) {
      return null;
    }

    const marker = buffer[markerOffset];

    if (marker === undefined) {
      return null;
    }

    offset = markerOffset + 1;

    if (
      marker === 0xd8 ||
      marker === 0xd9 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      continue;
    }

    if (marker === 0xda) {
      return null;
    }

    if (offset + 2 > buffer.length) {
      return null;
    }

    const segmentLength = buffer.readUInt16BE(offset);

    if (segmentLength < 2 || offset + segmentLength > buffer.length) {
      return null;
    }

    if (JPEG_SOF_MARKERS.has(marker)) {
      if (segmentLength < 7) {
        return null;
      }

      const height = buffer.readUInt16BE(offset + 3);
      const width = buffer.readUInt16BE(offset + 5);

      return validDimensions(width, height)
        ? { mimeType: 'image/jpeg', extension: 'jpg', width, height }
        : null;
    }

    offset += segmentLength;
  }

  return null;
}

function detectWebp(buffer: Buffer): DetectedImage | null {
  if (
    buffer.length < 30 ||
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    return null;
  }

  const format = buffer.toString('ascii', 12, 16);

  if (format === 'VP8X') {
    const width = buffer.readUIntLE(24, 3) + 1;
    const height = buffer.readUIntLE(27, 3) + 1;

    return validDimensions(width, height)
      ? { mimeType: 'image/webp', extension: 'webp', width, height }
      : null;
  }

  if (format === 'VP8 ') {
    if (
      buffer.length < 30 ||
      buffer[23] !== 0x9d ||
      buffer[24] !== 0x01 ||
      buffer[25] !== 0x2a
    ) {
      return null;
    }

    const width = buffer.readUInt16LE(26) & 0x3fff;
    const height = buffer.readUInt16LE(28) & 0x3fff;

    return validDimensions(width, height)
      ? { mimeType: 'image/webp', extension: 'webp', width, height }
      : null;
  }

  if (format === 'VP8L') {
    if (buffer.length < 25 || buffer[20] !== 0x2f) {
      return null;
    }

    const bits = buffer.readUInt32LE(21);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >>> 14) & 0x3fff) + 1;

    return validDimensions(width, height)
      ? { mimeType: 'image/webp', extension: 'webp', width, height }
      : null;
  }

  return null;
}

function validDimensions(width: number, height: number): boolean {
  return width > 0 && height > 0 && width <= 20_000 && height <= 20_000;
}
