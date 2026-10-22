import { describe, expect, it } from 'vitest';

import { FAULTED, INPUTS, roundTrip, SAID } from '../fixtures/entries.js';
import { DepartureEntry, departureOf } from './departure.js';

const departed = {
  kind: 'departure',
  ...INPUTS,
  visit: 'v-marta',
  fault: null,
  effects: [SAID],
  cutShort: [],
  warnings: [],
} as const;

describe('a visitor’s exit in the log', () => {
  it('keeps the visit, its inputs and what it said, and a fault where it had one', () => {
    expect(DepartureEntry.parse(roundTrip(departed))).toEqual(departed);
    const faulted = { ...departed, fault: FAULTED };
    expect(DepartureEntry.parse(roundTrip(faulted))).toEqual(faulted);
  });

  it('hands back the departure as the host handed it over', () => {
    expect(departureOf(DepartureEntry.parse(departed))).toEqual({
      visit: 'v-marta',
      seed: 3,
      mayHold: null,
      now: 9,
    });
  });
});
