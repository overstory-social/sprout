import { describe, expect, it } from 'vitest';

import { ABBREVIATIONS, directionOf, DIRECTIONS } from './directions.js';

describe('the directions an exit may lead in', () => {
  it('are the spec’s closed set: the four, their diagonals, up, down, in and out', () => {
    expect(DIRECTIONS).toEqual([
      'north',
      'south',
      'east',
      'west',
      'northeast',
      'northwest',
      'southeast',
      'southwest',
      'up',
      'down',
      'in',
      'out',
    ]);
  });

  it('are read written out or by their usual abbreviation, `in` and `out` having none', () => {
    for (const direction of DIRECTIONS) expect(directionOf(direction)).toBe(direction);
    expect([...ABBREVIATIONS]).toEqual([
      ['n', 'north'],
      ['s', 'south'],
      ['e', 'east'],
      ['w', 'west'],
      ['ne', 'northeast'],
      ['nw', 'northwest'],
      ['se', 'southeast'],
      ['sw', 'southwest'],
      ['u', 'up'],
      ['d', 'down'],
    ]);
    expect(directionOf('ne')).toBe('northeast');
    for (const word of ['i', 'o', 'North', 'north-east', 'through', '']) {
      expect(directionOf(word), word).toBeNull();
    }
  });
});
