import { describe, expect, it } from 'vitest';

import type { GuardRef } from '../syntax/ast.js';
import { SourceFile } from '../source/source.js';
import { composeContributions, composedWhereSame } from './contributions.js';
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

  it('holds a composed kind’s own array where the composer runs just what it runs', () => {
    const inherited = [from('A'), from('B')];
    const runs = composeContributions(
      [[inherited[0]!], inherited],
      ['A', 'B'],
      [],
      undefined,
      leavesOut,
    );
    expect(runs).toBe(inherited);
    const added = composeContributions([inherited], ['A', 'B'], [], from('D'), leavesOut);
    expect(added).not.toBe(inherited);
    expect(added.map((one) => one.origin)).toEqual(['A', 'B', 'D']);
  });
});

describe('a composer’s map of runs', () => {
  const run = [from('A')];
  it('is the composed kind’s where it holds the same runs under the same keys in order', () => {
    const composed = new Map([['x', run]]);
    expect(composedWhereSame(new Map([['x', run]]), [new Map(), composed])).toBe(composed);
  });

  it('is its own where a key, a run or the order differs', () => {
    const made = new Map([
      ['x', run],
      ['y', run],
    ]);
    const others = [
      new Map([['x', run]]),
      new Map([
        ['x', run],
        ['y', [from('A')]],
      ]),
      new Map([
        ['y', run],
        ['x', run],
      ]),
    ];
    expect(composedWhereSame(made, others)).toBe(made);
  });
});
