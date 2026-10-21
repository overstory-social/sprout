import { describe, expect, it } from 'vitest';

import type { PassTimeStatement } from '../syntax/ast.js';
import { readStatement } from '../fixtures/parse.js';
import { bodyOf, VESSEL } from '../fixtures/check.js';
import { locationOf, textOf } from '../source/source.js';
import { checkPass } from './pass.js';

/** `text`, read as a `pass`. */
function pass(text: string): PassTimeStatement {
  const { statement, refusals } = readStatement(text);
  expect(refusals, text).toEqual([]);
  if (statement?.kind !== 'pass-time') throw new Error(`${text} is not a pass`);
  return statement;
}

/** What checking `text` in a vessel's body said, where and in what words. */
function checked(text: string) {
  const context = bodyOf(VESSEL);
  const passed = checkPass(pass(text), context);
  const said = context.diagnostics.refusals.map((d) => [
    locationOf(d.at),
    textOf(d.at),
    d.message,
    d.remedy,
  ]);
  return { passed, said };
}

describe('how much time a pass asks for', () => {
  it('takes a whole number written out, and any integer expression', () => {
    for (const text of [
      'pass 90 seconds',
      'pass 0 minutes',
      'pass (self.get(:capacity)) minutes',
      'pass (self.get(:capacity) + 2 - 1) hours',
    ]) {
      expect(checked(text), text).toEqual({ passed: true, said: [] });
    }
  });

  it('refuses a count that is not an integer, at the count, saying what it is and what to write', () => {
    const { passed, said } = checked('pass (self.get(:inked)) minutes');
    expect(passed).toBe(false);
    expect(said).toHaveLength(1);
    expect(said[0]!.slice(0, 2)).toEqual(['body.sprout:1:7', 'self.get(:inked)']);
    expect(said[0]![2]).toMatch(/^How much time passes is a whole number, and /);
    expect(said[0]![3]).toBe(
      'Work it out as a whole number, as in `pass (self.get(:wait)) minutes`, where `:wait` is an integer.',
    );
  });

  it('refuses a count written below nothing, or past what an integer of seconds holds', () => {
    expect(checked('pass (-2) minutes')).toEqual({
      passed: false,
      said: [
        [
          'body.sprout:1:7',
          '-2',
          '`pass (-2) minutes` passes less than no time at all.',
          'Pass 0 minutes or more.',
        ],
      ],
    });
    expect(checked('pass 600000 hours').said).toEqual([
      [
        'body.sprout:1:6',
        '600000',
        '`pass 600000 hours` asks for more time than a pass can.',
        'Pass at most 596523 hours; the host lets no more than its longest pass go by.',
      ],
    ]);
  });
});
