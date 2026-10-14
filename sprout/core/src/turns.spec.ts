import { describe, expect, it } from 'vitest';

import { type CaughtUp, type CommandTurn, type Committed } from '@overstory/sprout/lang';

import { tsEngine } from './engine.js';
import { admissionCases } from './engine-conformance/admission.js';
import { turnCases } from './engine-conformance/turns.js';
import { COUNTER, GAUGE, command, seeded as seededTally, tally } from './fixtures/tally.js';
import type { SproutStore } from './store.js';
import { committedStored, runCommand, runMaintenance } from './turns.js';
import { tsTurn } from './fixtures/committed.js';

// A world's turns against a store. What every engine must do of them is
// the engine conformance suite's turns, admission and log cases, run here
// under the TypeScript runtime; what follows them reads what only that
// runtime's turns hold.

const { host } = tally();
const seeded = (store?: SproutStore) => seededTally(host, store);
const stored = (store: SproutStore) => store.read('w', (tx) => tx.state());

describe('the engine conformance suite’s turns, under the TypeScript runtime', () => {
  for (const one of [...turnCases, ...admissionCases]) {
    it(`${one.name} — ${one.proves}`, async () => {
      await one.run(({ host: made }) => tsEngine(made));
    });
  }
});

describe('the committed stored state', () => {
  it('is what the store holds once a turn committed, read with no lock', async () => {
    const store = await seeded();
    await runCommand(store, 'w', host, command('bump counter'));
    expect(await committedStored(store, 'w')).toEqual(await stored(store));
    let release!: () => void;
    const held = store.transaction('w', () => new Promise<void>((resolve) => (release = resolve)));
    // Read while a write turn holds the lock, it does not wait for it.
    expect(await committedStored(store, 'w')).toEqual(await stored(store));
    release();
    await held;
  });
});

describe('the TypeScript runtime’s turns against a store', () => {
  it('tell the actor of a command that faults in the engine’s `fault`', async () => {
    const store = await seeded();
    const turn = await runCommand(store, 'w', host, command('smash counter'));
    expect(turn.committed).toBe(false);
    expect(tsTurn<CommandTurn & { committed: false }>(turn).told.effect).toBe('notice');
  });

  it('give back which wakes catch-up delivered, which faulted and which it abandoned', async () => {
    const store = await seeded();
    await runCommand(store, 'w', host, command('rest counter', 0));
    await runCommand(store, 'w', host, command('rest gauge', 50));
    // The counter has waited 120 seconds, past what it holds; the gauge 70.
    const turn = tsTurn<Committed<CaughtUp>>(
      await runMaintenance(store, 'w', host, { now: 120, seed: 8, mayHold: null }),
    );
    expect(turn.value.faulted).toMatchObject([
      { wake: { object: COUNTER }, fault: { name: 'ValueOutOfRange' } },
    ]);
    expect(turn.value.delivered.map((w) => w.object)).toEqual([GAUGE]);
    expect(turn.value.abandoned).toEqual([]);
  });
});
