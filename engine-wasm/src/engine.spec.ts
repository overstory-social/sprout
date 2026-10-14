import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  COUNTER,
  engineCases,
  HALL,
  MARTA,
  seeded,
  TALLY,
  type EngineWorld,
} from '@overstory/sprout/engine-conformance';
import { memoryStore, runCommand, type StoredState } from '@overstory/sprout/core';

import { wasmEngine } from './engine.js';
import { WasmInstance } from './instance.js';
import { engineBuilt, NOT_BUILT } from './wasm.js';

// The WebAssembly engine passes the engine conformance suite core's
// TypeScript engine passes, each case as a vitest case; and it keeps the
// world live, opening a stored state from its records only where the
// state it is handed is not the one it holds. Without engine.wasm every
// case is skipped, under words that say why.

const make = ({ host, cartridge }: EngineWorld) =>
  wasmEngine({ cartridge, catalogue: host.catalogue, budgets: host.budgets });

const command = (text: string) => ({ visit: MARTA, text, seed: 1, mayHold: null, now: 0 });

describe.skipIf(!engineBuilt())(
  'the WebAssembly engine passes the engine conformance suite',
  () => {
    for (const one of engineCases) {
      it(`${one.name} — ${one.proves}`, async () => {
        await one.run(make);
      });
    }
  },
);

describe.skipIf(!engineBuilt())('the WebAssembly engine’s live state', () => {
  afterEach(() => vi.restoreAllMocks());

  const opened = () => vi.spyOn(WasmInstance.prototype, 'open');
  const stored = (store: Awaited<ReturnType<typeof seeded>>): Promise<StoredState> =>
    store.read('w', (tx) => tx.state());

  it('runs each turn after a commit on the state it holds, once core hands back what landed', async () => {
    const store = await seeded(TALLY, [[MARTA, HALL, 'Marta']]);
    const host = { ...TALLY.host, engine: make(TALLY) };
    const opens = opened();
    await runCommand(store, 'w', host, command('bump counter'));
    expect(opens).toHaveBeenCalledTimes(1);
    for (let again = 0; again < 3; again++)
      await runCommand(store, 'w', host, command('bump counter'));
    host.engine.view(await stored(store), MARTA);
    expect(opens).toHaveBeenCalledTimes(1);
  });

  it('opens a stored state it has not seen from its records, and never runs on a live state the store has moved past', async () => {
    const store = await seeded(TALLY, [[MARTA, HALL, 'Marta']]);
    const engine = make(TALLY);
    const opens = opened();
    const first = await stored(store);
    const step = engine.command(first, command('bump counter'));
    // Nothing landed: the same stored state again is opened again, and reads as the store holds it.
    const again = engine.command(first, command('bump counter'));
    expect(opens).toHaveBeenCalledTimes(2);
    expect(again.changes).toEqual(step.changes);
    // Another engine moves the store on; this one's next turn opens what the store now holds.
    const other = { ...TALLY.host, engine: make(TALLY) };
    await runCommand(store, 'w', other, command('bump counter'));
    const moved = engine.command(await stored(store), command('bump counter'));
    expect(opens).toHaveBeenCalledTimes(4);
    expect(moved.changes?.upsert.find((one) => one.id === COUNTER)?.properties['n']?.value).toBe(2);
  });

  it('takes no landed state whose serial is not the one its live state reached', async () => {
    const store = await seeded(TALLY, [[MARTA, HALL, 'Marta']]);
    const engine = make(TALLY);
    const opens = opened();
    const first = await stored(store);
    engine.command(first, command('rest counter'));
    engine.landed!({ ...first, serial: first.serial + 7 });
    engine.view(first, MARTA);
    expect(opens).toHaveBeenCalledTimes(2);
  });

  it('refuses in words a planned step another engine’s line handed out', async () => {
    const engine = make(TALLY);
    const state = await stored(await seeded(TALLY, [[MARTA, HALL, 'Marta']], memoryStore()));
    // What it planned is not read: a step that no line of this engine handed out is not run.
    const planned = { ...command('twice counter'), planned: {} } as never;
    expect(() => engine.command(state, planned)).toThrow(/run by the engine whose line planned it/);
  });
});

describe.runIf(!engineBuilt())('the WebAssembly engine, without engine.wasm', () => {
  it.skip(NOT_BUILT, () => {});
});
