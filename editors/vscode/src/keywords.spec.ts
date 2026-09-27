import { RESERVED_WORDS } from '@overstory/sprout';
import { describe, expect, it } from 'vitest';
import { LITERALS, TYPE_NAMES, syntaxWords, wordsPattern } from './keywords.ts';

describe('the reserved words, sorted for colouring', () => {
  it('are exactly the compiler’s, each in one group', () => {
    const groups = [...LITERALS, ...TYPE_NAMES, ...syntaxWords()];
    expect(new Set(groups).size).toBe(groups.length);
    expect(new Set(groups)).toEqual(new Set(RESERVED_WORDS));
  });

  it('keep literals and type names out of the syntax words', () => {
    for (const w of [...LITERALS, ...TYPE_NAMES]) expect(syntaxWords()).not.toContain(w);
  });

  it('match whole words only', () => {
    const re = new RegExp(wordsPattern(['in', 'into']));
    expect('go into it'.match(re)?.[0]).toBe('into');
    expect(re.test('inside')).toBe(false);
    expect(re.test('begin')).toBe(false);
  });
});
