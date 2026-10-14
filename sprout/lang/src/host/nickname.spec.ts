import { describe, expect, it } from 'vitest';

import { keptNickname, moderated } from './nickname.js';

describe('a nickname', () => {
  it('is kept as its words, single-spaced', () => {
    expect(keptNickname('  Marta \t B\n')).toBe('Marta B');
    expect(keptNickname('Ines')).toBe('Ines');
  });

  it('declined by the host’s moderation is refused in words asking for another', () => {
    expect(moderated('Marta')).toEqual({
      reason: 'moderated',
      nickname: 'Marta',
      collides: [],
      words: 'That nickname cannot be used here: choose another.',
    });
  });
});
