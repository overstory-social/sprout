import { describe, expect, it } from 'vitest';

import { HALL, hallHost, hallWith, MARTA } from './fixtures/hall.js';
import { runReadings, runScene, runView, ViewCache } from './views.js';

// A visitor's view against a store, and a host's cache of it, on a
// stand-in engine: a poll's fault logged, and what the cache keeps until a
// visitor is named stale. What every engine must give of a poll is the
// engine conformance suite's.

const log = async (store: Awaited<ReturnType<typeof hallWith>>) =>
  (await store.read('w', (tx) => tx.log({ limit: 100 }))).map(({ entry }) => entry);

describe('a poll against a store', () => {
  it('gives the engine’s view, scene and readings, and logs nothing where it did not fault', async () => {
    const store = await hallWith([MARTA, 'Marta']);
    const host = hallHost();
    expect((await runView(store, 'w', host, MARTA, 0)).view.description).toEqual(['A bare hall.']);
    expect((await runScene(store, 'w', host, MARTA, 0)).scene.verbs).toHaveLength(1);
    expect((await runReadings(store, 'w', host, MARTA, 'hall.wave', 0)).verb).toBe('hall.wave');
    expect(await log(store)).toEqual([]);
  });

  it('logs a poll’s fault as an authoring fault at the instant it ran, writing nothing of the world', async () => {
    const store = await hallWith([MARTA, 'Marta']);
    const before = await store.read('w', (tx) => tx.state());
    const host = hallHost();
    host.standing.pollsFault = true;
    await runView(store, 'w', host, MARTA, 7);
    await runReadings(store, 'w', host, MARTA, 'hall.wave', 8);
    expect(await log(store)).toMatchObject([
      { kind: 'poll-fault', now: 7, fault: { name: 'IntegerOverflow', object: HALL } },
      { kind: 'poll-fault', now: 8 },
    ]);
    expect(await store.read('w', (tx) => tx.state())).toEqual(before);
  });
});

describe('the view cache', () => {
  it('keeps a view, a scene and a verb’s readings until their visitor is named stale', async () => {
    const store = await hallWith([MARTA, 'Marta']);
    const host = hallHost();
    const cache = new ViewCache();
    const view = await cache.view(store, 'w', host, MARTA, 0);
    expect(await cache.view(store, 'w', host, MARTA, 0)).toBe(view);
    await cache.readings(store, 'w', host, MARTA, 'hall.wave', 0);
    await cache.readings(store, 'w', host, MARTA, 'hall.wave', 0);
    expect(host.standing.asked).toEqual(['view', 'scene', 'readings']);
    cache.stale('w', [MARTA]);
    expect(await cache.view(store, 'w', host, MARTA, 0)).not.toBe(view);
    cache.clear('w');
    await cache.view(store, 'w', host, MARTA, 0);
    expect(host.standing.asked).toEqual(['view', 'scene', 'readings', 'view', 'view']);
  });

  it('gives no readings, and polls none, for a verb the scene does not list', async () => {
    const store = await hallWith([MARTA, 'Marta']);
    const host = hallHost();
    const cache = new ViewCache();
    expect(await cache.readings(store, 'w', host, MARTA, 'hall.leap', 0)).toEqual({
      visit: MARTA,
      verb: 'hall.leap',
      readings: [],
      fault: null,
    });
    expect(host.standing.asked).toEqual(['scene']);
  });

  it('does not keep a poll its visitor was named stale during', async () => {
    const store = await hallWith([MARTA, 'Marta']);
    const host = hallHost();
    const cache = new ViewCache();
    const polling = cache.view(store, 'w', host, MARTA, 0);
    cache.stale('w', [MARTA]);
    await polling;
    await cache.view(store, 'w', host, MARTA, 0);
    expect(host.standing.asked).toEqual(['view', 'view']);
  });
});
