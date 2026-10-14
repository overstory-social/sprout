import { describe, expect, it } from 'vitest';

import { hostSeconds } from './time.js';

describe('host seconds', () => {
  it('are whole seconds from 0, and anything else is refused naming what it was', () => {
    expect(hostSeconds(0, 'now')).toBe(0);
    expect(hostSeconds(1_790_000_000, 'now')).toBe(1_790_000_000);
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(() => hostSeconds(bad, 'a tick’s time')).toThrow(
        `a tick’s time is \`${bad}\`, and the host gives time in whole seconds from 0.`,
      );
    }
  });
});
