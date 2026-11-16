export interface ThemeFormValues {
  primary: string;
  onPrimary: string;
  background: string;
  surface: string;
  textPrimary: string;
  textMuted: string;
  fontFamily: string;
  fontSizeBase: string;
  fontSizeHeading: string;
  radius: string;
  buttonBackground: string;
  buttonText: string;
  buttonRadius: string;
  buttonPaddingX: string;
  buttonPaddingY: string;
}

export const DEFAULT_THEME_FORM: ThemeFormValues = {
  primary: '#0d6efd',
  onPrimary: '#ffffff',
  background: '#f4f5f7',
  surface: '#ffffff',
  textPrimary: '#111827',
  textMuted: '#6b7280',
  fontFamily: 'Arial, Helvetica, sans-serif',
  fontSizeBase: '15px',
  fontSizeHeading: '24px',
  radius: '8px',
  buttonBackground: '#0d6efd',
  buttonText: '#ffffff',
  buttonRadius: '6px',
  buttonPaddingX: '20px',
  buttonPaddingY: '12px',
};

export const FONT_OPTIONS = [
  'Arial, Helvetica, sans-serif',
  'Helvetica, Arial, sans-serif',
  'Verdana, Geneva, sans-serif',
  'Tahoma, Verdana, sans-serif',
  'Georgia, Times New Roman, serif',
  'Times New Roman, Times, serif',
  'system-ui, -apple-system, Segoe UI, sans-serif',
];

export type LayoutPresetId = 'transactional' | 'promo' | 'notification';
export type PartialPresetId = 'header' | 'footer' | 'cta' | 'signature';

export interface LayoutOptions {
  logoUrl: string;
  brandName: string;
  footerText: string;
  unsubscribeUrl: string;
}

export interface PartialOptions {
  brandName: string;
  logoUrl: string;
  tagline: string;
  footerText: string;
  unsubscribeUrl: string;
  ctaLabel: string;
  ctaUrl: string;
  personName: string;
  personRole: string;
}

export const LAYOUT_PRESETS: Array<{
  id: LayoutPresetId;
  label: string;
  description: string;
}> = [
  {
    id: 'transactional',
    label: 'Transaksional',
    description: 'Satu kolom, header brand, body, footer. Cocok untuk order/status.',
  },
  {
    id: 'promo',
    label: 'Promo',
    description: 'Header lebih ekspresif untuk campaign/promo, tetap satu kolom.',
  },
  {
    id: 'notification',
    label: 'Notifikasi',
    description: 'Ringkas dan rapat untuk notifikasi/security alert.',
  },
];

export const PARTIAL_PRESETS: Array<{
  id: PartialPresetId;
  label: string;
  description: string;
}> = [
  { id: 'header', label: 'Header', description: 'Logo + nama brand + tagline.' },
  { id: 'footer', label: 'Footer', description: 'Teks footer + link unsubscribe.' },
  { id: 'cta', label: 'CTA', description: 'Tombol aksi dengan variabel CTA.' },
  { id: 'signature', label: 'Signature', description: 'Nama dan jabatan pengirim.' },
];

export const DEFAULT_LAYOUT_OPTIONS: LayoutOptions = {
  logoUrl: '',
  brandName: 'Nama Brand',
  footerText: 'Anda menerima email ini karena terdaftar di layanan kami.',
  unsubscribeUrl: 'https://example.com/unsubscribe',
};

export const DEFAULT_PARTIAL_OPTIONS: PartialOptions = {
  brandName: 'Nama Brand',
  logoUrl: '',
  tagline: 'Kabar terbaru dari kami',
  footerText: 'Anda menerima email ini karena terdaftar di layanan kami.',
  unsubscribeUrl: 'https://example.com/unsubscribe',
  ctaLabel: 'Lihat detail',
  ctaUrl: '{{cta.url}}',
  personName: 'Nama Pengirim',
  personRole: 'Customer Success',
};

const PREVIEW_BODY =
  '<h1 style="margin:0 0 12px;font-family:{{theme.font.family}};font-size:{{theme.font.sizeHeading}};line-height:1.25;color:{{theme.text.primary}}">Halo Budi</h1>' +
  '<p style="margin:0 0 16px;font-family:{{theme.font.family}};font-size:{{theme.font.sizeBase}};line-height:1.6;color:{{theme.text.primary}}">Pesanan <strong>INV-2026-001</strong> sudah dikirim. Terima kasih telah berbelanja.</p>' +
  '<p style="margin:24px 0"><a href="#" style="display:inline-block;padding:{{theme.button.paddingY}} {{theme.button.paddingX}};background:{{theme.button.background}};color:{{theme.button.color}};border-radius:{{theme.button.radius}};text-decoration:none;font-family:{{theme.font.family}};font-size:{{theme.font.sizeBase}}">Lacak pesanan</a></p>';

