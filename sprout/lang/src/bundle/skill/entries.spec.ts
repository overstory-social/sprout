import { describe, expect, it } from 'vitest';

import { entriesFor, type Entry } from './entries.js';

const TABLE: readonly Entry[] = [
  { word: 'b', example: 'b()', means: 'bee' },
  { word: 'a', example: 'a()', means: 'ay' },
  { word: 'gone', example: 'gone()', means: 'a word the compiler does not have' },
];

describe('a skill table held against the compiler’s list', () => {
  it('lists what the compiler’s list holds, in its order, and nothing it lacks', () => {
    expect(entriesFor('reading', ['a', 'b'], TABLE).map((entry) => entry.word)).toEqual(['a', 'b']);
  });

  it('throws for a word the compiler reads that the table does not describe', () => {
    expect(() => entriesFor('reading', ['a', 'new'], TABLE)).toThrow(
      'The reading `new` has no entry in the skill.',
    );
  });
});
