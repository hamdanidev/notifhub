import {
  sanitizeEmailHtml,
  validateEmailHtml,
  decodeHtmlEntities,
  isDangerousUrl,
} from '../src/templates/template.safety';

describe('template safety', () => {
  it('menolak script, event handler, dan URL berbahaya', () => {
    const issues = validateEmailHtml(
      '<p onclick="alert(1)">x</p><script>alert(1)</script>' +
        '<a href="javascript:alert(1)">x</a><img src="data:text/html;base64,AA">',
      'body',
    );
    const codes = issues.map((issue) => issue.code);

    expect(codes).toContain('unsafe_html');
    expect(codes).toContain('unsafe_html_attribute');
    expect(codes).toContain('unsafe_url');
  });

  it('membersihkan output dan menghormati batas HTML', () => {
    const sanitized = sanitizeEmailHtml(
      '<p>ok</p><script>alert(1)</script><img src=x onerror="alert(1)">' +
        '<a href="java&#115;cript:alert(1)">x</a>',
    );

    expect(sanitized.removed).toBeGreaterThan(0);
    expect(sanitized.html).not.toContain('<script');
    expect(sanitized.html).not.toContain('onerror');
    expect(sanitized.html).not.toContain('javascript:');
  });

  it('mendekode entitas dan mendeteksi skema berbahaya', () => {
    expect(decodeHtmlEntities('java&#115;cript:alert(1)')).toBe('javascript:alert(1)');
    expect(isDangerousUrl('javascript:alert(1)')).toBe(true);
    expect(isDangerousUrl('java&#115;cript:alert(1)')).toBe(true);
    expect(isDangerousUrl('https://example.com')).toBe(false);
    expect(isDangerousUrl('mailto:qa@example.com')).toBe(false);
    expect(isDangerousUrl('#anchor')).toBe(false);
  });

  it('menangani tag malformed dan uppercase', () => {
    const sanitized = sanitizeEmailHtml(
      '<SCRIPT>alert(1)</SCRIPT><IMG SRC=x ONERROR=alert(1)><SVG/ONLOAD=alert(1)>',
    );

    expect(sanitized.html.toLowerCase()).not.toContain('<script');
    expect(sanitized.html.toLowerCase()).not.toContain('onerror');
    expect(sanitized.html.toLowerCase()).not.toContain('<svg');
  });
});