export function themeTokensFromForm(form: ThemeFormValues): Record<string, unknown> {
  return {
    brand: {
      primary: form.primary,
      onPrimary: form.onPrimary,
      background: form.background,
      surface: form.surface,
    },
    text: {
      primary: form.textPrimary,
      muted: form.textMuted,
    },
    font: {
      family: form.fontFamily,
      sizeBase: form.fontSizeBase,
      sizeHeading: form.fontSizeHeading,
    },
    radius: {
      md: form.radius,
    },
    button: {
      background: form.buttonBackground,
      color: form.buttonText,
      radius: form.buttonRadius,
      paddingX: form.buttonPaddingX,
      paddingY: form.buttonPaddingY,
    },
  };
}

export function themeFormFromTokens(tokens: unknown): ThemeFormValues {
  const source = isRecord(tokens) ? tokens : {};

  return {
    primary: readString(source, 'brand.primary', DEFAULT_THEME_FORM.primary),
    onPrimary: readString(source, 'brand.onPrimary', DEFAULT_THEME_FORM.onPrimary),
    background: readString(source, 'brand.background', DEFAULT_THEME_FORM.background),
    surface: readString(source, 'brand.surface', DEFAULT_THEME_FORM.surface),
    textPrimary: readString(source, 'text.primary', DEFAULT_THEME_FORM.textPrimary),
    textMuted: readString(source, 'text.muted', DEFAULT_THEME_FORM.textMuted),
    fontFamily: readString(source, 'font.family', DEFAULT_THEME_FORM.fontFamily),
    fontSizeBase: readString(source, 'font.sizeBase', DEFAULT_THEME_FORM.fontSizeBase),
    fontSizeHeading: readString(source, 'font.sizeHeading', DEFAULT_THEME_FORM.fontSizeHeading),
    radius: readString(source, 'radius.md', DEFAULT_THEME_FORM.radius),
    buttonBackground: readString(
      source,
      'button.background',
      readString(source, 'brand.primary', DEFAULT_THEME_FORM.buttonBackground),
    ),
    buttonText: readString(
      source,
      'button.color',
      readString(source, 'brand.onPrimary', DEFAULT_THEME_FORM.buttonText),
    ),
    buttonRadius: readString(source, 'button.radius', DEFAULT_THEME_FORM.buttonRadius),
    buttonPaddingX: readString(source, 'button.paddingX', DEFAULT_THEME_FORM.buttonPaddingX),
    buttonPaddingY: readString(source, 'button.paddingY', DEFAULT_THEME_FORM.buttonPaddingY),
  };
}

