import { readLog } from '../log/entry.js';
import type { SproutStore } from '../store.js';
import { runCommand } from '../turns.js';
import { runReadings, runScene, runView, ViewCache } from '../views.js';
import { equal, match, ok } from './check.js';
import {
  LAMPLIGHT,
  LAMPLIT_HALL,
  MARTA,
  played,
  seeded,
  type EngineCase,
  type MakeEngine,
} from './worlds.js';

// The suite's polls against a store (the spec's The runtime › The view):
// the view, whole or in parts, rendered from the last committed state,
// a poll that runs out logged against the place, and a host's cache of
// each kept until a committed write turn names its visitor stale.

const lamplight = (store?: SproutStore) =>
  seeded(LAMPLIGHT, [[MARTA, LAMPLIT_HALL, 'Marta']], store);
const UNSEEN = ['Something here is too much to take in.'];

/** Light the lamp as Marta, and give back who the turn named stale. */
async function lit(make: MakeEngine, store: SproutStore) {
  const turn = await runCommand(store, 'w', played(make, LAMPLIGHT), {
    visit: MARTA,
    text: 'light lamp',
    seed: 1,
    mayHold: null,
    now: 0,
  });
  ok(turn.committed, 'lighting the lamp commits');
  return turn.stale;
}

export const pollCases: EngineCase[] = [
  {
    name: 'a view is the last committed state',
    proves: 'a view is rendered from the last committed state, and a poll is not logged',
    async run(make) {
      const store = await lamplight();
      const host = played(make, LAMPLIGHT);
      equal(
        (await runView(store, 'w', host, MARTA, 0)).view.description,
        ['The hall is dim.'],
        'the view before',
      );
      await lit(make, store);
      const polled = await runView(store, 'w', host, MARTA, 0);
      equal(polled.fault, null, 'its fault');
      equal(polled.view.description, ['The hall is bright.'], 'the view after');
      equal(
        (await readLog(store, 'w', { limit: 10 })).map((one) => one.entry.kind),
        ['command'],
        'what is logged',
      );
    },
  },
  {
    name: 'a view that runs out',
    proves:
      'a view whose poll runs out carries the world’s `unseen` and its fault, logged once against the place at the instant polled',
    async run(make) {
      const store = await lamplight();
      const tight = played(make, LAMPLIGHT, { budgets: { pollSteps: 1 } });
      const polled = await runView(store, 'w', tight, MARTA, 7);
      equal(polled.view.description, UNSEEN, 'its description');
      match(polled.fault, { name: 'BudgetExhausted', object: LAMPLIT_HALL }, 'its fault');
      equal(
        await readLog(store, 'w', { limit: 10 }),
        [
          {
            seq: 1,
            entry: {
              kind: 'poll-fault',
              level: 'error',
              now: 7,
              fault: {
                level: 'error',
                name: 'BudgetExhausted',
                detail: polled.fault?.detail,
                object: LAMPLIT_HALL,
                engine: false,
                extension: null,
              },
            },
          },
        ],
        'what is logged',
      );
      const cache = new ViewCache();
      await cache.view(store, 'w', tight, MARTA, 8);
      await cache.view(store, 'w', tight, MARTA, 9);
      equal(
        (await readLog(store, 'w', { limit: 10 })).length,
        2,
        'the entries once the cache hands one back',
      );
    },
  },
  {
    name: 'a cache keeps a view',
    proves:
      'a cache keeps a view until a committed write turn names its visitor stale, and not one whose poll began before',
    async run(make) {
      const store = await lamplight();
      const host = played(make, LAMPLIGHT);
      const cache = new ViewCache();
      const first = await cache.view(store, 'w', host, MARTA, 0);
      const stale = await lit(make, store);
      equal(stale, [MARTA], 'who lighting the lamp made stale');
      ok(
        (await cache.view(store, 'w', host, MARTA, 0)) === first,
        'the view before the cache is told',
      );
      cache.stale('w', stale);
      const next = await cache.view(store, 'w', host, MARTA, 0);
      equal(next.view.description, ['The hall is bright.'], 'the view after');
      ok((await cache.view(store, 'w', host, MARTA, 0)) === next, 'the view kept again');
      const pending = cache.view(store, 'w', host, MARTA, 0);
      cache.stale('w', [MARTA]);
      const raced = await pending;
      ok(
        (await cache.view(store, 'w', host, MARTA, 0)) !== raced,
        'a view polled before it was named stale',
      );
    },
  },
  {
    name: 'the view in parts',
    proves:
      'a scene and each verb’s readings are the view in parts, the scene listing each verb with the phrases that type it',
    async run(make) {
      const store = await lamplight();
      const host = played(make, LAMPLIGHT);
      const { view } = await runView(store, 'w', host, MARTA, 0);
      const { scene, fault } = await runScene(store, 'w', host, MARTA, 0);
      equal(fault, null, 'the scene’s fault');
      equal(scene.description, view.description, 'the scene’s description');
      const apart = [];
      for (const { verb } of scene.verbs)
        apart.push(...(await runReadings(store, 'w', host, MARTA, verb, 0)).readings);
      equal(apart, view.readings, 'the readings, verb by verb');
      equal(
        scene.verbs.find((one) => one.verb === 'lamplight.light')?.phrases,
        ['light …'],
        'the phrases of `light`',
      );
    },
  },
  {
    name: 'parts that run out',
    proves:
      'a scene and a verb’s readings that run out are logged against the place, the readings none',
    async run(make) {
      const store = await lamplight();
      const tight = played(make, LAMPLIGHT, { budgets: { pollSteps: 1 } });
      equal((await runScene(store, 'w', tight, MARTA, 3)).scene.description, UNSEEN, 'the scene');
      match(
        await runReadings(store, 'w', tight, MARTA, 'lamplight.light', 4),
        { readings: [], fault: { name: 'BudgetExhausted', object: LAMPLIT_HALL } },
        'the readings',
      );
      equal(
        (await readLog(store, 'w', { limit: 10 })).map((one) => [
          one.entry.kind,
          'now' in one.entry ? one.entry.now : null,
        ]),
        [
          ['poll-fault', 3],
          ['poll-fault', 4],
        ],
        'what is logged',
      );
    },
  },
  {
    name: 'a cache keeps scenes and readings',
    proves:
      'a cache keeps a scene and a verb’s readings until a committed write turn names their visitor stale, as it keeps a view',
    async run(make) {
      const store = await lamplight();
      const host = played(make, LAMPLIGHT);
      const cache = new ViewCache();
      const scene = await cache.scene(store, 'w', host, MARTA, 0);
      const readings = await cache.readings(store, 'w', host, MARTA, 'lamplight.light', 0);
      equal(
        readings.readings.map((one) => one.typed),
        ['light hall', 'light lamp'],
        'the readings of `light`',
      );
      ok((await cache.scene(store, 'w', host, MARTA, 0)) === scene, 'the scene kept');
      ok(
        (await cache.readings(store, 'w', host, MARTA, 'lamplight.light', 0)) === readings,
        'the readings kept',
      );
      cache.stale('w', await lit(make, store));
      const next = await cache.scene(store, 'w', host, MARTA, 0);
      equal(next.scene.description, ['The hall is bright.'], 'the scene after');
      ok(
        (await cache.readings(store, 'w', host, MARTA, 'lamplight.light', 0)) !== readings,
        'the readings after',
      );
      const pending = cache.readings(store, 'w', host, MARTA, 'lamplight.light', 0);
      cache.stale('w', [MARTA]);
      const raced = await pending;
      ok(
        (await cache.readings(store, 'w', host, MARTA, 'lamplight.light', 0)) !== raced,
        'readings polled before they were named stale',
      );
    },
  },
  {
    name: 'readings of a verb the scene does not list',
    proves:
      'a cache answers a verb its scene does not list with no readings, polling nothing for it',
    async run(make) {
      const store = await lamplight();
      const cache = new ViewCache();
      const tight = played(make, LAMPLIGHT, { budgets: { pollSteps: 1 } });
      // The scene faults, so lists no verb, and the one fault logged is the scene's.
      equal(
        await cache.readings(store, 'w', tight, MARTA, 'lamplight.light', 0),
        { visit: MARTA, verb: 'lamplight.light', readings: [], fault: null },
        'the readings under a tight budget',
      );
      match(
        await cache.readings(store, 'w', played(make, LAMPLIGHT), MARTA, 'nowhere.juggle', 0),
        { readings: [], fault: null },
        'the readings of a verb the world has not',
      );
      equal((await readLog(store, 'w', { limit: 10 })).length, 1, 'what is logged');
    },
  },
];
