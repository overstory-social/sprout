import { describe, expect, it } from 'vitest';

import { tally } from '../fixtures/tally.js';
import { memoryStore } from '../memory-store.js';
import { readLog } from './entry.js';
import { logWithholding, WithholdingEntry, withholdingEntry } from './withholding.js';

const { bundle } = tally();

describe('a withholding in the log', () => {
  it('keeps every file withheld, once each in code-unit order, and the bundle the world then runs', () => {
    const entry = withholdingEntry(['cellar.sprout', 'Attic.sprout', 'cellar.sprout'], bundle, 9);
    expect(entry).toEqual({
      kind: 'withholding',
      now: 9,
      withheld: ['Attic.sprout', 'cellar.sprout'],
      bundle: bundle.hash,
    });
    expect(WithholdingEntry.parse(entry)).toEqual(entry);
  });

  it('records a withholding lifted as the set without the file', () => {
    expect(withholdingEntry([], bundle, 10).withheld).toEqual([]);
  });

  it('appends the entry to the world’s log', async () => {
    const store = memoryStore();
    const entry = await logWithholding(store, 'w', ['cellar.sprout'], bundle, 11);
    expect(await readLog(store, 'w', { limit: 10 })).toEqual([{ seq: 1, entry }]);
  });
});
