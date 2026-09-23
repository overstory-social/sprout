import { describe, expect, it } from 'vitest';

import { memoryBackend, type DocumentBackend } from './backend.js';
import { documentStore, keys, parseKey } from './store.js';

// The layout, pinned: which key holds what,
// the objects as one opaque string, one document per action and miss,
// ids encoded so a microworld named `<zone>/draft` is not the zone's.

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
const actor = (microworldId: string, id: string) => ({
  microworldId,
  id,
  name: id,
  roomId: 'hall',
  lastSeen: NOW,
  narration: [],
  lastNoun: null,
  pending: [],
});
const action = (microworldId: string) => ({
  microworldId,
  at: NOW,
  roomId: 'hall',
  command: 'poke',
  events: 1,
  depth: 0,
  spawned: 0,
  faulted: false,
  fault: null,
  missed: false,
  durationMs: 1,
  lockWaitMs: 0,
});

describe('the keys', () => {
  it('put the microworld first, URL-encoded, so `<zone>/draft` is its own prefix', () => {
    expect(keys.objects('z/draft')).toBe('microworld/z%2Fdraft/objects');
    expect(keys.microworld('z')).toBe('microworld/z/');
    expect(keys.actor('z', 'p/1')).toBe('microworld/z/actors/p%2F1');
    expect(keys.action('z', 7)).toBe('microworld/z/actions/000000000007');
    expect(parseKey('microworld/z%2Fdraft/actors/p%2F1')).toEqual({
      microworldId: 'z/draft',
      collection: 'actors',
      member: 'p/1',
    });
    expect(parseKey('microworld/z/objects')).toEqual({
      microworldId: 'z',
      collection: 'objects',
      member: null,
    });
    expect(parseKey('other/thing')).toBeNull();
  });
});

