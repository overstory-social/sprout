import { describe, expect, it } from 'vitest';

import { textOf } from '../source/source.js';
import { engineLine } from './engine-lines.js';

describe('the engine’s own fixed words are one-line passages', () => {
  it('read as prose does, their slots naming what the engine binds, in the standard library', () => {
    const line = engineLine('{item} cannot stand in {to}.');
    expect(line.text).toBe('{item} cannot stand in {to}.');
    expect(line.library).toBe('sprout');
    expect(line.prose.pieces.map((piece) => [piece.kind, textOf(piece.at)])).toEqual([
      ['prose-slot', '{item}'],
      ['prose-words', ' cannot stand in '],
      ['prose-slot', '{to}'],
      ['prose-words', '.'],
    ]);
  });

  it('throw where a line does not read, since that is the engine’s defect and no author’s', () => {
    expect(() => engineLine('{item cannot stand')).toThrow(/does not read/);
  });
});
