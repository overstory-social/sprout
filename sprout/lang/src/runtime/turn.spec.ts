import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '../bundle/limits.js';
import {
  actorOf,
  belfry,
  belfryHost,
  BELL,
  heldIn,
  INES,
  MARTA,
  STONE,
} from '../fixtures/turns.js';
import { words } from '../fixtures/reading.js';
import { Draft } from './draft.js';
import { saveWorld } from './load.js';
import type { WorldState } from './state.js';
import { Budget } from './budget.js';
import { Draws } from './draws.js';
import {
  committedOver,
  pollTurn,
  writeTurn,
  writeUnder,
  type TurnShared,
  type WriteTurn,
  type WriteTurnKind,
} from './turn.js';

const inputs = { seed: 41, mayHold: 12, now: 500 };

/** A body that writes a property, as a do's `set` would. */
function strike(turn: WriteTurn): void {
  const bell = turn.draft.instance(BELL)!;
  turn.draft.write({ ...bell, properties: new Map([...bell.properties, ['struck', true]]) });
}

describe('a write turn', () => {
  it('commits what its body wrote, in the stored form, and marks everyone present stale', () => {
    const state = belfry([MARTA], true);
    const written = writeTurn(state, 'tick', belfryHost(), inputs, (turn) => {
      strike(turn);
      return 'rung';
    });
    if (!written.committed) throw new Error(written.fault.detail);
    expect(written.value).toBe('rung');
    expect(heldIn(written.state, BELL, 'struck')).toBe(true);
    expect(written.changes.upsert.map((record) => record.id)).toEqual([BELL]);
    expect(written.changes.serial).toBe(state.serial);
    // Ines is away, so nobody holds a view of hers.
    expect(written.stale).toEqual([MARTA]);
    expect(state.visitors.has(INES)).toBe(true);
  });

  it('abandons everything its body wrote when it throws, and says what was broken', () => {
    const state = belfry();
    const before = saveWorld(state);
    const written = writeTurn(state, 'wake', belfryHost(), inputs, (turn) => {
      strike(turn);
      turn.draft.mint();
      turn.budget.spend(DEFAULT_LIMITS.budgets.steps + 1);
    });
    expect(written).toEqual({
      committed: false,
      fault: {
        name: 'BudgetExhausted',
        detail: expect.stringContaining('50000 steps'),
        object: null,
        engine: false,
      },
    });
    expect(saveWorld(state)).toEqual(before);
    expect(heldIn(state, BELL, 'struck')).toBe(false);
  });

  it('runs each kind under a budget of its own kind, with the seed and bound the host gave', () => {
    const kinds: WriteTurnKind[] = [
      'command',
      'tick',
      'wake',
      'maintenance',
      'arrival',
      'departure',
    ];
    for (const kind of kinds) {
      const written = writeTurn(belfry(), kind, belfryHost(), inputs, (turn) => {
        turn.budget.spend(10);
        return {
          kind: turn.kind,
          meter: turn.budget.kind,
          allowed: turn.budget.allowedSteps,
          spent: turn.budget.spentSteps,
          seed: turn.seed,
          mayHold: turn.mayHold,
          now: turn.now,
        };
      });
      if (!written.committed) throw new Error(written.fault.detail);
      expect(written.value).toEqual({
        kind,
        meter: kind,
        allowed: DEFAULT_LIMITS.budgets.steps,
        spent: 10,
        seed: 41,
        mayHold: 12,
        now: 500,
      });
    }
  });

  it('is the host’s defect, thrown before it opens, at an instant that is not whole seconds from 0', () => {
    for (const now of [-1, 0.5, Number.NaN]) {
      expect(() =>
        writeTurn(belfry(), 'command', belfryHost(), { ...inputs, now }, strike),
      ).toThrow('whole seconds');
    }
  });

  it('draws from a stream its seed begins, fresh for each turn, and refuses a seed that is not one', () => {
    const drawn = (seed: number) => {
      const written = writeTurn(belfry(), 'command', belfryHost(), { ...inputs, seed }, (turn) =>
        [6, 6, 100].map((n) => turn.draws.below(n)),
      );
      if (!written.committed) throw new Error(written.fault.detail);
      return written.value;
    };
    const expected = new Draws(41);
    expect(drawn(41)).toEqual([6, 6, 100].map((n) => expected.below(n)));
    expect(drawn(41)).toEqual(drawn(41));
    expect(() => drawn(2 ** 32)).toThrow(/is not a seed/);
  });

  it('reads through the containers’ own pass rules, and a draft over the state it was given', () => {
    const state = belfry();
    const written = writeTurn(state, 'command', belfryHost(), inputs, (turn) => ({
      draft: turn.draft instanceof Draft,
      marta: turn.draft.instance(actorOf(state, MARTA))?.container,
      worldPasses: turn.passes(state.world, 'any'),
    }));
    if (!written.committed) throw new Error(written.fault.detail);
    expect(written.value).toEqual({
      draft: true,
      marta: state.instances.get(actorOf(state, MARTA))!.container,
      worldPasses: false,
    });
  });
});

