import { describe, expect, it } from 'vitest';

import { Budget, BudgetExhausted, type TurnKind } from './budget.js';
import { DEFAULT_LIMITS, limitsFrom } from '../bundle/limits.js';

const budgets = DEFAULT_LIMITS.budgets;

/** A meter with one figure moved, so a suite need not spend fifty thousand steps to prove a point. */
const small = (overrides: Partial<typeof budgets>, kind: TurnKind = 'command') =>
  new Budget(limitsFrom({ budgets: overrides }).budgets, kind);

describe('steps are the budget that matters', () => {
  it('spends one at a time by default', () => {
    const budget = small({ steps: 3 });
    budget.spend();
    budget.spend();
    expect(budget.spentSteps).toBe(2);
  });

  it('faults on the step that goes past the figure, not before it', () => {
    const budget = small({ steps: 3 });
    budget.spend(3);
    expect(budget.spentSteps).toBe(3);
    expect(() => budget.spend()).toThrow(BudgetExhausted);
  });

  it('charges a whole range walk or `each` in one go', () => {
    const budget = small({ steps: 10 });
    expect(() => budget.spend(11)).toThrow(BudgetExhausted);
  });

  it('says which limit ran out and what it was', () => {
    try {
      small({ steps: 2 }).spend(3);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(BudgetExhausted);
      expect((error as BudgetExhausted).limit).toBe('steps');
      expect((error as BudgetExhausted).allowed).toBe(2);
    }
  });
});

describe('a poll is a turn with its own step budget', () => {
  it('takes the poll figure rather than the turn one', () => {
    expect(new Budget(budgets, 'poll').allowedSteps).toBe(budgets.pollSteps);
    expect(new Budget(budgets, 'command').allowedSteps).toBe(budgets.steps);
  });

  it('names pollSteps when a poll runs out, so the fault says what it was', () => {
    const budget = small({ pollSteps: 1 }, 'poll');
    try {
      budget.spend(2);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as BudgetExhausted).limit).toBe('pollSteps');
    }
  });

  it('budgets every other kind of turn as a turn', () => {
    for (const kind of [
      'command',
      'tick',
      'wake',
      'maintenance',
      'arrival',
      'departure',
    ] as const) {
      expect(new Budget(budgets, kind).allowedSteps).toBe(budgets.steps);
    }
  });

  it('is a command turn when nothing says otherwise', () => {
    expect(new Budget(budgets).kind).toBe('command');
  });
});

describe('output is per recipient, so a crowd costs the host and never faults the turn', () => {
  it('counts each recipient apart', () => {
    const budget = small({ output: 10 });
    budget.say('a', 8);
    budget.say('b', 8);
    expect(budget.spentOutput('a')).toBe(8);
    expect(budget.spentOutput('b')).toBe(8);
  });

  it('never faults for a bigger crowd, only for more said to one person', () => {
    const budget = small({ output: 10 });
    for (const who of ['a', 'b', 'c', 'd', 'e', 'f']) budget.say(who, 10);
    expect(() => budget.say('a', 1)).toThrow(BudgetExhausted);
  });

  it('knows nothing was said to someone it has not heard of', () => {
    expect(new Budget(budgets).spentOutput('nobody')).toBe(0);
  });
});

describe('the other budgets a turn spends', () => {
  it('counts events', () => {
    const budget = small({ events: 2 });
    budget.event();
    budget.event();
    expect(budget.spentEvents).toBe(2);
    expect(() => budget.event()).toThrow(BudgetExhausted);
  });

  it('counts spawns in one turn', () => {
    const budget = small({ spawnsPerTurn: 1 });
    budget.spawn();
    expect(budget.spentSpawns).toBe(1);
    expect(() => budget.spawn()).toThrow(BudgetExhausted);
  });

  it('checks a set role against how many objects it bound', () => {
    const budget = small({ setRoleObjects: 2 });
    budget.setRole(2);
    expect(() => budget.setRole(3)).toThrow(BudgetExhausted);
  });

  it('checks cascade depth against the envelope, because the queue drains breadth-first', () => {
    const budget = small({ cascadeDepth: 2 });
    budget.cascadeTo(0);
    budget.cascadeTo(2);
    expect(() => budget.cascadeTo(3)).toThrow(BudgetExhausted);
  });
});

describe('passage depth is a bracket, because a passage invoking a passage is a stack', () => {
  it('goes as deep as the figure and no deeper', () => {
    const budget = small({ passageDepth: 2 });
    const reached = budget.passage(() => budget.passage(() => budget.passageDepth));
    expect(reached).toBe(2);
    expect(() => budget.passage(() => budget.passage(() => budget.passage(() => 0)))).toThrow(
      BudgetExhausted,
    );
  });

  it('comes back down however the passage ends', () => {
    const budget = small({ passageDepth: 4 });
    expect(() =>
      budget.passage(() => {
        throw new Error('the passage itself went wrong');
      }),
    ).toThrow('the passage itself went wrong');
    expect(budget.passageDepth).toBe(0);
  });

  it('gives back what the passage rendered', () => {
    expect(new Budget(budgets).passage(() => 'a line')).toBe('a line');
  });
});

