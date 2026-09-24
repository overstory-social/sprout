import { describe, expect, it } from 'vitest';

import { INTEGER_MAX } from '../declare/types.js';
import { elapsedSince, hostSeconds } from './time.js';

describe('host seconds', () => {
  it('are whole seconds from 0', () => {
    expect(hostSeconds(0, 'now')).toBe(0);
    expect(hostSeconds(1_790_000_000, 'now')).toBe(1_790_000_000);
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(() => hostSeconds(bad, 'now')).toThrow('whole seconds from 0');
    }
  });
});

describe('elapsed', () => {
  it('is the seconds between two instants the host gave, 0 when they are one', () => {
    expect(elapsedSince(100, 100)).toBe(0);
    expect(elapsedSince(100, 160)).toBe(60);
    expect(elapsedSince(0, INTEGER_MAX)).toBe(INTEGER_MAX);
  });

  it('is never negative and never past the integer range, since it is supplied truthfully', () => {
    expect(() => elapsedSince(160, 100)).toThrow('does not run backwards');
    expect(() => elapsedSince(0, INTEGER_MAX + 1)).toThrow('more than `elapsed` can carry');
    expect(() => elapsedSince(-5, 10)).toThrow('whole seconds from 0');
  });

  it('agrees with plain subtraction wherever it answers', () => {
    // Generated pairs: every answer is `now - since`, and every refusal is one of the two rules.
    let seed = 12345;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31);
    for (let i = 0; i < 500; i += 1) {
      const since = next() * (i % 3);
      const now = next() * (i % 4);
      const gap = now - since;
      if (gap < 0 || gap > INTEGER_MAX) expect(() => elapsedSince(since, now)).toThrow();
      else expect(elapsedSince(since, now)).toBe(gap);
    }
  });
});
