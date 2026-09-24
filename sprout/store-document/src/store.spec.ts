import { describe, expect, it } from 'vitest';

import type { StoredChanges, StoredInstance, StoredVisitor } from '@overstory/sprout/core';

import { memoryBackend, type DocumentBackend } from './backend.js';
import { documentStore, keys, parseKey } from './store.js';

// The layout, pinned: which key holds what, the instances and
// tombstones as one opaque string, one document per visitor, log entry
// and miss, ids encoded so a microworld named `<zone>/draft` is not the zone's.

/** The spec's default caps, as a publish under a host that set none of its own records them. */
const CAPS = {
  optionsPerEnum: 100,
  rolesPerVerb: 8,
  phrasesPerVerb: 8,
  phraseCharacters: 80,
  nounsPerObject: 8,
  nounCharacters: 40,
  exitsPerPlace: 8,
  listElements: 16,
  literalCharacters: 600,
  places: null,
  objects: null,
  kinds: null,
  files: null,
  sourceBytes: null,
};

const NOW = new Date('2026-09-18T12:00:00Z');
const microworld = (id: string) => ({
  id,
  archive: { files: [{ name: 'a.sprout', source: 'room hall {}' }], manifest: null },
  stamp: 's',
  level: 1,
  extensions: [],
  caps: CAPS,
  excepted: false,
  loadedAt: NOW,
});
const lamp: StoredInstance = {
  id: 'shop.hall.lamp',
  made: { from: 'declared' },
  container: 'shop.hall',
  arrival: null,
  properties: { lit: { type: 'boolean', value: true } },
  links: {},
  wakes: [],
  memory: { 'shop#1': { seen: { type: 'boolean', value: true } } },
  lastTick: null,
};
const marta: StoredInstance = {
  ...lamp,
  id: 'shop#1',
  made: { from: 'visitor' },
  arrival: 1,
  properties: {},
  memory: {},
};
const visitor = (visit: string): StoredVisitor => ({
  visit,
  nickname: 'Marta',
  instance: 'shop#1',
  lastPlace: 'shop.hall',
});
const turn = (over: Partial<StoredChanges> = {}): StoredChanges => ({
  serial: 1,
  upsert: [lamp, marta],
  remove: [],
  tombstones: ['shop.hall.vase'],
  visitors: [visitor('v-marta')],
  ...over,
});
const PUBLISH = { kind: 'publish', now: 3_000_000_000, bundle: 'a1' } as const;

describe('the keys', () => {
  it('put the microworld first, URL-encoded, so `<zone>/draft` is its own prefix', () => {
    expect(keys.state('z/draft')).toBe('microworld/z%2Fdraft/state');
    expect(keys.microworld('z')).toBe('microworld/z/');
    expect(keys.visitor('z', 'p/1')).toBe('microworld/z/visitors/p%2F1');
    expect(keys.entry('z', 7)).toBe('microworld/z/log/000000000007');
    expect(parseKey('microworld/z%2Fdraft/visitors/p%2F1')).toEqual({
      microworldId: 'z/draft',
      collection: 'visitors',
      member: 'p/1',
    });
    expect(parseKey('microworld/z/state')).toEqual({
      microworldId: 'z',
      collection: 'state',
      member: null,
    });
    expect(parseKey('other/thing')).toBeNull();
  });
});

