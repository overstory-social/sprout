// `readable`, directly: the shape of a list as a diagnostic writes it.

import { describe, expect, it } from 'vitest';

import { readable } from './words.js';

describe('a list of words, as a person reads one', () => {
  it('names none as `nothing`, one plainly, two with `and`, and more with commas', () => {
    expect(readable([])).toBe('nothing');
    expect(readable(['a'])).toBe('`a`');
    expect(readable(['a', 'b'])).toBe('`a` and `b`');
    expect(readable(['a', 'b', 'c'])).toBe('`a`, `b` and `c`');
  });

  it('keeps the order it was given, and quotes each word on its own', () => {
    expect(readable(['zeta', 'alpha'])).toBe('`zeta` and `alpha`');
    expect(readable([':x', 'visitors are'])).toBe('`:x` and `visitors are`');
  });
});
