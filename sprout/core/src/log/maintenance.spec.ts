import { describe, expect, it } from 'vitest';

import { maintenanceTurn } from '@overstory/sprout/lang';

import { command, COUNTER, GAUGE, seeded, tally } from '../fixtures/tally.js';
import { committedState, runCommand } from '../turns.js';
import { MaintenanceEntry, maintenanceEntry, maintenanceOf } from './maintenance.js';

const { host } = tally();

describe('a maintenance turn in the log', () => {
  it('keeps its inputs and each wake it delivered or consumed after a fault, by object and serial, and says nothing', async () => {
    const store = await seeded(host);
    await runCommand(store, 'w', host, command('rest counter', 0));
    await runCommand(store, 'w', host, command('rest gauge', 50));
    const state = await committedState(store, 'w', host);
    // The counter has waited 120 seconds, past what it holds; the gauge 70.
    const inputs = { now: 120, seed: 8, mayHold: null };
    const turn = maintenanceTurn(state, host, inputs);
    const entry = maintenanceEntry(inputs, host, turn);
    expect(entry).toMatchObject({ kind: 'maintenance', now: 120, seed: 8, abandoned: [] });
    expect(entry.delivered).toEqual([{ object: GAUGE, serial: turn.value.delivered[0]!.serial }]);
    expect(entry.faulted).toEqual([
      {
        object: COUNTER,
        serial: turn.value.faulted[0]!.wake.serial,
        fault: expect.objectContaining({ name: 'ValueOutOfRange', engine: false }),
      },
    ]);
    expect('effects' in entry).toBe(false);
    expect(MaintenanceEntry.parse(JSON.parse(JSON.stringify(entry)))).toEqual(entry);
    expect(maintenanceOf(entry)).toEqual(inputs);
  });

  it('keeps what was left pending once the budget was spent', async () => {
    const store = await seeded(host);
    await runCommand(store, 'w', host, command('rest counter', 0));
    const state = await committedState(store, 'w', host);
    const spent = { ...host, budgets: { ...host.budgets, steps: 0 } };
    const inputs = { now: 60, seed: 1, mayHold: null };
    const entry = maintenanceEntry(inputs, spent, maintenanceTurn(state, spent, inputs));
    expect(entry.delivered).toEqual([]);
    expect(entry.faulted.length + entry.abandoned.length).toBe(1);
    expect(entry.budgets.steps).toBe(0);
  });
});
