import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS, type RuntimeBudgets } from '../bundle/limits.js';
import { readStatement } from '../fixtures/parse.js';
import { CANDLE, CATALOGUE, FUSE, garden, POD, ROSE, SEED, wakesOf } from '../fixtures/wakes.js';
import type { WakeStatement } from '../syntax/ast.js';
import { Budget } from './budget.js';
import { Draft } from './draft.js';
import type { InstanceId } from './ids.js';
import type { LifecycleContext } from './lifecycle.js';
import type { WorldState } from './state.js';
import { askToWake, dueWakes, oldestFirst, onePerObject, WakeFault, withoutWake } from './wakes.js';

/** `text`, read as a `wake`. */
function wake(text: string): WakeStatement {
  const { statement } = readStatement(text);
  if (statement?.kind !== 'wake') throw new Error(`${text} is not a wake`);
  return statement;
}

/** What a body running a `wake` reaches, over `state`, at `now`. */
function context(state: WorldState, now: number, budgets: RuntimeBudgets = DEFAULT_LIMITS.budgets) {
  const draft = new Draft(state);
  const lifecycle: LifecycleContext = {
    draft,
    catalogue: CATALOGUE,
    passes: () => true,
    budget: new Budget(budgets),
    mayHold: null,
    now,
  };
  return { draft, lifecycle };
}

const ask = (
  state: WorldState,
  id: InstanceId,
  text: string,
  now: number,
  budgets?: RuntimeBudgets,
) => {
  const { draft, lifecycle } = context(state, now, budgets);
  const asked = askToWake(lifecycle, id, wake(text));
  return { asked, state: draft.commit().state };
};

describe('asking to be woken', () => {
  it('asks at the turn’s instant, under the world’s next serial, due after the wait asked for', () => {
    const { state } = garden([]);
    const { asked, state: after } = ask(state, ROSE, 'wake in 2 hours', 1000);
    expect(asked).toEqual({ serial: state.serial + 1, askedAt: 1000, dueAt: 1000 + 7200 });
    expect(wakesOf(after, ROSE)).toEqual([asked]);
    expect(after.serial).toBe(state.serial + 1);
  });

  it('waits no less than the host’s floor, whatever was asked', () => {
    const { state } = garden([]);
    expect(ask(state, ROSE, 'wake in 5 seconds', 100).asked.dueAt).toBe(160);
    expect(ask(state, ROSE, 'wake in 0 seconds', 100).asked.dueAt).toBe(160);
    const raised = { ...DEFAULT_LIMITS.budgets, shortestWakeSeconds: 600 };
    expect(ask(state, ROSE, 'wake in 2 minutes', 100, raised).asked.dueAt).toBe(700);
    expect(ask(state, ROSE, 'wake in 20 minutes', 100, raised).asked.dueAt).toBe(1300);
  });

  it('faults past the host’s cap on pending wakes, as the world’s fault about the object, writing nothing', () => {
    const { state } = garden([[ROSE, 0, 100]]);
    const { draft, lifecycle } = context(state, 50);
    let thrown: unknown;
    try {
      askToWake(lifecycle, ROSE, wake('wake in 1 hours'));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(WakeFault);
    expect(thrown).toMatchObject({
      object: ROSE,
      message: `\`${ROSE}\` asked for a wake with 1 pending, and this host allows 1.`,
    });
    expect(draft.commit().changes.written).toEqual([]);
  });

  it('holds as many as a host that raises the cap allows, kept oldest first', () => {
    const { state } = garden([[ROSE, 0, 10_000]]);
    const two = { ...DEFAULT_LIMITS.budgets, pendingWakesPerObject: 2 };
    const { asked, state: after } = ask(state, ROSE, 'wake in 1 minutes', 100, two);
    expect(wakesOf(after, ROSE).map((w) => w.dueAt)).toEqual([asked.dueAt, 10_000]);
    expect(() => ask(after, ROSE, 'wake in 1 minutes', 100, two)).toThrow(WakeFault);
  });
});

describe('what is due', () => {
  it('is every wake whose instant has come, oldest first, by when it fell due and then its serial', () => {
    const { state } = garden([
      [ROSE, 0, 300],
      [CANDLE, 0, 100],
      [FUSE, 50, 300],
      [SEED, 0, 900],
    ]);
    expect(dueWakes(state, 299).map((w) => w.object)).toEqual([CANDLE]);
    const due = dueWakes(state, 300);
    expect(due.map((w) => [w.object, w.dueAt])).toEqual([
      [CANDLE, 100],
      [ROSE, 300],
      [FUSE, 300],
    ]);
    expect(due[1]!.serial).toBeLessThan(due[2]!.serial);
    expect(dueWakes(state, 900).map((w) => w.object)).toContain(SEED);
  });

  it('leaves out what is not in the tree: what an away visitor carries waits until they are back', () => {
    const { state: away, carried } = garden([], 'away');
    const { state: here, carried: held } = garden([], 'bed');
    const draftAway = new Draft(away);
    const one = draftAway.instance(carried!)!;
    draftAway.write({ ...one, wakes: [{ serial: 99, askedAt: 0, dueAt: 60 }] });
    expect(dueWakes(draftAway.commit().state, 1000)).toEqual([]);
    const draftHere = new Draft(here);
    const two = draftHere.instance(held!)!;
    draftHere.write({ ...two, wakes: [{ serial: 99, askedAt: 0, dueAt: 60 }] });
    expect(dueWakes(draftHere.commit().state, 1000).map((w) => w.object)).toEqual([held]);
  });

  it('is, for catch-up, each object’s oldest alone, in the order they fell due', () => {
    const { state } = garden([
      [ROSE, 0, 200],
      [CANDLE, 0, 100],
    ]);
    const draft = new Draft(state);
    const rose = draft.instance(ROSE)!;
    draft.write({ ...rose, wakes: [...rose.wakes, { serial: 90, askedAt: 0, dueAt: 50 }] });
    const due = dueWakes(draft.commit().state, 1000);
    expect(due.map((w) => [w.object, w.dueAt])).toEqual([
      [ROSE, 50],
      [CANDLE, 100],
      [ROSE, 200],
    ]);
    expect(onePerObject(due).map((w) => [w.object, w.dueAt])).toEqual([
      [ROSE, 50],
      [CANDLE, 100],
    ]);
  });
});

describe('an object’s list', () => {
  it('is ordered by when each fell due, then by serial', () => {
    const wakes = [
      { serial: 9, askedAt: 0, dueAt: 50 },
      { serial: 3, askedAt: 0, dueAt: 90 },
      { serial: 4, askedAt: 0, dueAt: 50 },
    ];
    expect([...wakes].sort(oldestFirst).map((w) => w.serial)).toEqual([4, 9, 3]);
  });

  it('loses exactly the wake taken off it', () => {
    const { state } = garden([[POD, 0, 100]]);
    const pod = state.instances.get(POD)!;
    const serial = pod.wakes[0]!.serial;
    expect(withoutWake(pod, serial).wakes).toEqual([]);
    expect(withoutWake(pod, serial + 1).wakes).toEqual(pod.wakes);
  });
});
