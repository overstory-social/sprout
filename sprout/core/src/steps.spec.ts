import { describe, expect, it } from 'vitest';

import { dueWakes, visitKey } from '@overstory/sprout/lang';

import { command, COUNTER, HALL, MARTA, seeded, tally } from './fixtures/tally.js';
import { emptyState } from './records.js';
import {
  arrivalStep,
  commandStep,
  departureStep,
  loaded,
  maintenanceStep,
  tickStep,
  wakeStep,
} from './steps.js';
import { committedState, runCommand } from './turns.js';

const { host } = tally();
const at = (now: number) => ({ now, seed: 4, mayHold: null });
const state = async () => committedState(await seeded(host), 'w', host);

describe('one write turn as a step', () => {
  it('reads a stored state against the bundle the host runs, the declared tree where nothing is stored', () => {
    const fresh = loaded(emptyState(), host);
    expect(fresh.instances.has(COUNTER)).toBe(true);
    expect(fresh.visitors.size).toBe(0);
  });

  it('gives a committed command’s changes and its entry, and a faulted one’s entry alone', async () => {
    const bumped = commandStep(await state(), host, command('bump counter'));
    expect(bumped.changes).not.toBeNull();
    expect(bumped.entry).toMatchObject({ kind: 'command', fault: null });
    const smashed = commandStep(await state(), host, command('smash counter'));
    expect(smashed.changes).toBeNull();
    expect(smashed.entry).toMatchObject({ kind: 'command', fault: { name: 'IntegerOverflow' } });
  });

  it('gives nothing to write or log for a tick whose place is empty, or a wake no longer pending', async () => {
    const away = departureStep(await state(), host, { visit: MARTA, ...at(0) });
    expect(away.entry).toMatchObject({ kind: 'departure' });
    const store = await seeded(host);
    await store.transaction('w', (tx) => tx.putState(away.changes!));
    const left = await committedState(store, 'w', host);
    expect(tickStep(left, host, { place: HALL, ...at(5) })).toMatchObject({
      changes: null,
      entry: null,
    });
    expect(wakeStep(left, host, { object: COUNTER, serial: 99, ...at(5) })).toMatchObject({
      changes: null,
      entry: null,
    });
  });

  it('writes a faulted wake’s consumption, and catch-up’s whole change set', async () => {
    const store = await seeded(host);
    await runCommand(store, 'w', host, command('rest counter', 0));
    const rested = await committedState(store, 'w', host);
    const [due] = dueWakes(rested, 500);
    const woke = wakeStep(rested, host, { object: due!.object, serial: due!.serial, ...at(500) });
    expect(woke.entry).toMatchObject({ kind: 'wake', fault: { name: 'ValueOutOfRange' } });
    expect(woke.changes?.upsert.find((i) => i.id === COUNTER)?.wakes).toEqual([]);
    const caught = maintenanceStep(rested, host, at(60));
    expect(caught.changes).toBe(caught.turn.changes);
    expect(caught.entry).toMatchObject({ kind: 'maintenance', delivered: [{ object: COUNTER }] });
  });

  it('gives an admission’s changes and entry, and nothing for a world that admits no one', async () => {
    const ines = { visit: visitKey('v-ines'), nickname: 'Ines', ...at(1) };
    const admitted = arrivalStep(await state(), host, ines);
    expect(admitted.changes?.visitors.map((v) => v.nickname)).toEqual(['Ines']);
    expect(admitted.entry).toMatchObject({ kind: 'arrival', outcome: 'admitted' });
    const closed = { ...host, catalogue: { ...host.catalogue, arrival: null } };
    expect(arrivalStep(await state(), closed, ines)).toMatchObject({ changes: null, entry: null });
  });
});
