import { describe, expect, it } from 'vitest';
import {
  asNumber,
  asString,
  describeError,
  formatDateTime,
  formatRelative,
  formatUpdatedAt,
} from './format';

describe('format helpers', () => {
  it('handles missing and invalid dates', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('not-a-date')).toBe('not-a-date');
    expect(formatRelative('')).toBe('—');
    expect(formatRelative('not-a-date')).toBe('not-a-date');
  });

  it('describes the fresh-data state deterministically', () => {
    const now = Date.now();

    expect(formatUpdatedAt(0)).toBe('belum dimuat');
    expect(formatUpdatedAt(now, now)).toBe('baru saja');
  });

  it('falls back to strings/numbers safely', () => {
    expect(asString('x')).toBe('x');
    expect(asString(42)).toBe('42');
    expect(asString(null, 'fallback')).toBe('fallback');
    expect(asNumber(7)).toBe(7);
    expect(asNumber('7', 9)).toBe(9);
  });

  it('unwraps a plain Error message', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
    expect(describeError('nope')).toBe('Terjadi kesalahan tidak dikenal.');
  });
});
