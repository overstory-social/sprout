import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '../bundle/limits.js';
import {
  asked,
  BULB,
  CANDLE,
  FUSE,
  garden,
  heldIn,
  HOST,
  LAMP,
  MARTA,
  POD,
  ROSE,
  SEED,
  wakesOf,
} from '../fixtures/wakes.js';
import { Draws } from './draws.js';
import { saveWorld } from './load.js';
import { maintenanceTurn } from './maintenance.js';
import type { TurnHost } from './turn.js';

const at = (now: number) => ({ now, seed: 11, mayHold: null });
const objects = (wakes: readonly { readonly object: string }[]) => wakes.map((w) => w.object);

describe('a maintenance turn', () => {
  it('delivers every due wake, one per object, oldest first, keeping what each did', () => {
    const { state } = garden([
      [ROSE, 0, 7200],
      [CANDLE, 0, 100],
    ]);
    const turn = maintenanceTurn(state, HOST, at(86_400));
    expect(objects(turn.value.delivered)).toEqual([CANDLE, ROSE]);
    expect(turn.value).toMatchObject({ faulted: [], abandoned: [] });
    expect(heldIn(turn.state, CANDLE, 'lit')).toBe(false);
    // The rose is handed the whole absence, not stepped through it.
    expect(heldIn(turn.state, ROSE, 'grown')).toBe(86_400);
    expect(heldIn(turn.state, ROSE, 'stage')).toBe(1);
  });

  it('does not narrate: what a wake tells is dropped, with someone there to hear it', () => {
    const { state } = garden([[CANDLE, 0, 100]], 'bed');
    const turn = maintenanceTurn(state, HOST, at(86_400));
    expect(objects(turn.value.delivered)).toEqual([CANDLE]);
    expect(heldIn(turn.state, CANDLE, 'lit')).toBe(false);
    // The candle told the bed it guttered; what catch-up gives back holds none of it.
    expect(Object.keys(turn.value).sort()).toEqual(['abandoned', 'delivered', 'faulted']);
  });

  it('leaves a wake a delivered one asks for to live time, though it is due already', () => {
    const { state } = garden([[ROSE, 0, 7200]]);
    const turn = maintenanceTurn(state, HOST, at(86_400));
    expect(wakesOf(turn.state, ROSE)).toEqual([
      { serial: turn.state.serial, askedAt: 86_400, dueAt: 86_400 + 7200 },
    ]);
    expect(heldIn(turn.state, ROSE, 'stage')).toBe(1);
  });

  it('delivers only each object’s oldest, the rest waiting for live time', () => {
    const { state } = garden([
      [CANDLE, 0, 100],
      [CANDLE, 0, 200],
    ]);
    const turn = maintenanceTurn(state, HOST, at(1000));
    expect(turn.value.delivered.map((w) => w.dueAt)).toEqual([100]);
    expect(wakesOf(turn.state, CANDLE).map((w) => w.dueAt)).toEqual([200]);
  });

  it('writes everything its parts changed as one change set, against the state it opened on', () => {
    const { state } = garden(
      [
        [ROSE, 0, 7200],
        [CANDLE, 0, 100],
        [POD, 0, 50],
      ],
      'bed',
    );
    const turn = maintenanceTurn(state, HOST, at(86_400));
    expect(turn.changes.serial).toBe(turn.state.serial);
    expect(turn.changes.upsert.map((r) => r.id)).toEqual([CANDLE, ROSE].sort());
    expect(turn.changes.remove).toEqual([POD, SEED].sort());
    expect(turn.changes.tombstones).toEqual([POD, SEED].sort());
    expect(turn.stale).toEqual([MARTA]);
    // Applying the change set to what was stored gives exactly the state it committed.
    const before = saveWorld(state);
    const upserted = new Map(before.instances.map((r) => [r.id, r]));
    for (const id of turn.changes.remove) upserted.delete(id);
    for (const record of turn.changes.upsert) upserted.set(record.id, record);
    expect([...upserted.values()].sort((a, b) => (a.id < b.id ? -1 : 1))).toEqual(
      saveWorld(turn.state).instances,
    );
  });

  it('skips a wake whose object an earlier one took with it', () => {
    const { state } = garden([
      [POD, 0, 50],
      [SEED, 0, 60],
    ]);
    const turn = maintenanceTurn(state, HOST, at(1000));
    expect(objects(turn.value.delivered)).toEqual([POD]);
    expect(turn.value).toMatchObject({ faulted: [], abandoned: [] });
  });

  it('on a fault, consumes the wake that faulted and still delivers the other objects’', () => {
    const { state } = garden([
      [CANDLE, 0, 100],
      [FUSE, 0, 200],
      [ROSE, 0, 300],
    ]);
    const turn = maintenanceTurn(state, HOST, at(1000));
    expect(objects(turn.value.delivered)).toEqual([CANDLE, ROSE]);
    expect(turn.value.faulted.map((f) => f.wake.object)).toEqual([FUSE]);
    expect(turn.value.faulted[0]!.fault).toMatchObject({ name: 'ValueOutOfRange', engine: false });
    expect(turn.value.abandoned).toEqual([]);
    expect(heldIn(turn.state, CANDLE, 'lit')).toBe(false);
    // What the faulted part wrote is abandoned; its wake is gone all the same.
    expect(heldIn(turn.state, FUSE, 'burnt')).toBe(0);
    expect(wakesOf(turn.state, FUSE)).toEqual([]);
    expect(heldIn(turn.state, ROSE, 'stage')).toBe(1);
    expect(heldIn(turn.state, ROSE, 'grown')).toBe(1000);
  });

  it('leaves the faulted object’s own later due wakes pending, and delivers past every fault', () => {
    const { state } = garden([
      [FUSE, 0, 100],
      [FUSE, 0, 150],
      [CANDLE, 0, 200],
      [BULB, 0, 250],
    ]);
    const second = wakesOf(state, FUSE)[1]!;
    const turn = maintenanceTurn(state, HOST, at(1000));
    expect(turn.value.faulted.map((f) => [f.wake.object, f.wake.dueAt])).toEqual([[FUSE, 100]]);
    expect(wakesOf(turn.state, FUSE)).toEqual([second]);
    expect(objects(turn.value.delivered)).toEqual([CANDLE, BULB]);
    expect(turn.value.abandoned).toEqual([]);
  });

  it('carries the one stream on past a faulted part, so a replay draws the same', () => {
    // The fuse faults between the bulb and the lamp; the lamp's draw is the second.
    const { state } = garden([
      [BULB, 0, 100],
      [FUSE, 0, 150],
      [LAMP, 0, 200],
    ]);
    const turn = maintenanceTurn(state, HOST, at(1000));
    expect(objects(turn.value.delivered)).toEqual([BULB, LAMP]);
    const expected = new Draws(11);
    expect([heldIn(turn.state, BULB, 'glow'), heldIn(turn.state, LAMP, 'glow')]).toEqual([
      expected.below(1000),
      expected.below(1000),
    ]);
    expect(maintenanceTurn(state, HOST, at(1000))).toEqual(turn);
  });

  it('charges every part to the one budget the turn has, and abandons the rest once it is spent', () => {
    const { state } = garden([
      [CANDLE, 0, 100],
      [SEED, 0, 200],
      [ROSE, 0, 300],
    ]);
    // The fewest steps one candle's wake needs, which leave none for a second.
    const under = (steps: number): TurnHost => ({
      ...HOST,
      budgets: { ...DEFAULT_LIMITS.budgets, steps },
    });
    const alone = garden([[CANDLE, 0, 100]]).state;
    let steps = 1;
    while (maintenanceTurn(alone, under(steps), at(1000)).value.faulted.length > 0) steps += 1;
    const turn = maintenanceTurn(state, under(steps), at(1000));
    expect(objects(turn.value.delivered)).toEqual([CANDLE]);
    expect(turn.value.faulted).toMatchObject([
      { wake: { object: SEED }, fault: { name: 'BudgetExhausted' } },
    ]);
    expect(wakesOf(turn.state, SEED)).toEqual([]);
    // Nothing more can run under a spent budget, so the rose is not faulted too: it waits.
    expect(objects(turn.value.abandoned)).toEqual([ROSE]);
    expect(wakesOf(turn.state, ROSE).map((w) => w.dueAt)).toEqual([300]);
    expect(heldIn(turn.state, ROSE, 'stage')).toBe(0);
  });

  it('draws every part from the turn’s one seed, each wake on from where the last left off', () => {
    const { state } = garden([
      [BULB, 0, 100],
      [LAMP, 0, 200],
    ]);
    const turn = maintenanceTurn(state, HOST, at(86_400));
    expect(objects(turn.value.delivered)).toEqual([BULB, LAMP]);
    const expected = new Draws(11);
    expect([heldIn(turn.state, BULB, 'glow'), heldIn(turn.state, LAMP, 'glow')]).toEqual([
      expected.below(1000),
      expected.below(1000),
    ]);
    const again = maintenanceTurn(state, HOST, at(86_400));
    expect(heldIn(again.state, LAMP, 'glow')).toBe(heldIn(turn.state, LAMP, 'glow'));
  });

  it('commits nothing but the serial it read when nothing is due, and leaves out what is not in the tree', () => {
    const { state: away, carried } = garden([], 'away');
    const state = asked(away, [
      [carried!, 0, 100],
      [ROSE, 0, 5000],
    ]);
    const turn = maintenanceTurn(state, HOST, at(1000));
    expect(turn.value).toEqual({ delivered: [], faulted: [], abandoned: [] });
    expect(turn.changes).toEqual({
      serial: state.serial,
      upsert: [],
      remove: [],
      tombstones: [],
      visitors: [],
    });
    expect(turn.stale).toEqual([]);
  });

  it('is the host’s defect at an instant that is not whole seconds', () => {
    const { state } = garden([]);
    expect(() => maintenanceTurn(state, HOST, at(-1))).toThrow('whole seconds');
  });
});
