import { decodeHtmlEntities } from './template.safety';

const MAX_PLAIN_TEXT_LENGTH = 100_000;

/**
 * Best-effort HTML to plain-text conversion for the multipart/alternative email part.
 *
 * This deliberately does not parse HTML with a dependency: the input is already the sanitized
 * email document produced by the renderer, and the output is only a fallback for clients that
 * prefer text. Callers must treat `null` as "send HTML only".
 */
export function htmlToPlainText(html: string): string | null {
  if (html.trim().length === 0) {
    return null;
  }

  let output = html;

  // Comments (including conditional comments) never carry visible content.
  output = output.replace(/<!--[\s\S]*?-->/g, '');
  output = output.replace(/<(head|style|script|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');

  // Explicit opt-out for hidden content such as the preheader.
  output = output.replace(
    /<([a-z][a-z0-9]*)\b[^>]*\bdata-nh-text-skip\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    '',
  );

  // Legacy layouts mark the preheader by style rather than by data attribute.
  output = output.replace(
    /<div\b[^>]*style\s*=\s*["'][^"']*(?:display\s*:\s*none|max-height\s*:\s*0)[^"']*["'][^>]*>[\s\S]*?<\/div\s*>/gi,
    '',
  );

  output = output.replace(/<img\b[^>]*>/gi, (tag) => {
    const alt = attributeValue(tag, 'alt').trim();

    return alt.length > 0 ? alt : '[gambar]';
  });

  output = output.replace(
    /<a\b[^>]*href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a\s*>/gi,
    (_full, href: string, label: string) => {
      const cleanHref = decodeHtmlEntities(href).trim();
      const cleanLabel = stripTags(label).replace(/\s+/g, ' ').trim();

      if (cleanLabel.length === 0) {
        return cleanHref;
      }

      if (
        /^(https?:\/\/|mailto:)/i.test(cleanHref) &&
        cleanHref !== cleanLabel &&
        !cleanLabel.includes(cleanHref)
      ) {
        return `${cleanLabel} (${cleanHref})`;
      }

      return cleanLabel;
    },
  );

  output = output.replace(/<br\s*\/?>/gi, '\n');
  output = output.replace(/<hr\b[^>]*>/gi, '\n---\n');
  output = output.replace(/<li\b[^>]*>/gi, '\n- ');
  output = output.replace(/<\/li\s*>/gi, '\n');
  output = output.replace(/<\/td\s*>/gi, '\n');
  output = output.replace(
    /<\/?(?:p|div|h[1-6]|tr|table|ul|ol|blockquote|section|article|header|footer|main)\b[^>]*>/gi,
    '\n\n',
  );

  output = stripTags(output);
  output = decodeHtmlEntities(output);
  output = output.replace(/\u00a0/g, ' ');
  output = output.replace(/\r\n?/g, '\n');

  const lines = output
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (lines.length === 0) {
    return null;
  }

  return lines.slice(0, MAX_PLAIN_TEXT_LENGTH).trim();
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, '');
}

function attributeValue(tag: string, name: string): string {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);

  return decodeHtmlEntities(match?.[2] ?? match?.[3] ?? '');
}
