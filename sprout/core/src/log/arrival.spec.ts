import { describe, expect, it } from 'vitest';

import { FAULTED, INPUTS, roundTrip, SAID } from '../fixtures/entries.js';
import { ArrivalEntry, arrivalOf } from './arrival.js';

const admitted = {
  kind: 'arrival',
  ...INPUTS,
  visit: 'v-ines',
  nickname: 'Ines',
  outcome: 'admitted',
  fault: null,
  effects: [SAID],
  cutShort: [],
  warnings: [],
} as const;

describe('a visitor’s entry in the log', () => {
  it('keeps the visit, the nickname they came with, its inputs and what it said', () => {
    expect(ArrivalEntry.parse(roundTrip(admitted))).toEqual(admitted);
  });

  it('keeps a refusal, or a fault, by its outcome', () => {
    for (const outcome of ['refused', 'faulted'] as const) {
      const entry = { ...admitted, outcome, fault: outcome === 'faulted' ? FAULTED : null };
      expect(ArrivalEntry.parse(roundTrip(entry))).toEqual(entry);
    }
    expect(ArrivalEntry.safeParse({ ...admitted, outcome: 'closed' }).success).toBe(false);
  });

  it('hands back the arrival as the host handed it over', () => {
    expect(arrivalOf(ArrivalEntry.parse(admitted))).toEqual({
      visit: 'v-ines',
      nickname: 'Ines',
      seed: 3,
      mayHold: null,
      now: 9,
    });
  });
});
