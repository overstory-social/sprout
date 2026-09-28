import { describe, expect, it } from 'vitest';

import { isLevel, keeps, LEVELS } from './levels.js';

describe('levels', () => {
  it('are the spec’s five, from what a person playing reads to everything in full', () => {
    expect(LEVELS).toEqual(['prose', 'error', 'warning', 'info', 'debug']);
    expect(isLevel('warning')).toBe(true);
    expect(isLevel('fatal')).toBe(false);
    expect(isLevel(3)).toBe(false);
  });

  it('filter play down to prose and errors, and keep everything at debug', () => {
    expect(LEVELS.filter((level) => keeps('error', level))).toEqual(['prose', 'error']);
    expect(LEVELS.filter((level) => keeps('debug', level))).toEqual(LEVELS);
    expect(LEVELS.filter((level) => keeps('prose', level))).toEqual(['prose']);
  });
});
