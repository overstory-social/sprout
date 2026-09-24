import { describe, expect, it } from 'vitest';

import { tickTurn, type Faulted } from '@overstory/sprout/lang';

import { HALL, seeded, tally } from '../fixtures/tally.js';
import { committedState } from '../turns.js';
import { TickEntry, tickEntry, tickOf } from './tick.js';

const { host } = tally();
const tick = { place: HALL, now: 50, seed: 2, mayHold: null };

describe('a tick in the log', () => {
  it('keeps the place, its inputs and what it said', async () => {
    const state = await committedState(await seeded(host), 'w', host);
    const turn = tickTurn(state, host, tick);
    if (!turn.committed) throw new Error('the tick did not commit');
    const entry = tickEntry(tick, host, turn);
    expect(entry).toMatchObject({ kind: 'tick', place: HALL, now: 50, seed: 2, fault: null });
    expect(entry.effects).toEqual([]);
    expect(TickEntry.parse(JSON.parse(JSON.stringify(entry)))).toEqual(entry);
  });

  it('keeps a dropped tick’s fault, and nothing it said', () => {
    const dropped: Faulted = {
      committed: false,
      fault: {
        name: 'BudgetExhausted',
        detail: 'steps',
        object: HALL,
        engine: false,
        extension: null,
      },
    };
    expect(tickEntry(tick, host, dropped)).toMatchObject({
      fault: { name: 'BudgetExhausted', object: HALL },
      effects: [],
    });
  });

  it('hands back the tick, its place an id of the world, and refuses one of another', () => {
    const entry = tickEntry(tick, host, {
      committed: false,
      fault: { name: 'X', detail: '', object: null, engine: true, extension: null },
    });
    expect(tickOf('tally', entry)).toEqual(tick);
    expect(() => tickOf('tally', { ...entry, place: 'bakery.oven' })).toThrow(
      /not an id in `tally`/,
    );
  });
});
