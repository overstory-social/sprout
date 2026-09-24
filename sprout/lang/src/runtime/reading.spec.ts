// Who takes part in a reading and in what order, and the consent pass
// that asks each of them first: `participantsOf`, the order `runReading`
// runs every `permit` and `do` in, and `consentPass` as the whole outcome
// when it refuses. `runtime/reading/*.spec.ts` holds the rest of
// `reading.ts`'s own concerns: value roles, the effect pass, a `move` in
// a `do`, and the corpus world `good/roles`.

import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { Budget } from './budget.js';
import { Draws } from './draws.js';
import { IntegerOverflow } from './evaluate.js';
import type { InstanceId } from './ids.js';
import { consentPass, participantsOf, runReading } from './reading.js';
import { readerOf } from './state.js';
import { MEADOW, MOUTH, WAYS, YARD as WAYS_YARD } from '../fixtures/exits.js';
import {
  acted,
  BOTH,
  contextOf,
  DIE,
  GUARD,
  HALL,
  KEY,
  lines,
  LOCK,
  reading,
  refused,
  setOn,
  STONE,
  TOOL,
  TRIP,
  turn,
  W1,
  W2,
  words,
  YARD,
} from '../fixtures/reading.js';

describe('who takes part, and in what order', () => {
  it('is the actor, then the roles as the verb declares them, a set in the order typed', () => {
    const one = turn(YARD, [HALL]);
    const [visitor] = one.people;
    const order = reading(YARD, 'order', visitor!, {
      target: { object: BOTH },
      tool: { object: TOOL },
      weights: { set: [W2, W1] },
    });
    expect(participantsOf(order)).toEqual([
      { id: visitor, role: 'actor' },
      { id: BOTH, role: 'target' },
      { id: TOOL, role: 'tool' },
      { id: W2, role: 'weights' },
      { id: W1, role: 'weights' },
    ]);
  });

  it('leaves out a tool the command left out, and a value role, which nothing plays', () => {
    const one = turn(YARD, [HALL]);
    const [visitor] = one.people;
    const bare = reading(YARD, 'order', visitor!, { target: { object: BOTH } });
    expect(participantsOf(bare).map((p) => p.id)).toEqual([visitor, BOTH]);
    const ask = reading(
      YARD,
      'ask',
      visitor!,
      { target: { object: GUARD }, topic: { value: 'toll' } },
      'sprout',
    );
    expect(participantsOf(ask).map((p) => p.id)).toEqual([visitor, GUARD]);
  });

  it('runs every `do` in that order, each kind composed before its composer', () => {
    const one = turn(YARD, [HALL]);
    const [visitor] = one.people;
    const order = reading(YARD, 'order', visitor!, {
      target: { object: BOTH },
      tool: { object: TOOL },
      weights: { set: [W2, W1] },
    });
    expect(lines(acted(runReading(order, contextOf(one))))).toEqual([
      [visitor, 'actor'],
      [BOTH, 'first'],
      [BOTH, 'second'],
      [BOTH, 'both'],
      [TOOL, 'tool'],
      [W2, 'weight'],
      [W1, 'weight'],
    ]);
    // A participant with no `permit` consented: the weights wrote none.
    expect(one.draft.instance(visitor!)!.properties.get('log')).toBe(1);
  });

  it('refuses at the first `permit` to refuse, in the same order', () => {
    const one = turn(YARD, [HALL]);
    const [visitor] = one.people;
    const order = reading(YARD, 'order', visitor!, {
      target: { object: BOTH },
      tool: { object: TOOL },
    });
    const first = () => words(refused(runReading(order, contextOf(one))).said);
    setOn(one, TOOL, { t: true });
    expect(first()).toBe('The tool balks.');
    setOn(one, BOTH, { c: true });
    expect(first()).toBe('Both balks.');
    setOn(one, BOTH, { b: true });
    expect(first()).toBe('Second balks.');
    setOn(one, BOTH, { a: true });
    expect(first()).toBe('First balks.');
    setOn(one, visitor!, { balks: true });
    const refusal = refused(runReading(order, contextOf(one)));
    expect(refusal).toMatchObject({
      by: visitor,
      role: 'actor',
      origin: 'yard.Creature',
      said: { text: 'The actor balks.' },
    });
    // What the refusing play saw, for its slots: every role, a set left out as empty.
    expect([...refusal.bindings.keys()]).toEqual(['actor', 'here', 'target', 'tool', 'weights']);
  });
});

describe('the effect pass draws', () => {
  it('runs a `do` with the turn’s draws, and each reading draws on from where the last left off', () => {
    const one = turn(YARD, [HALL]);
    const context = contextOf(one);
    const roll = reading(YARD, 'roll', one.people[0]!, { target: { object: DIE } });
    const expected = new Draws(7);
    for (let i = 0; i < 6; i++) {
      runReading(roll, context);
      expect(one.draft.instance(DIE)!.properties.get('face')).toBe(expected.below(6));
    }
    expect(context.draws.drawn).toBe(6);
  });
});

