import { describe, expect, it } from 'vitest';

import { DIRECTIONS } from '../syntax/directions.js';
import { DIRECTION } from './direction.js';

describe('the type of `way` in an `after command`', () => {
  it('is an enum whose options are the closed set of directions, written out, in order', () => {
    expect(DIRECTION.name).toBe('Direction');
    expect(DIRECTION.options).toEqual([...DIRECTIONS]);
    expect(DIRECTION.options).toContain('in');
    expect(DIRECTION.options).not.toContain('n');
  });

  it('points each option, and its name, at its own words', () => {
    const { declaration } = DIRECTION;
    const text = declaration.at.source.text;
    expect(text.slice(declaration.name.at.start, declaration.name.at.end)).toBe('Direction');
    for (const option of declaration.options) {
      expect(text.slice(option.at.start, option.at.end)).toBe(option.name.text);
    }
    expect(declaration.options.map((option) => option.name.text)).toEqual([...DIRECTIONS]);
  });
});
