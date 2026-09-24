import { describe, expect, it } from 'vitest';

import {
  actorOf,
  BLANK,
  CATALOGUE,
  CELLAR,
  HALL,
  INES,
  LAMP,
  lookingAt,
  MARTA,
  MIRROR,
  STOOL,
  study,
} from '../fixtures/describe.js';
import { words } from '../fixtures/reading.js';
import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { WORLD_PASSES_ANYTHING } from '../declare/world.js';
import { Budget, BudgetExhausted } from './budget.js';
import { describeFor } from './describe.js';
import type { InstanceId } from './ids.js';
import { readerOf } from './state.js';

describe('a description', () => {
  it('is each `text` the describe ran, in order, from the thing, to the one looking', () => {
    const state = study();
    const marta = actorOf(state, MARTA);
    const described = describeFor(LAMP, marta, lookingAt(state));
    expect(described.of).toBe(LAMP);
    expect(described.to).toBe(marta);
    expect(
      described.lines.map((line) => [line.effect, line.to, line.by, words(line.said)]),
    ).toEqual([
      ['described', [marta], LAMP, 'study.Lamp dark: The lamp is dark.'],
      ['described', [marta], LAMP, 'It hangs from a hook.'],
    ]);
  });

  it('runs the branch its state picks, and reads as the state is now', () => {
    const state = study(undefined, [[LAMP, 'lit', true]]);
    const lines = describeFor(LAMP, actorOf(state, MARTA), lookingAt(state)).lines;
    expect(lines.map((line) => words(line.said))).toEqual([
      'The lamp burns.',
      'It hangs from a hook.',
    ]);
  });

  it('binds `actor` to whoever looks and `here` to their place, and a `let` to the lines after it', () => {
    const state = study();
    const marta = actorOf(state, MARTA);
    const [greeting] = describeFor(MIRROR, marta, lookingAt(state)).lines;
    expect(Object.fromEntries(greeting!.bindings)).toEqual({
      actor: { binds: 'object', id: marta },
      here: { binds: 'object', id: HALL },
    });
    const crowded = study([
      [MARTA, HALL, 'Marta'],
      [INES, HALL, 'Ines'],
    ]);
    const hall = describeFor(HALL, actorOf(crowded, MARTA), lookingAt(crowded)).lines;
    expect(hall.map((line) => words(line.said))).toEqual([
      'A long hall.',
      'A box stands by the wall.',
      'It is crowded, with {count} in it.',
    ]);
    expect(hall[2]!.bindings.get('count')).toEqual({ binds: 'value', value: 8 });
  });

  it('carries the world’s `unremarkable`, with `thing` the thing, for when it says nothing', () => {
    const state = study();
    const marta = actorOf(state, MARTA);
    for (const thing of [STOOL, CELLAR, BLANK]) {
      const { lines, unremarkable } = describeFor(thing, marta, lookingAt(state));
      expect(lines, thing).toEqual([]);
      expect(unremarkable.effect).toBe('described');
      expect(unremarkable.by).toBe(state.world);
      expect(unremarkable.to).toEqual([marta]);
      expect(words(unremarkable.said)).toBe(
        'sprout.World unremarkable: There is nothing special about {thing}.',
      );
      expect(Object.fromEntries(unremarkable.bindings)).toEqual({
        thing: { binds: 'object', id: thing },
      });
    }
  });

  it('is charged a step for each statement, so a describe too dear faults as any work does', () => {
    const state = study();
    const context = (steps: number) => ({
      ...lookingAt(state),
      budget: new Budget({ ...DEFAULT_LIMITS.budgets, pollSteps: steps }, 'poll'),
    });
    expect(() => describeFor(HALL, actorOf(state, MARTA), context(2))).toThrow(BudgetExhausted);
    expect(() => describeFor(HALL, actorOf(state, MARTA), context(1_000))).not.toThrow();
  });

  it('is asked of an instance by one who stands somewhere, and anything else is the engine’s defect', () => {
    const state = study();
    const context = {
      state: readerOf(state),
      catalogue: CATALOGUE,
      budget: new Budget(DEFAULT_LIMITS.budgets, 'poll'),
      passes: () => WORLD_PASSES_ANYTHING,
    };
    expect(() => describeFor('study#99' as InstanceId, actorOf(state, MARTA), context)).toThrow(
      /is not an instance/,
    );
    expect(() => describeFor(LAMP, state.world, context)).toThrow(/is away/);
  });
});