export function buildLayoutHtml(preset: LayoutPresetId, options: LayoutOptions): string {
  const logo = safeHttpUrl(options.logoUrl);
  const unsubscribe = safeHttpUrl(options.unsubscribeUrl);
  const brand = escapeHtml(options.brandName.trim()) || 'Nama Brand';
  const footer = escapeHtml(options.footerText.trim()).replace(/\n/g, '<br>');
  const isPromo = preset === 'promo';
  const isNotification = preset === 'notification';
  const headerPadding = isNotification ? '20px 24px' : isPromo ? '32px 24px 20px' : '24px';
  const bodyPadding = isNotification ? '20px 24px' : '8px 32px 32px';

  const logoHtml =
    logo.length > 0
      ? `<img src="${escapeAttr(logo)}" alt="${escapeAttr(brand)}" width="160" style="display:block;max-width:160px;height:auto;border:0;margin:0 auto 12px">`
      : '';

  const header =
    `<tr><td align="center" style="padding:${headerPadding};text-align:center">` +
    `${logoHtml}` +
    `<div style="font-family:{{default theme.font.family "Arial, Helvetica, sans-serif"}};font-size:${isPromo ? '22px' : '18px'};font-weight:700;letter-spacing:0.2px;color:{{default theme.text.primary "#111827"}}">${brand}</div>` +
    (isPromo
      ? '<div style="margin-top:6px;font-family:{{default theme.font.family "Arial, Helvetica, sans-serif"}};font-size:13px;color:{{default theme.text.muted "#6b7280"}}">Penawaran spesial untuk Anda</div>'
      : '') +
    '</td></tr>';

  const footerHtml =
    `<tr><td style="padding:20px 24px;border-top:1px solid #e5e7eb;text-align:center;font-family:{{default theme.font.family "Arial, Helvetica, sans-serif"}};font-size:12px;line-height:1.6;color:{{default theme.text.muted "#6b7280"}}">` +
    `${footer}` +
    (unsubscribe.length > 0
      ? `<br><a href="${escapeAttr(unsubscribe)}" style="color:{{default theme.text.muted "#6b7280"}};text-decoration:underline">Berhenti berlangganan</a>`
      : '') +
    '</td></tr>';

  return `<!doctype html>
<html lang="{{lang}}" dir="{{dir}}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <style>
    body { margin: 0; padding: 0; }
    @media only screen and (max-width: 480px) {
      .nh-container { width: 100% !important; }
      .nh-pad { padding-left: 16px !important; padding-right: 16px !important; }
    }
    @media (prefers-color-scheme: dark) {
      .nh-body { background: #111827 !important; }
      .nh-surface { background: #1f2937 !important; }
      .nh-text { color: #f9fafb !important; }
    }
  </style>
</head>
<body class="nh-body" style="margin:0;padding:0;background:{{default theme.brand.background "#f4f5f7"}}">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">{{preheader}}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:{{default theme.brand.background "#f4f5f7"}}">
    <tr>
      <td align="center" style="padding:${isNotification ? '16px 8px' : '24px 12px'}">
        <table role="presentation" class="nh-container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:{{default theme.brand.surface "#ffffff"}};border-radius:{{default theme.radius.md "8px"}};overflow:hidden">
          ${header}
          <tr>
            <td class="nh-pad nh-text" style="padding:${bodyPadding};font-family:{{default theme.font.family "Arial, Helvetica, sans-serif"}};font-size:{{default theme.font.sizeBase "15px"}};line-height:1.6;color:{{default theme.text.primary "#111827"}}">
              {{{body}}}
            </td>
          </tr>
          ${footerHtml}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function buildPartialHtml(preset: PartialPresetId, options: PartialOptions): string {
  const brand = escapeHtml(options.brandName.trim()) || 'Nama Brand';
  const logo = safeHttpUrl(options.logoUrl);
  const tagline = escapeHtml(options.tagline.trim());
  const footer = escapeHtml(options.footerText.trim()).replace(/\n/g, '<br>');
  const unsubscribe = safeHttpUrl(options.unsubscribeUrl);
  const ctaLabel = escapeHtml(options.ctaLabel.trim()) || 'Lihat detail';
  const ctaUrl = safeTemplateUrl(options.ctaUrl) ?? '{{cta.url}}';
  const personName = escapeHtml(options.personName.trim()) || 'Nama Pengirim';
  const personRole = escapeHtml(options.personRole.trim());

  if (preset === 'header') {
    return (
      `<div style="padding:8px 0 20px;text-align:center">` +
      (logo.length > 0
        ? `<img src="${escapeAttr(logo)}" alt="${escapeAttr(brand)}" width="140" style="display:block;max-width:140px;height:auto;border:0;margin:0 auto 10px">`
        : '') +
      `<div style="font-family:{{default theme.font.family "Arial, Helvetica, sans-serif"}};font-size:18px;font-weight:700;color:{{default theme.text.primary "#111827"}}">${brand}</div>` +
      (tagline.length > 0
        ? `<div style="margin-top:4px;font-family:{{default theme.font.family "Arial, Helvetica, sans-serif"}};font-size:13px;color:{{default theme.text.muted "#6b7280"}}">${tagline}</div>`
        : '') +
      `</div>`
    );
  }

  if (preset === 'footer') {
    return (
      `<div style="padding-top:20px;border-top:1px solid #e5e7eb;text-align:center;font-family:{{default theme.font.family "Arial, Helvetica, sans-serif"}};font-size:12px;line-height:1.6;color:{{default theme.text.muted "#6b7280"}}">` +
      `${footer}` +
      (unsubscribe.length > 0
        ? `<br><a href="${escapeAttr(unsubscribe)}" style="color:{{default theme.text.muted "#6b7280"}};text-decoration:underline">Berhenti berlangganan</a>`
        : '') +
      `</div>`
    );
  }

  if (preset === 'cta') {
    return (
      `<div style="padding:8px 0;text-align:center">` +
      `<a href="${escapeAttr(ctaUrl)}" style="display:inline-block;padding:{{default theme.button.paddingY "12px"}} {{default theme.button.paddingX "20px"}};background:{{default theme.button.background "#0d6efd"}};color:{{default theme.button.color "#ffffff"}};border-radius:{{default theme.button.radius "6px"}};text-decoration:none;font-family:{{default theme.font.family "Arial, Helvetica, sans-serif"}};font-size:{{default theme.font.sizeBase "15px"}}">${ctaLabel}</a>` +
      `</div>`
    );
  }

  return (
    `<div style="padding:16px 0;font-family:{{default theme.font.family "Arial, Helvetica, sans-serif"}};font-size:14px;line-height:1.6;color:{{default theme.text.primary "#111827"}}">` +
    `<div style="font-weight:700">${personName}</div>` +
    (personRole.length > 0
      ? `<div style="color:{{default theme.text.muted "#6b7280"}}">${personRole}</div>`
      : '') +
    `</div>`
  );
}

