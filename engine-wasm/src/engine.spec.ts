import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  bundleOn,
  COUNTER,
  engineCases,
  HALL,
  MARTA,
  playedTally,
  seeded,
  TALLY,
  type EngineWorld,
} from '@overstory/sprout/engine-conformance';
import type { InstanceId } from '@overstory/sprout/lang';
import {
  memoryStore,
  replayLog,
  runCommand,
  tsEngine,
  wholeLog,
  type StoredState,
} from '@overstory/sprout/core';

import { wasmEngine } from './engine.js';
import { WasmInstance } from './instance.js';
import { engineBuilt, NOT_BUILT } from './wasm.js';

// The WebAssembly engine passes the engine conformance suite core's
// TypeScript engine passes, each case as a vitest case; it keeps the
// world live, opening a stored state from its records only where the
// state it is handed is not the one it holds; and either engine replays
// the other's log to the same stored state. Without engine.wasm every
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

  it('runs a planned step no line of its own handed out, as a replay hands one over', async () => {
    const engine = make(TALLY);
    const state = await stored(await seeded(TALLY, [[MARTA, HALL, 'Marta']], memoryStore()));
    const verb = TALLY.host.catalogue.verbs.qualified('tally', 'bump')!;
    const actor = state.visitors[0]!.instance as InstanceId;
    const planned = { verb, actor, bindings: new Map([['target', { object: COUNTER }]]) };
    const step = engine.command(state, { ...command('twice counter'), planned });
    expect(step.turn.committed && step.turn.effects.map((one) => one.paragraphs)).toEqual([
      ['Click.'],
    ]);
    expect(step.entry).toMatchObject({
      text: 'twice counter',
      planned: {
        verb: { library: 'tally', name: 'bump' },
        bindings: [['target', { object: COUNTER }]],
      },
    });
  });
});

describe.skipIf(!engineBuilt())('a log replayed on the other engine', () => {
  const ts = ({ host }: EngineWorld) => tsEngine(host);
  for (const [played, replayed, name] of [
    [ts, make, 'the TypeScript runtime’s log on the WebAssembly engine'],
    [make, ts, 'the WebAssembly engine’s log on the TypeScript runtime'],
  ] as const) {
    it(`replays ${name} to the same stored state`, async () => {
      const store = await playedTally(played, 'play');
      const again = replayLog(await wholeLog(store, 'w', 100), bundleOn(replayed, TALLY));
      expect(again.diverged).toEqual([]);
      expect(again.state).toEqual(await store.read('w', (tx) => tx.state()));
    });
  }
});

describe.runIf(!engineBuilt())('the WebAssembly engine, without engine.wasm', () => {
  it.skip(NOT_BUILT, () => {});
});
