// `chance(n)` and `random(n)`: what each is typed as, and what each is refused for.

import { describe, expect, it } from 'vitest';

import { valueOf } from '../bindings.js';
import { BOOLEAN, integer } from '../../declare/types.js';
import { locationOf } from '../../source/source.js';
import { checking, expression, read, vessel } from '../../fixtures/check.js';
import { chooser } from '../../fixtures/parse.js';
import type { FreeCallExpr } from '../../syntax/ast.js';
import type { CheckContext } from './checker.js';
import { drawType } from './draws.js';

const freeCall = (text: string): FreeCallExpr => {
  const expr = expression(text);
  if (expr.kind !== 'free-call') throw new Error(`${text} is not a free call`);
  return expr;
};

const refused = (text: string, context: CheckContext = vessel()) => {
  expect(drawType(freeCall(text), checking(context))).toBeNull();
  return context.diagnostics.refusals.map((d) => [locationOf(d.at), d.message, d.remedy]);
};

describe('a draw is typed by what it can give', () => {
  it('types `chance` as a boolean and `random(n)` as an integer from 0 to n − 1', () => {
    expect(drawType(freeCall('chance(3)'), checking(vessel()))).toEqual(valueOf(BOOLEAN));
    expect(drawType(freeCall('random(6)'), checking(vessel()))).toEqual(valueOf(integer(0, 5)));
    expect(drawType(freeCall('random(1)'), checking(vessel()))).toEqual(valueOf(integer(0, 0)));
  });

  it('types every bound a literal may write by exactly its range', () => {
    const c = chooser(33);
    for (let i = 0; i < 200; i++) {
      const n = 1 + c.below(2_147_483_647);
      expect(drawType(freeCall(`random(${n})`), checking(vessel()))).toEqual(
        valueOf(integer(0, n - 1)),
      );
    }
  });

  it('refuses a comparison `random` can never meet, as any literal outside a range', () => {
    const context = vessel();
    expect(read('random(6) == 6', context).type).toBeNull();
    expect(context.diagnostics.refusals[0]!.message).toContain('6');
    expect(read('random(6) == 5', vessel()).type).toEqual(valueOf(BOOLEAN));
  });
});

describe('a draw is given one number above zero, written out', () => {
  it('refuses a number worked out, naming what to write', () => {
    expect(refused('chance(self.count)')).toEqual([
      [
        'b.sprout:1:8',
        '`chance` is given a number written out, and this is worked out.',
        'Write the number itself, as in `chance(3)`, which is true one time in three.',
      ],
    ]);
  });

  it('refuses zero and a negative number', () => {
    expect(refused('random(0)')).toEqual([
      [
        'b.sprout:1:8',
        '`random` is given a number above zero, and this is 0.',
        'Write the number itself, as in `random(6)`, which is a number from 0 to 5.',
      ],
    ]);
    expect(refused('chance(-2)').map(([, message]) => message)).toEqual([
      '`chance` is given a number above zero, and this is -2.',
    ]);
  });

  it('refuses no number, or two', () => {
    expect(refused('chance()').map(([, message]) => message)).toEqual([
      '`chance` is given one thing, and this gives it 0 things.',
    ]);
    expect(refused('random(2, 3)').map(([, message]) => message)).toEqual([
      '`random` is given one thing, and this gives it 2 things.',
    ]);
  });

  it('refuses any other free call, naming the two there are', () => {
    expect(refused('roll(6)')).toEqual([
      [
        'b.sprout:1:1',
        'Sprout does not know how to read `roll` here.',
        'The calls written with nothing before them are `chance(…)` and `random(…)`; a reading is written on what it reads, as in `self.get(:wear)`.',
      ],
    ]);
  });
});

describe('a draw where nothing draws', () => {
  it('is refused whatever it is given, and only for that', () => {
    const context: CheckContext = { ...vessel(), undrawn: { by: 'guard', guard: 'depart' } };
    expect(refused('random(0)', context)).toEqual([
      [
        'b.sprout:1:1',
        '`depart` may not use `random`: a guard is asked as part of a decision it must not change.',
        'Roll in a `do`, a handler or a tick, keep what it gave on a property, and read that here.',
      ],
    ]);
  });
});