describe('the wall clock is the host’s backstop and never the language’s', () => {
  it('is not checked at all when the host set no figure', () => {
    const budget = new Budget(budgets, 'command', () => {
      throw new Error('the clock was read');
    });
    for (let i = 0; i < 5_000; i++) budget.spend();
    expect(budget.spentSteps).toBe(5_000);
  });

  it('is not checked when the host gave a figure but no clock', () => {
    const budget = small({ wallClockMs: 1 });
    for (let i = 0; i < 5_000; i++) budget.spend();
    expect(budget.spentSteps).toBe(5_000);
  });

  it('fires against the clock the host passed in, not a real one', () => {
    let now = 1_000;
    const budget = new Budget(
      limitsFrom({ budgets: { wallClockMs: 50 } }).budgets,
      'command',
      () => now,
    );
    now = 2_000;
    try {
      for (let i = 0; i < 5_000; i++) budget.spend();
      expect.unreachable('the backstop should have fired');
    } catch (error) {
      expect(error).toBeInstanceOf(BudgetExhausted);
      expect((error as BudgetExhausted).limit).toBe('wallClockMs');
      expect((error as BudgetExhausted).allowed).toBe(50);
      expect((error as BudgetExhausted).message).toContain('step budget did not catch');
    }
  });

  it('is sampled rather than read on every step, and fires within a stride of the deadline', () => {
    let reads = 0;
    let now = 1_000;
    const budget = new Budget(
      limitsFrom({ budgets: { wallClockMs: 50 } }).budgets,
      'command',
      () => {
        reads += 1;
        return now;
      },
    );
    now = 2_000;
    expect(() => {
      for (let i = 0; i < 5_000; i++) budget.spend();
    }).toThrow(BudgetExhausted);
    // One read to set the deadline, one to find it passed — not five thousand.
    expect(reads).toBe(2);
    expect(budget.spentSteps).toBeLessThanOrEqual(1_024);
  });

  it('does not fire while the host’s clock stands still', () => {
    const budget = new Budget(
      limitsFrom({ budgets: { wallClockMs: 50 } }).budgets,
      'command',
      () => 1_000,
    );
    for (let i = 0; i < 5_000; i++) budget.spend();
    expect(budget.spentSteps).toBe(5_000);
  });
});

describe('a meter holds no figure of its own', () => {
  it('reads every one of them off the limits it was given', () => {
    const halved = limitsFrom({
      budgets: {
        steps: 7,
        pollSteps: 5,
        output: 11,
        events: 3,
        cascadeDepth: 2,
        passageDepth: 2,
        setRoleObjects: 2,
        spawnsPerTurn: 2,
      },
    }).budgets;
    const budget = new Budget(halved, 'command');
    expect(budget.allowedSteps).toBe(7);
    expect(() => budget.say('a', 12)).toThrow(BudgetExhausted);
    expect(budget.limits).toBe(halved);
  });

  it('starts every count at nothing', () => {
    const budget = new Budget(budgets);
    expect([
      budget.spentSteps,
      budget.spentEvents,
      budget.spentSpawns,
      budget.passageDepth,
    ]).toEqual([0, 0, 0, 0]);
  });
});

describe('a figure every part of a turn charges stays spent once it runs out', () => {
  const faults = (run: () => unknown) => expect(run).toThrow(BudgetExhausted);

  it('is none before anything runs out', () => {
    expect(new Budget(budgets).exhausted).toBeNull();
  });

  it('names steps, a poll’s steps and events once each is spent', () => {
    const steps = small({ steps: 1 });
    steps.spend();
    expect(steps.exhausted).toBeNull();
    faults(() => steps.spend());
    expect(steps.exhausted).toBe('steps');

    const poll = small({ pollSteps: 1 }, 'poll');
    faults(() => poll.spend(2));
    expect(poll.exhausted).toBe('pollSteps');

    const events = small({ events: 1 });
    events.event();
    faults(() => events.event());
    expect(events.exhausted).toBe('events');
  });

  it('names the wall clock once the backstop fires', () => {
    let now = 0;
    const limits = limitsFrom({ budgets: { wallClockMs: 5 } }).budgets;
    const budget = new Budget(limits, 'command', () => now);
    now = 10;
    faults(() => {
      for (;;) budget.spend();
    });
    expect(budget.exhausted).toBe('wallClockMs');
  });

  it('leaves out a figure that bounds only what charges it', () => {
    const budget = small({
      spawnsPerTurn: 1,
      output: 1,
      passageDepth: 1,
      cascadeDepth: 1,
      setRoleObjects: 1,
    });
    budget.spawn();
    faults(() => budget.spawn());
    faults(() => budget.say('a', 2));
    faults(() => budget.passage(() => budget.passage(() => null)));
    faults(() => budget.cascadeTo(2));
    faults(() => budget.setRole(2));
    expect(budget.exhausted).toBeNull();
  });
});