export function buildThemeSampleHtml(form: ThemeFormValues): string {
  return renderAssetPreview(
    buildLayoutHtml('transactional', DEFAULT_LAYOUT_OPTIONS),
    themeTokensFromForm(form),
    { body: PREVIEW_BODY },
  );
}

export function renderAssetPreview(
  content: string,
  tokens: unknown,
  options: { body?: string; partial?: boolean } = {},
): string {
  const theme = isRecord(tokens) ? tokens : {};
  let result = content;

  result = result.replace(
    /\{\{\s*default\s+([a-zA-Z0-9_.]+)\s+["']([^"']*)["']\s*\}\}/g,
    (_full, path: string, fallback: string) =>
      readString(theme, stripThemePrefix(path), fallback),
  );
  result = result.replace(/\{\{\s*theme\.([a-zA-Z0-9_.]+)\s*\}\}/g, (_full, path: string) =>
    readString(theme, path, ''),
  );
  result = result.replace(/\{\{\{\s*body\s*\}\}\}/g, options.body ?? PREVIEW_BODY);
  result = result.replace(/\{\{\s*preheader\s*\}\}/g, 'Pratinjau email');
  result = result.replace(/\{\{\s*lang\s*\}\}/g, 'id');
  result = result.replace(/\{\{\s*dir\s*\}\}/g, 'ltr');
  result = result.replace(/\{\{\s*cta\.label\s*\}\}/g, 'Lihat detail');
  result = result.replace(/\{\{\s*cta\.url\s*\}\}/g, '#');
  result = result.replace(/\{\{\s*customer\.name\s*\}\}/g, 'Budi');

  if (options.partial === true || !/<html[\s>]/i.test(result)) {
    const surface = readString(theme, 'brand.surface', '#ffffff');
    const background = readString(theme, 'brand.background', '#f4f5f7');
    const font = readString(theme, 'font.family', 'Arial, Helvetica, sans-serif');
    const text = readString(theme, 'text.primary', '#111827');

    result =
      `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http:; style-src 'unsafe-inline'; script-src 'none'; form-action 'none'; base-uri 'none'"></head>` +
      `<body style="margin:0;padding:24px;background:${escapeAttr(background)}">` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">` +
      `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background:${escapeAttr(surface)};border-radius:8px">` +
      `<tr><td style="padding:24px;font-family:${escapeAttr(font)};font-size:15px;line-height:1.6;color:${escapeAttr(text)}">${result}</td></tr>` +
      `</table></td></tr></table></body></html>`;
  }

  return injectPreviewCsp(result);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function safeHttpUrl(value: string): string {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return '';
  }

  try {
    const url = new URL(trimmed);

    return url.protocol === 'http:' || url.protocol === 'https:' ? trimmed : '';
  } catch {
    return '';
  }
}

function safeTemplateUrl(value: string): string | null {
  const trimmed = value.trim();

  if (/^\{\{\s*[a-zA-Z_][a-zA-Z0-9_.]*\s*\}\}$/.test(trimmed)) {
    return trimmed;
  }

  const safe = safeHttpUrl(trimmed);

  return safe.length > 0 ? safe : null;
}

function injectPreviewCsp(html: string): string {
  const csp =
    "default-src 'none'; img-src https: http:; style-src 'unsafe-inline'; font-src data:; connect-src 'none'; script-src 'none'; form-action 'none'; base-uri 'none'";
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;

  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${meta}`);
  }

  return `<!doctype html><html><head><meta charset="utf-8">${meta}</head><body>${html}</body></html>`;
}

function readString(source: Record<string, unknown>, path: string, fallback: string): string {
  const value = readPath(source, path);

  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function readPath(source: Record<string, unknown>, path: string): unknown {
  let current: unknown = source;

  for (const segment of path.split('.')) {
    if (!isRecord(current)) {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

function stripThemePrefix(path: string): string {
  return path.startsWith('theme.') ? path.slice('theme.'.length) : path;
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
