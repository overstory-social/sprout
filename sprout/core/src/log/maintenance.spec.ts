import { describe, expect, it } from 'vitest';

import { FAULTED, INPUTS, roundTrip } from '../fixtures/entries.js';
import { MaintenanceEntry, maintenanceOf } from './maintenance.js';

const caughtUp = {
  kind: 'maintenance',
  ...INPUTS,
  delivered: [{ object: 'tally.hall.gauge', serial: 4 }],
  faulted: [{ object: 'tally.hall.counter', serial: 3, fault: FAULTED }],
  abandoned: [{ object: 'tally.hall.counter', serial: 5 }],
  warnings: [],
} as const;

describe('a maintenance turn in the log', () => {
  it('keeps its inputs and each wake it delivered, consumed after a fault or left pending, and says nothing', () => {
    expect(MaintenanceEntry.parse(roundTrip(caughtUp))).toEqual(caughtUp);
    expect(MaintenanceEntry.parse({ ...caughtUp, effects: [] })).not.toHaveProperty('effects');
  });

  it('hands back the inputs catch-up ran with', () => {
    expect(maintenanceOf(MaintenanceEntry.parse(caughtUp))).toEqual({
      seed: 3,
      mayHold: null,
      now: 9,
    });
  });
});
