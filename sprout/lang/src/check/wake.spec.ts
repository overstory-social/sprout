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
    expect(wakeSeconds(wake('wake in (-2) minutes'))).toBe(-120);
  });

  it('leaves a count worked out to the run, where it is not known', () => {
    expect(wakeSeconds(wake('wake in (self.get(:capacity)) minutes'))).toBeNull();
  });

  it('takes any integer expression, as it types any integer', () => {
    for (const text of [
      'wake in (self.get(:capacity)) minutes',
      'wake in (self.get(:capacity) + self.get(:capacity) - 1) hours',
      'wake in (5) seconds',
    ]) {
      expect(checked(text), text).toEqual({ passed: true, said: [] });
    }
  });

  it('refuses a count that is not an integer, at the count, saying what it is and what to write', () => {
    const remedy =
      'Work it out as a whole number, as in `wake in (self.get(:delay)) minutes`, where `:delay` is an integer.';
    expect(checked('wake in (self.get(:inked)) minutes')).toEqual({
      passed: false,
      said: [
        [
          'body.sprout:1:10',
          'self.get(:inked)',
          'How long a wake waits is a whole number, and this is true or false.',
          remedy,
        ],
      ],
    });
    expect(checked('wake in ("soon") hours').said[0]![2]).toBe(
      'How long a wake waits is a whole number, and "soon" is text in quotes.',
    );
    expect(checked('wake in (self) hours').said[0]![2]).toBe(
      'How long a wake waits is a whole number, and this is shop.Vessel.',
    );
  });

  it('refuses a count written below nothing, which the checker can tell', () => {
    expect(checked('wake in (-2) minutes')).toEqual({
      passed: false,
      said: [
        [
          'body.sprout:1:10',
          '-2',
          '`wake in (-2) minutes` waits less than no time at all.',
          "Wait 0 minutes or more; a wait shorter than the host's shortest wake is raised to it.",
        ],
      ],
    });
  });

  it('says only what the expression itself says where it does not type', () => {
    const { passed, said } = checked('wake in (self.get(:nothing)) minutes');
    expect(passed).toBe(false);
    expect(said).toHaveLength(1);
    expect(said[0]![2]).not.toContain('How long a wake waits');
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
