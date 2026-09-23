import { describe, expect, it } from 'vitest';

import type { GuardRef } from '../syntax/ast.js';
import { SourceFile } from '../source/source.js';
import { composeContributions } from './contributions.js';
import type { Suppression } from './kinds.js';

const AT = new SourceFile('k.sprout', 'depart').span(0, 6);
const DEPART: GuardRef = { kind: 'guard-ref', at: AT, guard: 'depart' };

/** A contribution by its origin, with a tag to tell two of one origin apart. */
const from = (origin: string, tag = origin) => ({ origin, tag });
const leavesOut = (suppression: Suppression, one: { origin: string }) =>
  suppression.source === one.origin;

describe('the contributions of one member combine', () => {
  it('in closure order, the composer’s own last, each origin once', () => {
    const runs = composeContributions(
      [
        [from('C'), from('A', 'first')],
        [from('A', 'again'), from('B')],
      ],
      ['A', 'B', 'C'],
      [],
      from('D'),
      leavesOut,
    );
    expect(runs.map((one) => one.tag)).toEqual(['first', 'B', 'C', 'D']);
  });

  it('less what the composer leaves out, and with nothing of its own', () => {
    const runs = composeContributions(
      [[from('A'), from('B')]],
      ['A', 'B'],
      [{ member: DEPART, source: 'A' }],
      undefined,
      leavesOut,
    );
    expect(runs.map((one) => one.origin)).toEqual(['B']);
  });
});
