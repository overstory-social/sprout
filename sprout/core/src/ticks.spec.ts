import { describe, expect, it } from 'vitest';

import { HALL, hallHost, hallWith, MARTA } from './fixtures/hall.js';
import { Ticker } from './ticks.js';

// Rounds of ticks, on a stand-in engine: one tick turn for each occupied
// place, and none queued behind one still waiting. What every engine
// must do of a tick is the engine conformance suite's.

const inputs = () => ({ seed: 1, mayHold: null });

describe('a round of ticks', () => {
  it('ticks each place a visitor stands in, once', async () => {
    const store = await hallWith([MARTA, 'Marta']);
    const rounds = await new Ticker().round(store, 'w', hallHost(), 10, inputs);
    expect(rounds).toMatchObject([{ place: HALL, turn: { committed: true } }]);
  });

  it('ticks nothing where nobody stands', async () => {
    const store = await hallWith();
    expect(await new Ticker().round(store, 'w', hallHost(), 10, inputs)).toEqual([]);
  });

  it('skips a place whose last tick has not yet run, rather than queueing it', async () => {
    const store = await hallWith([MARTA, 'Marta']);
    const host = hallHost();
    const ticker = new Ticker();
    let release!: () => void;
    const held = store.transaction('w', () => new Promise<void>((resolve) => (release = resolve)));
    const first = ticker.round(store, 'w', host, 10, inputs);
    // Let the first round read the places and ask for its tick, which waits on the lock.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = await ticker.round(store, 'w', host, 11, inputs);
    expect(second).toEqual([{ place: HALL, skipped: true }]);
    release();
    await held;
    expect(await first).toMatchObject([{ place: HALL, turn: { committed: true } }]);
  });
});
