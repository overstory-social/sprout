import { describe, expect, it } from 'vitest';

import type { WakeStatement } from '../syntax/ast.js';
import { INTEGER_MAX } from '../declare/types.js';
import { readStatement } from '../fixtures/parse.js';
import { bodyOf, VESSEL } from '../fixtures/check.js';
import { locationOf, textOf } from '../source/source.js';
import { checkWake, wakeSeconds } from './wake.js';

/** `text`, read as a `wake`. */
function wake(text: string): WakeStatement {
  const { statement, refusals } = readStatement(text);
  expect(refusals, text).toEqual([]);
  if (statement?.kind !== 'wake') throw new Error(`${text} is not a wake`);
  return statement;
}

/** What checking `text` in a vessel's body said, where and in what words. */
function checked(text: string) {
  const context = bodyOf(VESSEL);
  const passed = checkWake(wake(text), context);
  const said = context.diagnostics.refusals.map((d) => [
    locationOf(d.at),
    textOf(d.at),
    d.message,
    d.remedy,
  ]);
  return { passed, said };
}

describe('how long a wake waits', () => {
  it('counts in seconds, whatever unit it was written in', () => {
    expect(wakeSeconds(wake('wake in 90 seconds'))).toBe(90);
    expect(wakeSeconds(wake('wake in 40 minutes'))).toBe(2400);
    expect(wakeSeconds(wake('wake in 3 hours'))).toBe(10_800);
  });

  it('takes any wait `elapsed` can carry, the host’s floor being the host’s to apply', () => {
    for (const text of [
      'wake in 0 seconds',
      'wake in 5 seconds',
      `wake in ${INTEGER_MAX} seconds`,
    ]) {
      expect(checked(text), text).toEqual({ passed: true, said: [] });
    }
    expect(checked(`wake in ${Math.floor(INTEGER_MAX / 3600)} hours`).passed).toBe(true);
  });

  it('refuses a wait longer than `elapsed` can carry, at the count, naming the most there is', () => {
    expect(checked(`wake in ${Math.floor(INTEGER_MAX / 3600) + 1} hours`)).toEqual({
      passed: false,
      said: [
        [
          'body.sprout:1:9',
          '596524',
          '`wake in 596524 hours` waits longer than a wake can.',
          'Wait at most 596523 hours, and ask again with `wake in` when it arrives if it must be longer.',
        ],
      ],
    });
    expect(checked(`wake in ${INTEGER_MAX + 1} seconds`).said[0]![3]).toBe(
      'Wait at most 2147483647 seconds, and ask again with `wake in` when it arrives if it must be longer.',
    );
  });
});