describe('a write turn in parts', () => {
  it('charges every part run under one budget to it, so a later part has what the earlier left', () => {
    const budget = new Budget({ ...DEFAULT_LIMITS.budgets, steps: 15 }, 'maintenance');
    const shared = { budget, draws: new Draws(inputs.seed) };
    const host = belfryHost();
    const first = writeUnder(shared, belfry(), 'maintenance', host, inputs, (turn) => {
      turn.budget.spend(10);
      return turn.budget === budget;
    });
    if (!first.committed) throw new Error(first.fault.detail);
    expect(first.value).toBe(true);
    const second = writeUnder(shared, first.state, 'maintenance', host, inputs, (turn) => {
      turn.budget.spend(10);
    });
    expect(second).toMatchObject({ committed: false, fault: { name: 'BudgetExhausted' } });
  });

  it('draws every part from the one stream its seed begins, so no part repeats another’s draws', () => {
    const host = belfryHost();
    const drawnIn = (shared: TurnShared, state: WorldState) =>
      writeUnder(shared, state, 'maintenance', host, inputs, (turn) =>
        Array.from({ length: 8 }, () => turn.draws.below(1000)),
      );
    const shared = {
      budget: new Budget(DEFAULT_LIMITS.budgets, 'maintenance'),
      draws: new Draws(inputs.seed),
    };
    const first = drawnIn(shared, belfry());
    if (!first.committed) throw new Error(first.fault.detail);
    const second = drawnIn(shared, first.state);
    if (!second.committed) throw new Error(second.fault.detail);
    const whole = new Draws(inputs.seed);
    const one = Array.from({ length: 16 }, () => whole.below(1000));
    expect([...first.value, ...second.value]).toEqual(one);
    expect(second.value).not.toEqual(first.value);
  });

  it('commits as one turn what its parts did, against the state the first opened on', () => {
    const state = belfry([MARTA], true);
    const host = belfryHost();
    const struck = writeTurn(state, 'maintenance', host, inputs, strike);
    if (!struck.committed) throw new Error(struck.fault.detail);
    const minted = writeTurn(struck.state, 'maintenance', host, inputs, (turn) => {
      turn.draft.mint();
    });
    if (!minted.committed) throw new Error(minted.fault.detail);
    const whole = committedOver(state, minted.state, 'both');
    expect(whole.value).toBe('both');
    expect(whole.state).toBe(minted.state);
    expect(whole.changes.upsert.map((record) => record.id)).toEqual([BELL]);
    expect(whole.changes.serial).toBe(state.serial + 1);
    expect(whole.stale).toEqual([MARTA]);
  });
});

describe('a poll', () => {
  it('reads the committed state, under the poll’s own step budget', () => {
    const state = belfry();
    const polled = pollTurn(state, belfryHost(), (turn) => ({
      meter: turn.budget.kind,
      allowed: turn.budget.allowedSteps,
      taps: turn.state.instance(STONE)?.properties.get('taps'),
    }));
    expect(polled).toEqual({
      faulted: false,
      view: { meter: 'poll', allowed: DEFAULT_LIMITS.budgets.pollSteps, taps: 0 },
    });
  });

  it('sees the state before a write turn that has not committed, whatever that turn does', () => {
    const state: WorldState = belfry();
    let seen: unknown;
    writeTurn(state, 'command', belfryHost(), inputs, (turn) => {
      strike(turn);
      seen = pollTurn(state, belfryHost(), (poll) =>
        poll.state.instance(BELL)?.properties.get('struck'),
      );
    });
    expect(seen).toEqual({ faulted: false, view: false });
  });

  it('has nothing to write with, and nothing to draw from', () => {
    const polled = pollTurn(belfry(), belfryHost(), (turn) => ({
      draft: turn.state instanceof Draft,
      writes: 'write' in turn.state || 'place' in turn.state,
      draws: 'draws' in turn,
    }));
    expect(polled).toEqual({ faulted: false, view: { draft: false, writes: false, draws: false } });
  });

  it('yields the world’s `unseen` when its look faults', () => {
    const polled = pollTurn(belfry(), belfryHost(), (turn) =>
      turn.budget.spend(DEFAULT_LIMITS.budgets.pollSteps + 1),
    );
    if (!polled.faulted) throw new Error('the poll did not fault');
    expect(polled.fault).toMatchObject({ name: 'BudgetExhausted', engine: false });
    expect(polled.fault.detail).toContain('poll');
    expect(words(polled.unseen)).toBe(
      'sprout.World unseen: Something here is too much to take in.',
    );
  });
});