describe('the layout on the backend', () => {
  it('instances and tombstones are one document holding an opaque string; each visitor, log entry and miss one document; the counters one', async () => {
    const backend = memoryBackend();
    const store = documentStore(backend);
    await store.transaction('w', async (tx) => {
      await tx.putMicroworld(microworld('w'));
      await tx.putState(turn());
      await tx.appendLog(PUBLISH);
      await tx.appendLog({ ...PUBLISH, bundle: 'b2' });
      await tx.appendMiss({
        microworldId: 'w',
        at: NOW,
        roomId: 'shop.hall',
        input: 'dance',
        couldSay: [],
        couldName: [],
        state: { room: lamp, items: [] },
      });
    });
    expect(await backend.list('')).toEqual([
      'microworld/w/archive',
      'microworld/w/counters',
      'microworld/w/log/000000000001',
      'microworld/w/log/000000000002',
      'microworld/w/misses/000000000001',
      'microworld/w/state',
      'microworld/w/visitors/v-marta',
    ]);
    const state = (await backend.get('microworld/w/state')) as { blob: string };
    expect(typeof state.blob).toBe('string');
    expect(JSON.parse(state.blob)).toEqual({
      instances: [marta, lamp],
      tombstones: ['shop.hall.vase'],
    });
    expect(await backend.get('microworld/w/counters')).toEqual({
      serial: 1,
      log: 2,
      misses: 1,
    });
    expect(await backend.get('microworld/w/visitors/v-marta')).toEqual(visitor('v-marta'));
    // Dates travel as ISO strings and come back as dates.
    expect((await backend.get('microworld/w/archive')) as object).toMatchObject({
      loadedAt: '2026-09-18T12:00:00.000Z',
    });
    await store.read('w', async (tx) => {
      expect((await tx.microworld())?.loadedAt).toEqual(NOW);
      expect(await tx.log({ after: 1, limit: 5 })).toEqual([
        { seq: 2, entry: { ...PUBLISH, bundle: 'b2' } },
      ]);
    });
  });

  it('a turn writes only the visitor documents it changed', async () => {
    const backend = memoryBackend();
    const writes: string[] = [];
    const watching: DocumentBackend = {
      ...backend,
      transact: (ks, fn) =>
        backend.transact(ks, (tx) =>
          fn({
            ...tx,
            get: (k) => tx.get(k),
            list: (p) => tx.list(p),
            put: async (k, d) => {
              writes.push(k);
              await tx.put(k, d);
            },
            delete: (k) => tx.delete(k),
          }),
        ),
    };
    const store = documentStore(watching);
    await store.transaction('w', async (tx) =>
      tx.putState(turn({ visitors: [visitor('v-marta'), visitor('v-ines')] })),
    );
    writes.length = 0;
    await store.transaction('w', async (tx) =>
      tx.putState(turn({ serial: 2, upsert: [lamp], visitors: [] })),
    );
    expect(writes.sort()).toEqual(['microworld/w/counters', 'microworld/w/state']);
  });

  it('a document that is not the record it should be is refused by name', async () => {
    const backend = memoryBackend();
    await backend.put('microworld/w/visitors/v', { garbage: true });
    await backend.put('microworld/x/state', { blob: '{"instances":[{"nope":1}],"tombstones":[]}' });
    const store = documentStore(backend);
    await expect(store.read('w', (tx) => tx.state())).rejects.toThrow(
      'microworld/w/visitors/v is not the record it should be',
    );
    await expect(store.read('x', (tx) => tx.state())).rejects.toThrow(
      'microworld/x/state is not the record it should be',
    );
  });

  it('reads a stored microworld that lists what was blessed at publish, without the list', async () => {
    const backend = memoryBackend();
    await backend.put('microworld/w/archive', {
      ...microworld('w'),
      loadedAt: NOW.toISOString(),
      blessed: ['a'.repeat(64)],
    });
    const read = await documentStore(backend).read('w', (tx) => tx.microworld());
    expect(read).toEqual(microworld('w'));
  });

  it('a read is memoised by key: the state document is fetched once for the read, however often it is asked', async () => {
    const backend = memoryBackend();
    let gets = 0;
    const counting = { ...backend, get: async (k: string) => (gets++, backend.get(k)) };
    const store = documentStore(counting);
    await store.transaction('w', async (tx) => {
      await tx.putMicroworld(microworld('w'));
      await tx.putState(turn());
    });
    gets = 0;
    await store.read('w', async (tx) => {
      await tx.state();
      await tx.state();
      await tx.microworld();
    });
    // The state, the counters, one visitor, the archive.
    expect(gets).toBe(4);
  });

  it('a write transaction, a forget and an export each lock the state key of the world alone', async () => {
    const backend = memoryBackend();
    const locked: string[][] = [];
    const watching: DocumentBackend = {
      ...backend,
      transact: (ks, fn) => {
        locked.push([...ks]);
        return backend.transact(ks, fn);
      },
    };
    const store = documentStore(watching);
    for (const w of ['a', 'b']) {
      await store.transaction(w, async (tx) => {
        await tx.putMicroworld(microworld(w));
        await tx.putState(turn());
      });
    }
    await store.exportVisitor('v-marta');
    await store.forgetVisitor('v-marta');
    await store.forgetVisitor('v-marta');
    expect(locked).toEqual([
      ['microworld/a/state'],
      ['microworld/b/state'],
      ['microworld/a/state'],
      ['microworld/b/state'],
      ['microworld/a/state'],
      ['microworld/b/state'],
    ]);
    expect(await backend.list('microworld/a/')).toEqual([
      'microworld/a/archive',
      'microworld/a/counters',
      'microworld/a/state',
    ]);
  });

  it('destroyMicroworld takes every document under its prefix and nothing under a lookalike', async () => {
    const backend = memoryBackend();
    const store = documentStore(backend);
    for (const id of ['z', 'z/draft', 'zz']) {
      await store.transaction(id, async (tx) => {
        await tx.putMicroworld(microworld(id));
        await tx.putState(turn());
      });
    }
    await store.destroyMicroworld('z');
    const left = await backend.list('');
    expect(left.some((k) => k.startsWith('microworld/z/'))).toBe(false);
    expect(left.filter((k) => k.startsWith('microworld/z%2Fdraft/'))).toHaveLength(4);
    expect(left.filter((k) => k.startsWith('microworld/zz/'))).toHaveLength(4);
  });
});
