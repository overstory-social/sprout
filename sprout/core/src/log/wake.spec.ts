import { describe, expect, it } from 'vitest';

import { FAULTED, INPUTS, roundTrip, SAID } from '../fixtures/entries.js';
import { WakeEntry, wakeOf } from './wake.js';

const woke = {
  kind: 'wake',
  ...INPUTS,
  object: 'tally.hall.counter',
  serial: 4,
  fault: null,
  effects: [SAID],
  cutShort: [],
  warnings: [],
} as const;

describe('a wake in the log', () => {
  it('keeps the object, the serial it asked under, its inputs and what it said, and a consumed wake’s fault', () => {
    expect(WakeEntry.parse(roundTrip(woke))).toEqual(woke);
    const consumed = { ...woke, fault: FAULTED, effects: [] };
    expect(WakeEntry.parse(roundTrip(consumed))).toEqual(consumed);
    expect(WakeEntry.safeParse({ ...woke, serial: 0 }).success).toBe(false);
  });

  it('hands back the wake as the host handed it over', () => {
    expect(wakeOf('tally', WakeEntry.parse(woke))).toEqual({
      object: 'tally.hall.counter',
      serial: 4,
      seed: 3,
      mayHold: null,
      now: 9,
    });
  });
});
