import { describe, expect, it } from 'vitest';
import { computeBackoffDelay } from '../src/sse';
import type { RetryOptions } from '../src/types';

const OPTIONS: RetryOptions = { maxAttempts: 4, baseDelayMs: 1000, maxDelayMs: 30000 };

describe('computeBackoffDelay', () => {
  it('applies exponential growth with jitter bounds', () => {
    const first = computeBackoffDelay(1, OPTIONS);
    expect(first).toBeGreaterThanOrEqual(1000);
    expect(first).toBeLessThanOrEqual(1250);

    const second = computeBackoffDelay(2, OPTIONS);
    expect(second).toBeGreaterThanOrEqual(2000);
    expect(second).toBeLessThanOrEqual(2500);
  });

  it('caps the delay at maxDelayMs', () => {
    expect(computeBackoffDelay(50, OPTIONS)).toBe(30000);
  });

  it('never returns a negative delay', () => {
    expect(computeBackoffDelay(0, OPTIONS)).toBeGreaterThan(0);
  });
});
