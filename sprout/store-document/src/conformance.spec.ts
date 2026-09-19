import 'fake-indexeddb/auto';

import { afterEach, describe, expect, it } from 'vitest';

import { cannotProve, cases, runConformance } from '@overstory/sprout-core/conformance';

import { memoryBackend } from './backend.js';
import { indexedDbBackend } from './indexeddb.js';
import { documentStore } from './store.js';

// The document store runs core's conformance suite (the split proposal
// §4.6) on BOTH backends: the memory backend, and IndexedDB under
// fake-indexeddb — real multi-store transactions, one connection. Every
// case runs, including the two a single Postgres connection cannot
// (serialization and the read snapshot are the backend's locks and the
// read's memoised snapshot, both in-process here). What neither backend
// proves is contention across PROCESSES — two tabs on one origin — which
// the Web Locks API answers in a browser and no test here reaches.

describe('documentStore(memoryBackend()) passes the conformance suite', () => {
  for (const c of cases) {
    it(`${c.name} — ${c.proves}`, async () => {
      await c.run(() => documentStore(memoryBackend()));
    });
  }
  it('runConformance runs them all', async () => {
    await expect(runConformance(() => documentStore(memoryBackend()))).resolves.toBeUndefined();
  });
});

describe('documentStore(indexedDbBackend()) passes the conformance suite', () => {
  let n = 0;
  const open: { close(): Promise<void> }[] = [];
  const make = () => {
    const backend = indexedDbBackend(`conformance-${n++}`);
    open.push(backend);
    return documentStore(backend);
  };
  afterEach(async () => {
    for (const b of open.splice(0)) await b.close();
  });
  for (const c of cases) {
    it(`${c.name} — ${c.proves}`, async () => {
      await c.run(make);
    });
  }
  it('says what a single process cannot prove', () => {
    expect(cannotProve).toEqual([
      'real contention: one connection blocking another until commit',
      'lock timeouts firing rather than hanging',
    ]);
  });
});
