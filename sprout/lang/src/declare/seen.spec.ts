import { describe, expect, it } from 'vitest';

import { SEEN, SEEN_OPTIONS } from './seen.js';

describe('the type of `seen`', () => {
  it('is an enum whose options are a look, an arrival and a poll, in that order', () => {
    expect(SEEN.name).toBe('Seen');
    expect(SEEN.options).toEqual(['look', 'arrival', 'poll']);
    expect(SEEN.options).toEqual([...SEEN_OPTIONS]);
  });
});
