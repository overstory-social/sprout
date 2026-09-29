import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '@overstory/sprout/lang';

import { command, seeded, tally } from '../fixtures/tally.js';
import { runCommand } from '../turns.js';
import { memoryStore } from '../memory-store.js';
import type { MicroworldRecord } from '../records.js';
import { readLog } from './entry.js';
import { deployWorld, PublishEntry, publishEntry, publishWorld } from './publish.js';

const record: MicroworldRecord = {
  id: 'w',
  archive: { files: [], manifest: null },
  stamp: 'stamp-1',
  level: 1,
  extensions: [],
  caps: DEFAULT_LIMITS.caps,
  excepted: false,
  loadedAt: new Date('2026-09-18T12:00:00Z'),
};

describe('a publish in the log', () => {
  it('keeps the bundle’s hash and the instant, and two bundles that run differently log two hashes', () => {
    const first = publishEntry(tally().bundle, 3_000_000_000);
    expect(first).toEqual({
      kind: 'publish',
      level: 'info',
      now: 3_000_000_000,
      bundle: tally().bundle.hash,
    });
    expect(PublishEntry.parse(first)).toEqual(first);
    expect(publishEntry(tally('Clack.').bundle, 0).bundle).not.toBe(first.bundle);
  });

  it('refuses an instant that is not whole host seconds', () => {
    expect(() => publishEntry(tally().bundle, -1)).toThrow(/whole seconds/);
  });

  it('puts the record and logs the publish in one transaction', async () => {
    const store = memoryStore();
    const entry = await publishWorld(store, record, tally().bundle, 5);
    expect(await store.read('w', (tx) => tx.microworld())).toEqual(record);
    expect(await readLog(store, 'w', { limit: 10 })).toEqual([{ seq: 1, entry }]);
  });

  it('puts no record where the log cannot be written', async () => {
    const store = memoryStore();
    const failing: typeof store = {
      ...store,
      transaction: (id, fn) =>
        store.transaction(id, (tx) =>
          fn({ ...tx, appendLog: () => Promise.reject(new Error('the log is down')) }),
        ),
    };
    await expect(publishWorld(failing, record, tally().bundle, 6)).rejects.toThrow('down');
    expect(await store.read('w', (tx) => tx.microworld())).toBeNull();
  });

  it('redeploys the world: nothing it stored carries over, and its log is kept', async () => {
    const { host, bundle } = tally();
    const store = await seeded(host);
    await runCommand(store, 'w', host, command('bump counter'));
    const before = (await readLog(store, 'w', { limit: 100 })).length;
    await publishWorld(store, record, bundle, 7);
    const state = await store.read('w', (tx) => tx.state());
    expect(state.instances).toEqual([]);
    expect(state.visitors).toEqual([]);
    expect(state.serial).toBe(0);
    expect(await readLog(store, 'w', { limit: 100 })).toHaveLength(before + 1);
  });
});

describe('deploying a world as a host starts', () => {
  it('keeps what it stored where it last ran these same files, and redeploys it otherwise', async () => {
    const { host, bundle } = tally();
    const store = await seeded(host);
    await publishWorld(store, record, bundle, 1);
    await store.transaction('w', async (tx) =>
      tx.putState({ serial: 3, upsert: [], remove: [], tombstones: [], visitors: [] }),
    );
    expect(await deployWorld(store, record, bundle, 2)).toBe('kept');
    expect((await store.read('w', (tx) => tx.state())).serial).toBe(3);
    expect(await deployWorld(store, { ...record, stamp: 'stamp-2' }, bundle, 3)).toBe('redeployed');
    expect((await store.read('w', (tx) => tx.state())).serial).toBe(0);
    expect(await deployWorld(memoryStore(), record, bundle, 4)).toBe('redeployed');
  });
});
