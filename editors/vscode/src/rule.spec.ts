import { describe, expect, it } from 'vitest';
import { named } from './rule.ts';

describe('named captures', () => {
  it('number the groups from 1 and leave out the ones given no name', () => {
    expect(named('a', undefined, 'c')).toEqual({ '1': { name: 'a' }, '3': { name: 'c' } });
  });
});
