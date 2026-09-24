import { describe, expect, it } from 'vitest';

import { dueWakes, wakeTurn } from '@overstory/sprout/lang';

import { command, COUNTER, seeded, tally } from '../fixtures/tally.js';
import { committedState, runCommand } from '../turns.js';
import { WakeEntry, wakeEntry, wakeOf } from './wake.js';

const { host } = tally();

/** The tally with the counter rested at 0, and its wake as delivered at `now`. */
async function rested(now: number) {
  const store = await seeded(host);
  await runCommand(store, 'w', host, command('rest counter', 0));
  const state = await committedState(store, 'w', host);
  const [due] = dueWakes(state, now);
  const wake = { object: due!.object, serial: due!.serial, now, seed: 5, mayHold: null };
  return { state, wake };
}

describe('a wake in the log', () => {
  it('keeps the object, the serial it asked under, its inputs and what it said', async () => {
    const { state, wake } = await rested(60);
    const turn = wakeTurn(state, host, wake);
    if (!turn.committed) throw new Error('the wake did not commit');
    const entry = wakeEntry(wake, host, turn);
    expect(entry).toMatchObject({
      kind: 'wake',
      object: COUNTER,
      serial: wake.serial,
      now: 60,
      seed: 5,
      fault: null,
      effects: [],
    });
    expect(WakeEntry.parse(JSON.parse(JSON.stringify(entry)))).toEqual(entry);
  });

  it('keeps a consumed wake’s fault, and nothing it said', async () => {
    const { state, wake } = await rested(500);
    const turn = wakeTurn(state, host, wake);
    if (turn.committed || 'unwoken' in turn) throw new Error('the wake did not fault');
    expect(wakeEntry(wake, host, turn)).toMatchObject({
      fault: { name: 'ValueOutOfRange', engine: false },
      effects: [],
    });
  });

  it('hands back the wake as the host handed it over', async () => {
    const { state, wake } = await rested(60);
    const turn = wakeTurn(state, host, wake);
    if (!turn.committed) throw new Error('the wake did not commit');
    const entry = wakeEntry(wake, host, turn);
    expect(wakeOf('tally', entry)).toEqual(wake);
    expect(() => wakeOf('tally', { ...entry, object: 'tally#0' })).toThrow();
  });
});
