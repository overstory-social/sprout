import { describe, expect, it } from 'vitest';

import { FAULTED, INPUTS, roundTrip, SAID } from '../fixtures/entries.js';
import { TickEntry, tickOf } from './tick.js';

const ticked = {
  kind: 'tick',
  ...INPUTS,
  place: 'tally.hall',
  fault: null,
  effects: [SAID],
  cutShort: [],
  warnings: [],
} as const;

describe('a tick in the log', () => {
  it('keeps the place, its inputs and what it said, and a dropped tick’s fault', () => {
    expect(TickEntry.parse(roundTrip(ticked))).toEqual(ticked);
    const dropped = { ...ticked, fault: FAULTED, effects: [] };
    expect(TickEntry.parse(roundTrip(dropped))).toEqual(dropped);
  });

  it('hands back the tick, its place an id of the world, and refuses one of another', () => {
    expect(tickOf('tally', TickEntry.parse(ticked))).toEqual({
      place: 'tally.hall',
      seed: 3,
      mayHold: null,
      now: 9,
    });
    expect(() => tickOf('shop', TickEntry.parse(ticked))).toThrow();
  });
});
