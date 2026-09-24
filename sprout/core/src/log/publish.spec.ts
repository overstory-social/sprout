import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '@overstory/sprout/lang';

import { tally } from '../fixtures/tally.js';
import { memoryStore } from '../memory-store.js';
import type { MicroworldRecord } from '../records.js';
import { readLog } from './entry.js';
import { PublishEntry, publishEntry, publishWorld } from './publish.js';

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
    expect(first).toEqual({ kind: 'publish', now: 3_000_000_000, bundle: tally().bundle.hash });
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
});
