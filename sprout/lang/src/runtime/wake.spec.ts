import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '../bundle/limits.js';
import {
  asked,
  CANDLE,
  FUSE,
  garden,
  heldIn,
  HOST,
  MARTA,
  POD,
  ROSE,
  SEED,
  wakesOf,
} from '../fixtures/wakes.js';
import type { InstanceId } from './ids.js';
import { saveWorld } from './load.js';
import type { WorldState } from './state.js';
import type { TurnHost } from './turn.js';
import { pendingWake, wakeTurn, type Wake, type WakeTurn } from './wake.js';

/** The wake `object` holds first, handed over as at `now`. */
function wakeOf(state: WorldState, object: InstanceId, now: number): Wake {
  return { object, serial: wakesOf(state, object)[0]!.serial, now, seed: 3, mayHold: null };
}

function committed(turn: WakeTurn) {
  if (!turn.committed) throw new Error(`not committed: ${JSON.stringify(turn)}`);
  return turn;
}

describe('a wake turn', () => {
  it('takes the wake off the list and sends `:woke`, handing it the seconds since it was asked', () => {
    const { state } = garden([[CANDLE, 100, 400]], 'bed');
    const turn = committed(wakeTurn(state, HOST, wakeOf(state, CANDLE, 1000)));
    expect(turn.value.elapsed).toBe(900);
    expect(heldIn(turn.state, CANDLE, 'lit')).toBe(false);
    expect(wakesOf(turn.state, CANDLE)).toEqual([]);
    expect(turn.changes.upsert.find((r) => r.id === CANDLE)?.wakes).toEqual([]);
    expect(turn.value.drained.events).toBe(1);
    // Told live, to whoever stands in the candle's place.
    const marta = [...state.visitors.values()][0]!.instance;
    expect(turn.value.drained.said.map((said) => [said.effect, said.by, said.to])).toEqual([
      ['told', CANDLE, [marta]],
    ]);
    expect(turn.stale).toEqual([MARTA]);
  });

  it('hands the true interval, longer than was asked, so a missed wake is recovered from `elapsed`', () => {
    const { state } = garden([[ROSE, 0, 7200]]);
    const turn = committed(wakeTurn(state, HOST, wakeOf(state, ROSE, 90_000)));
    expect(heldIn(turn.state, ROSE, 'grown')).toBe(90_000);
    expect(heldIn(turn.state, ROSE, 'stage')).toBe(1);
  });

  it('lets the woken object ask again, from the wake’s own instant, under a new serial', () => {
    const { state } = garden([[ROSE, 0, 7200]]);
    const before = wakesOf(state, ROSE)[0]!;
    const turn = committed(wakeTurn(state, HOST, wakeOf(state, ROSE, 8000)));
    const again = wakesOf(turn.state, ROSE);
    expect(again).toEqual([{ serial: turn.state.serial, askedAt: 8000, dueAt: 8000 + 7200 }]);
    expect(again[0]!.serial).toBeGreaterThan(before.serial);
    const third = committed(wakeTurn(turn.state, HOST, wakeOf(turn.state, ROSE, 15_200)));
    expect(heldIn(third.state, ROSE, 'stage')).toBe(2);
    expect(third.value.elapsed).toBe(7200);
  });

  it('commits a wake on something with no `:woke` handler, which only consumes it', () => {
    // The world is made of the library's `sprout.World`, which answers no `:woke`.
    const { state: bare } = garden([]);
    const state = asked(bare, [[bare.world, 0, 60]]);
    const turn = committed(wakeTurn(state, HOST, wakeOf(state, state.world, 60)));
    expect(turn.value.drained.events).toBe(0);
    expect(wakesOf(turn.state, state.world)).toEqual([]);
  });

  it('keeps a list longer than a lowered cap, and faults a `wake` asked while it is still at the cap', () => {
    const { state } = garden([
      [ROSE, 0, 7200],
      [ROSE, 0, 9000],
    ]);
    const first = wakeTurn(state, HOST, wakeOf(state, ROSE, 7200));
    expect(first).toMatchObject({
      committed: false,
      fault: { name: 'WakeFault', object: ROSE, engine: false },
    });
    if (first.committed || !('consumed' in first)) return expect.unreachable('faulted');
    const left = first.consumed.state;
    expect(wakesOf(left, ROSE).map((w) => w.dueAt)).toEqual([9000]);
    // Under the cap once the first is consumed, the second may ask again.
    const second = committed(wakeTurn(left, HOST, wakeOf(left, ROSE, 9000)));
    expect(wakesOf(second.state, ROSE)).toEqual([
      { serial: second.state.serial, askedAt: 9000, dueAt: 16_200 },
    ]);
  });

  it('is consumed and not retried when it faults: the turn is abandoned, and then the wake alone is taken off', () => {
    const { state } = garden([[FUSE, 0, 60]], 'bed');
    const before = saveWorld(state);
    const turn = wakeTurn(state, HOST, wakeOf(state, FUSE, 60));
    if (turn.committed || !('consumed' in turn)) return expect.unreachable('the fuse faults');
    expect(turn.fault).toMatchObject({ name: 'ValueOutOfRange', engine: false });
    expect(saveWorld(state)).toEqual(before);
    expect(heldIn(turn.consumed.state, FUSE, 'burnt')).toBe(0);
    expect(wakesOf(turn.consumed.state, FUSE)).toEqual([]);
    expect(turn.consumed.changes.upsert.map((r) => r.id)).toEqual([FUSE]);
    expect(turn.consumed.changes.serial).toBe(state.serial);
    expect(turn.consumed.stale).toEqual([MARTA]);
  });

  it('runs under the wake’s own budget, and a wake that spends it is consumed', () => {
    const { state } = garden([[CANDLE, 0, 60]]);
    const starved: TurnHost = { ...HOST, budgets: { ...DEFAULT_LIMITS.budgets, steps: 1 } };
    const turn = wakeTurn(state, starved, wakeOf(state, CANDLE, 60));
    expect(turn).toMatchObject({ committed: false, fault: { name: 'BudgetExhausted' } });
    if (turn.committed || !('consumed' in turn)) return expect.unreachable('faulted');
    expect(heldIn(turn.consumed.state, CANDLE, 'lit')).toBe(true);
    expect(wakesOf(turn.consumed.state, CANDLE)).toEqual([]);
  });

  it('drops the wakes of what a woken object takes with it when it is destroyed', () => {
    const { state } = garden([
      [POD, 0, 60],
      [SEED, 0, 90],
    ]);
    const turn = committed(wakeTurn(state, HOST, wakeOf(state, POD, 60)));
    expect(turn.state.instances.has(POD)).toBe(false);
    expect(turn.state.instances.has(SEED)).toBe(false);
    expect(pendingWake(turn.state, SEED, wakesOf(state, SEED)[0]!.serial)).toBeNull();
  });

  it('does not run for a wake no longer pending, or on something no longer in the tree', () => {
    const { state } = garden([[CANDLE, 0, 60]]);
    const wake = wakeOf(state, CANDLE, 60);
    const done = committed(wakeTurn(state, HOST, wake)).state;
    expect(wakeTurn(done, HOST, wake)).toEqual({ committed: false, unwoken: true });
    expect(wakeTurn(state, HOST, { ...wake, object: POD })).toEqual({
      committed: false,
      unwoken: true,
    });
    const { state: away, carried } = garden([], 'away');
    const held = asked(away, [[carried!, 0, 60]]);
    expect(wakeTurn(held, HOST, wakeOf(held, carried!, 60))).toEqual({
      committed: false,
      unwoken: true,
    });
  });

  it('is the host’s defect before the wake is due, or at an instant that is not whole seconds', () => {
    const { state } = garden([[CANDLE, 0, 60]]);
    expect(() => wakeTurn(state, HOST, wakeOf(state, CANDLE, 59))).toThrow(
      `\`${CANDLE}\`'s wake is due at 60, and it is only 59.`,
    );
    expect(() => wakeTurn(state, HOST, wakeOf(state, CANDLE, 60.5))).toThrow('whole seconds');
  });
});