describe('the consent pass', () => {
  it('is the whole outcome when it refuses: no `do` runs and nothing is said or sent', () => {
    const one = turn(YARD, [HALL]);
    const [visitor] = one.people;
    setOn(one, TOOL, { t: true });
    const order = reading(YARD, 'order', visitor!, {
      target: { object: BOTH },
      tool: { object: TOOL },
    });
    const outcome = runReading(order, contextOf(one));
    expect(Object.keys(outcome)).toEqual(['refused']);
    expect(one.draft.instance(visitor!)!.properties.get('log')).toBe(0);
  });

  it('stops at the refusal: a later `permit` that would fault is never reached', () => {
    const order = (visitor: InstanceId) =>
      reading(YARD, 'order', visitor, { target: { object: BOTH }, tool: { object: TRIP } });
    const faulting = turn(YARD, [HALL]);
    expect(() => runReading(order(faulting.people[0]!), contextOf(faulting))).toThrow(
      IntegerOverflow,
    );

    const one = turn(YARD, [HALL]);
    setOn(one, BOTH, { c: true });
    expect(words(refused(runReading(order(one.people[0]!), contextOf(one))).said)).toBe(
      'Both balks.',
    );
    // Four `permit`s of four steps each (`if`, `self`, `get`, `:p`), and the `refuse`.
    expect(one.budget.spentSteps).toBe(17);
  });

  it('reads only, so it may be asked of committed state alone', () => {
    const one = turn(YARD, [HALL]);
    const [visitor] = one.people;
    const { state } = one.draft.commit();
    const order = reading(YARD, 'order', visitor!, { target: { object: BOTH } });
    expect(
      consentPass(order, {
        state: readerOf(state),
        catalogue: one.catalogue,
        budget: one.budget,
        passes: contextOf(one).passes,
      }),
    ).toBeNull();
  });

  it('reads an optional tool only once `bound` says the command named one', () => {
    const one = turn(YARD, [HALL]);
    const [visitor] = one.people;
    const unlock = (tool?: InstanceId) =>
      runReading(
        reading(YARD, 'unlock', visitor!, {
          target: { object: LOCK },
          ...(tool === undefined ? {} : { tool: { object: tool } }),
        }),
        contextOf(one),
      );
    expect(words(refused(unlock()).said)).toBe('You need something to turn the lock with.');
    const stone = refused(unlock(STONE));
    expect(words(stone.said)).toBe('{tool} is not a key.');
    expect(lines(acted(unlock(KEY)))).toEqual([[LOCK, 'unlocked']]);
  });

  it('faults before either pass where a set role binds more than the host allows one to', () => {
    const budgets = { ...DEFAULT_LIMITS.budgets, setRoleObjects: 1 };
    const one = turn(YARD, [HALL], new Budget(budgets));
    const [visitor] = one.people;
    const order = (weights: InstanceId[]) =>
      runReading(
        reading(YARD, 'order', visitor!, { target: { object: BOTH }, weights: { set: weights } }),
        contextOf(one),
      );
    expect(lines(acted(order([W1])))[0]).toEqual([visitor, 'actor']);
    const log = one.draft.instance(visitor!)!.properties.get('log');
    expect(() => order([W1, W2])).toThrow(
      expect.objectContaining({ name: 'BudgetExhausted', limit: 'setRoleObjects', allowed: 1 }),
    );
    // Not even the actor's own part ran.
    expect(one.draft.instance(visitor!)!.properties.get('log')).toBe(log);
  });
});

describe('a reading of the engine’s `go`', () => {
  const go = (to: InstanceId) => {
    const one = turn(WAYS, [WAYS_YARD]);
    const walker = one.people[0]!;
    const way = { exit: { direction: 'north' as const, label: 'north', to } };
    const outcome = runReading(reading(WAYS, 'go', walker, { way }, 'sprout'), contextOf(one));
    return { one, walker, outcome };
  };

  it('moves its actor through the exit, which no play binds, and then runs the actor’s part', () => {
    const { one, walker, outcome } = go(MOUTH);
    expect(
      participantsOf(
        reading(
          WAYS,
          'go',
          walker,
          { way: { exit: { direction: 'north', label: 'n', to: MOUTH } } },
          'sprout',
        ),
      ),
    ).toEqual([{ id: walker, role: 'actor' }]);
    const done = acted(outcome);
    expect(one.draft.instance(walker)!.container).toBe(MOUTH);
    expect(one.draft.instance(walker)!.properties.get('walked')).toBe(1);
    // Having gone, the actor reads where they are, and is told nothing else.
    expect(done.said).toEqual([]);
    expect(done.notices.at(-1)).toEqual({ notice: 'described', place: MOUTH, audience: [walker] });
  });

  it('says a refusal of the move to its actor, and ends the pass there', () => {
    const one = turn(WAYS, [WAYS_YARD]);
    const walker = one.people[0]!;
    setOn(one, MEADOW, { shut: true });
    const way = { exit: { direction: 'north' as const, label: 'north', to: MEADOW } };
    const done = acted(runReading(reading(WAYS, 'go', walker, { way }, 'sprout'), contextOf(one)));
    expect(done.said.map((line) => [line.effect, line.to, words(line.said)])).toEqual([
      ['refused', [walker], 'The gate is shut.'],
    ]);
    expect(one.draft.instance(walker)!.container).toBe(WAYS_YARD);
    expect(one.draft.instance(walker)!.properties.get('walked')).toBe(0);
  });
});
