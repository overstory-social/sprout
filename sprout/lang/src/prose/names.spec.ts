import { describe, expect, it } from 'vitest';

import { BRASS_KEY, CRATE, ECHO, OAK_DOOR, PRESS, proseTurn } from '../fixtures/prose.js';
import { objectWords } from './names.js';

describe('an object in prose is its article and its name, or “you” to itself', () => {
  it('is “you” to the reader it is, whoever else it is to everyone', () => {
    const turn = proseTurn();
    expect(objectWords(PRESS, PRESS, turn.context)).toBe('you');
    expect(objectWords(turn.marta, turn.marta, turn.context)).toBe('you');
    expect(objectWords(turn.marta, PRESS, turn.context)).toBe('Marta');
  });

  it('names a visitor by their nickname, with no article', () => {
    const turn = proseTurn();
    expect(objectWords(turn.marta, BRASS_KEY, turn.context)).toBe('Marta');
  });

  it('writes the article its grammar gives it, `a` where none is written and `an` before a vowel', () => {
    const turn = proseTurn();
    expect(objectWords(BRASS_KEY, turn.marta, turn.context)).toBe('a brass key');
    expect(objectWords(ECHO, turn.marta, turn.context)).toBe('an echo');
    expect(objectWords(OAK_DOOR, turn.marta, turn.context)).toBe('an oak door');
    expect(objectWords(CRATE, turn.marta, turn.context)).toBe('the crate');
  });

  it('throws for what is not an instance, which nothing in range can be', () => {
    const turn = proseTurn();
    expect(() => objectWords('mill.nowhere' as typeof PRESS, turn.marta, turn.context)).toThrow(
      /not an instance/,
    );
  });
});