describe('the layout on the backend', () => {
  it('objects are one document holding an opaque string; actors, memory, actions and misses one document each; the counters one', async () => {
    const backend = memoryBackend();
    const store = documentStore(backend);
    await store.transaction('w', async (tx) => {
      await tx.putMicroworld(microworld('w'));
      await tx.putObjects({
        upsert: [
          {
            microworldId: 'w',
            id: 'lamp',
            spawnedFrom: null,
            container: 'hall',
            home: 'hall',
            state: { lit: true },
          },
        ],
        remove: [],
      });
      await tx.putActor(actor('w', 'v'));
      await tx.putMemory({ microworldId: 'w', actorId: 'v', byObject: { lamp: { seen: true } } });
      await tx.appendAction(action('w'));
      await tx.appendAction(action('w'));
      await tx.appendMiss({
        microworldId: 'w',
        at: NOW,
        roomId: 'hall',
        input: 'dance',
        couldSay: [],
        couldName: [],
        state: { room: {}, items: {} },
      });
      expect(await tx.nextSpawn()).toBe(1);
      expect(await tx.nextSpawn()).toBe(2);
    });
    expect(await backend.list('')).toEqual([
      'microworld/w/actions/000000000001',
      'microworld/w/actions/000000000002',
      'microworld/w/actors/v',
      'microworld/w/archive',
      'microworld/w/counters',
      'microworld/w/memory/v',
      'microworld/w/misses/000000000001',
      'microworld/w/objects',
    ]);
    const objects = (await backend.get('microworld/w/objects')) as { blob: string };
    expect(typeof objects.blob).toBe('string');
    expect(JSON.parse(objects.blob)).toEqual([
      {
        microworldId: 'w',
        id: 'lamp',
        spawnedFrom: null,
        container: 'hall',
        home: 'hall',
        state: { lit: true },
      },
    ]);
    expect(await backend.get('microworld/w/counters')).toEqual({ spawn: 2, actions: 2, misses: 1 });
    // Dates travel as ISO strings and come back as dates.
    expect((await backend.get('microworld/w/actors/v')) as object).toMatchObject({
      lastSeen: '2026-09-18T12:00:00.000Z',
    });
    await store.read('w', async (tx) => {
      expect((await tx.actor('v'))?.lastSeen).toEqual(NOW);
      expect((await tx.microworld())?.loadedAt).toEqual(NOW);
      expect((await tx.actions({ limit: 5 }))[0]?.at).toEqual(NOW);
    });
  });

  it('a document that is not the record it should be is refused by name', async () => {
    const backend = memoryBackend();
    await backend.put('microworld/w/actors/v', { garbage: true });
    await backend.put('microworld/w/objects', { blob: '[{"nope":1}]' });
    const store = documentStore(backend);
    await expect(store.read('w', (tx) => tx.actor('v'))).rejects.toThrow(
      'microworld/w/actors/v is not the record it should be',
    );
    await expect(store.read('w', (tx) => tx.objects())).rejects.toThrow(
      'microworld/w/objects is not the record it should be',
    );
  });

  it('a read is memoised by key: the objects document is fetched once for the read, however often it is asked', async () => {
    const backend = memoryBackend();
    let gets = 0;
    const counting = { ...backend, get: async (k: string) => (gets++, backend.get(k)) };
    const store = documentStore(counting);
    await store.transaction('w', async (tx) => tx.putMicroworld(microworld('w')));
    gets = 0;
    await store.read('w', async (tx) => {
      await tx.objects();
      await tx.objects();
      await tx.microworld();
    });
    expect(gets).toBe(2);
  });

  it('a write transaction locks the objects key alone; the heartbeat locks the actor’s', async () => {
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
    await store.transaction('w', async (tx) => {
      await tx.putMicroworld(microworld('w'));
      await tx.putActor(actor('w', 'v'));
    });
    await store.read('w', (tx) => tx.touchActor('v', NOW, true));
    await store.read('w', (tx) => tx.touchActor('nobody', NOW, true));
    expect(locked).toEqual([
      ['microworld/w/objects'],
      ['microworld/w/actors/v'],
      ['microworld/w/actors/nobody'],
    ]);
  });

  it('forgetActor holds the actor’s keys, so a heartbeat racing it cannot bring the row back', async () => {
    const backend = memoryBackend();
    const store = documentStore(backend);
    await store.transaction('w', async (tx) => {
      await tx.putMicroworld(microworld('w'));
      await tx.putActor(actor('w', 'v'));
      await tx.putMemory({ microworldId: 'w', actorId: 'v', byObject: {} });
    });
    // The heartbeat is a small transaction on the actor's key; the forget
    // takes the same key, so they run in order — whichever is first.
    await Promise.all([
      store.read('w', (tx) => tx.touchActor('v', new Date(NOW.getTime() + 1000), true)),
      store.forgetActor('v'),
      store.read('w', (tx) => tx.touchActor('v', new Date(NOW.getTime() + 2000), true)),
    ]);
    expect(await backend.list('microworld/w/')).toEqual(['microworld/w/archive']);
    // …and the keys were held, not merely deleted one by one
    const locked: string[][] = [];
    const watching: DocumentBackend = {
      ...backend,
      transact: (ks, fn) => {
        locked.push([...ks].sort());
        return backend.transact(ks, fn);
      },
    };
    const again = documentStore(watching);
    await again.transaction('w', async (tx) => tx.putActor(actor('w', 'v')));
    await again.exportActor('v');
    await again.forgetActor('v');
    expect(locked.slice(1)).toEqual([['microworld/w/actors/v'], ['microworld/w/actors/v']]);
  });

  it('destroyMicroworld takes every document under its prefix and nothing under a lookalike', async () => {
    const backend = memoryBackend();
    const store = documentStore(backend);
    for (const id of ['z', 'z/draft', 'zz']) {
      await store.transaction(id, async (tx) => {
        await tx.putMicroworld(microworld(id));
        await tx.putActor(actor(id, 'v'));
      });
    }
    await store.destroyMicroworld('z');
    const left = await backend.list('');
    expect(left.some((k) => k.startsWith('microworld/z/'))).toBe(false);
    expect(left.filter((k) => k.startsWith('microworld/z%2Fdraft/'))).toHaveLength(2);
    expect(left.filter((k) => k.startsWith('microworld/zz/'))).toHaveLength(2);
  });
});
