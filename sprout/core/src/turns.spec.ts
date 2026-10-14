import { describe, expect, it } from 'vitest';

import { CATALOGUE, HALL, hallHost, hallWith, INES, MARTA } from './fixtures/hall.js';
import type { SproutStore } from './store.js';
import {
  committedStored,
  runArrival,
  runCommand,
  runCommandLine,
  runDeparture,
  runTick,
  runWake,
} from './turns.js';

// A world's turns against a store, on a stand-in engine: what lands, what
// the log keeps and at what depth, and the order an admission runs in.
// What every engine must do of them is the engine conformance suite's.

const at = (now: number) => ({ now, seed: 1, mayHold: null });
const typed = (text: string, now = 0) => ({ visit: MARTA, text, ...at(now) });
const stored = (store: SproutStore) => store.read('w', (tx) => tx.state());
const log = (store: SproutStore) => store.read('w', (tx) => tx.log({ limit: 100 }));

describe('the committed stored state', () => {
  it('is what the store holds once a turn committed, read with no lock', async () => {
    const store = await hallWith([MARTA, 'Marta']);
    await runCommand(store, 'w', hallHost(), typed('wave'));
    expect(await committedStored(store, 'w')).toEqual(await stored(store));
    let release!: () => void;
    const held = store.transaction('w', () => new Promise<void>((resolve) => (release = resolve)));
    // Read while a write turn holds the lock, it does not wait for it.
    expect(await committedStored(store, 'w')).toEqual(await stored(store));
    release();
    await held;
  });
});

describe('a write turn against a store', () => {
  it('writes what it changed, appends its entry, and hands the engine the state it landed', async () => {
    const store = await hallWith([MARTA, 'Marta']);
    const host = hallHost();
    const before = await stored(store);
    const turn = await runCommand(store, 'w', host, typed('wave'));
    expect(turn).toMatchObject({ committed: true, stale: [MARTA] });
    expect((await stored(store)).serial).toBe(before.serial + 1);
    expect(host.standing.asked).toEqual(['command', 'landed']);
    expect((await log(store)).map(({ entry }) => entry.kind)).toEqual(['command']);
  });

  it('writes nothing of the world for a fault, and logs it', async () => {
    const store = await hallWith([MARTA, 'Marta']);
    const before = await stored(store);
    const turn = await runCommand(store, 'w', hallHost(), typed('fault'));
    expect(turn.committed).toBe(false);
    expect(await stored(store)).toEqual(before);
    expect((await log(store)).map(({ entry }) => entry)).toMatchObject([
      { kind: 'command', fault: { name: 'IntegerOverflow' } },
    ]);
  });

  it('keeps the entry at play depth where the host names none, its effects by their digest', async () => {
    for (const [depth, digested] of [
      [undefined, true],
      ['play', true],
      ['debug', false],
    ] as const) {
      const store = await hallWith([MARTA, 'Marta']);
      await runCommand(store, 'w', hallHost(depth), typed('wave'));
      const [one] = await log(store);
      expect('digest' in one!.entry, String(depth)).toBe(digested);
    }
  });

  it('runs a line’s commands as turns of their own, each after the first with its own seed, and stops at a fault', async () => {
    const store = await hallWith([MARTA, 'Marta']);
    let seed = 10;
    const turns = await runCommandLine(
      store,
      'w',
      hallHost(),
      typed('wave then fault then bow'),
      () => (seed += 1),
    );
    expect(turns.map((one) => one.committed)).toEqual([true, false]);
    expect((await log(store)).map(({ entry }) => 'seed' in entry && entry.seed)).toEqual([1, 11]);
  });

  it('runs a tick, a wake and a departure under the lock, each through the engine', async () => {
    const store = await hallWith([MARTA, 'Marta']);
    const host = hallHost();
    expect((await runTick(store, 'w', host, { place: HALL, ...at(1) })).committed).toBe(true);
    expect(await runWake(store, 'w', host, { object: HALL, serial: 9, ...at(2) })).toEqual({
      committed: false,
      unwoken: true,
    });
    expect((await runDeparture(store, 'w', host, { visit: MARTA, ...at(3) })).committed).toBe(true);
    expect(await runTick(store, 'w', host, { place: HALL, ...at(4) })).toEqual({
      committed: false,
      unoccupied: true,
    });
  });
});

describe('an admission', () => {
  it('asks the engine of the nickname, the host’s moderation of it as kept, then runs catch-up and the arrival', async () => {
    const store = await hallWith([MARTA, 'Marta']);
    const host = hallHost();
    const asked: string[] = [];
    const admitted = await runArrival(
      store,
      'w',
      host,
      at(5),
      { visit: INES, nickname: '  Ines ', ...at(5) },
      { moderate: (nickname) => (asked.push(nickname), true) },
    );
    expect(asked).toEqual(['Ines']);
    expect(host.standing.asked).toEqual([
      'nicknameRefusal',
      'maintenance',
      'landed',
      'nicknameRefusal',
      'arrival',
      'landed',
    ]);
    expect(admitted.arrived).toMatchObject({ committed: true, stale: [MARTA, INES] });
  });

  it('refuses a nickname the host’s moderation declines, in words, running nothing', async () => {
    const store = await hallWith([MARTA, 'Marta']);
    const host = hallHost();
    const admitted = await runArrival(
      store,
      'w',
      host,
      at(5),
      { visit: INES, nickname: 'Rude', ...at(5) },
      { moderate: () => false },
    );
    expect(admitted.caughtUp).toBeNull();
    expect(admitted.arrived).toMatchObject({
      committed: false,
      nicknameRefused: { reason: 'moderated', nickname: 'Rude' },
    });
    expect(host.standing.asked).toEqual(['nicknameRefusal']);
  });

  it('admits no one to a world whose bundle admits no one, and asks the engine nothing', async () => {
    const store = await hallWith();
    const host = { ...hallHost(), catalogue: { ...CATALOGUE, arrival: null } };
    const admitted = await runArrival(
      store,
      'w',
      host,
      at(0),
      { visit: INES, nickname: 'Ines', ...at(0) },
      { moderate: () => true },
    );
    expect(admitted.caughtUp).toBeNull();
    expect(admitted.arrived).toMatchObject({
      committed: false,
      closed: { words: expect.any(String) },
    });
    expect(host.standing.asked).toEqual([]);
  });
});
