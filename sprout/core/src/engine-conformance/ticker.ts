import type { InstanceId } from '@overstory/sprout/lang';

import type { SproutStore } from '../store.js';
import { Ticker, type Ticking } from '../ticks.js';
import { equal, match } from './check.js';
import {
  CELLAR,
  HEATH,
  INES,
  MARTA,
  NORTH,
  played,
  propertyOf,
  seeded,
  SOUTH,
  storedIn,
  type EngineCase,
} from './worlds.js';

// The suite's rounds of ticks (the spec's Time › Ticks): one tick turn
// for each place a visitor stands in, never two waiting for one place,
// over the heath, whose moors keep the gap each tick hands them.

const both = (store?: SproutStore, microworldId?: string) =>
  seeded(
    HEATH,
    [
      [MARTA, NORTH, 'Marta'],
      [INES, SOUTH, 'Ines'],
    ],
    store,
    microworldId,
  );

const seedOf = (place: InstanceId) => ({ seed: place.length, mayHold: null });

/** What each place's part in a round came to: skipped, or whether its tick committed. */
const cameTo = (round: readonly Ticking[]) =>
  round.map((one) =>
    'skipped' in one ? 'skipped' : one.turn.committed ? 'committed' : 'not committed',
  );

/** The gap each moor holds now. */
const gaps = async (store: SproutStore) => [
  await propertyOf(store, NORTH, 'gap', 0),
  await propertyOf(store, SOUTH, 'gap', 0),
];

export const tickerCases: EngineCase[] = [
  {
    name: 'a round ticks each occupied place',
    proves:
      'a round runs one tick turn for each place a visitor stands in, in code-unit order, and writes each, never a place nobody stands in',
    async run(make) {
      const store = await both();
      const host = played(make, HEATH);
      const ticker = new Ticker();
      const asked: InstanceId[] = [];
      const first = await ticker.round(
        store,
        'w',
        host,
        100,
        (place) => (asked.push(place), seedOf(place)),
      );
      equal(
        first.map((one) => one.place),
        [NORTH, SOUTH],
        'the places ticked',
      );
      equal(asked, [NORTH, SOUTH], 'the places asked for their seeds');
      equal(cameTo(first), ['committed', 'committed'], 'the first round');
      equal(await gaps(store), [0, 0], 'the gaps after the first round');
      await ticker.round(store, 'w', host, 130, seedOf);
      equal(await gaps(store), [30, 30], 'the gaps after the second');
      const north = (await storedIn(store)).instances.find((one) => one.id === NORTH);
      equal(north?.lastTick, 130, 'the north moor’s last tick');
      equal(
        (await storedIn(store)).instances.find((one) => one.id === CELLAR),
        undefined,
        'the cellar',
      );
      equal(
        await new Ticker().round(await seeded(HEATH, []), 'w', host, 5, seedOf),
        [],
        'a round of an empty world',
      );
    },
  },
  {
    name: 'a round skips a place still waiting',
    proves:
      'a place whose last tick has not run is skipped rather than queued, and the next tick folds the gap in',
    async run(make) {
      const store = await both();
      const host = played(make, HEATH);
      const ticker = new Ticker();
      await ticker.round(store, 'w', host, 100, seedOf);
      // A write turn holds the world's lock, so the next round's ticks wait on it.
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let entered!: () => void;
      const inside = new Promise<void>((resolve) => (entered = resolve));
      const held = store.transaction('w', async () => {
        entered();
        await gate;
      });
      await inside;
      const waiting = ticker.round(store, 'w', host, 110, seedOf);
      // Let the waiting round read the places and ask for its ticks.
      await new Promise((resolve) => setTimeout(resolve, 0));
      equal(
        cameTo(await ticker.round(store, 'w', host, 120, seedOf)),
        ['skipped', 'skipped'],
        'the round while they wait',
      );
      release();
      await held;
      equal(cameTo(await waiting), ['committed', 'committed'], 'the waiting round');
      equal(await gaps(store), [10, 10], 'the gaps it wrote');
      await ticker.round(store, 'w', host, 150, seedOf);
      equal(
        await gaps(store),
        [40, 40],
        'the gaps of the round after, which covers everything since',
      );
    },
  },
  {
    name: 'a round drops a tick that faults',
    proves: 'a tick that faults is dropped, writing nothing, so the next covers the interval',
    async run(make) {
      const store = await both();
      const host = played(make, HEATH);
      const ticker = new Ticker();
      await ticker.round(store, 'w', host, 100, seedOf);
      const dropped = await ticker.round(store, 'w', host, 2000, seedOf);
      equal(cameTo(dropped), ['not committed', 'not committed'], 'the round');
      match(dropped[0], { turn: { fault: { name: 'ValueOutOfRange' } } }, 'the north moor’s tick');
      const north = (await storedIn(store)).instances.find((one) => one.id === NORTH);
      equal([north?.lastTick, north?.properties['gap']?.value], [100, 0], 'the north moor');
    },
  },
  {
    name: 'rounds of two worlds',
    proves: 'one world’s waiting ticks are kept apart from another’s',
    async run(make) {
      const store = await both(await both(), 'v');
      const host = played(make, HEATH);
      const ticker = new Ticker();
      const rounds = await Promise.all([
        ticker.round(store, 'w', host, 100, seedOf),
        ticker.round(store, 'v', host, 100, seedOf),
      ]);
      equal(
        rounds.map(cameTo),
        [
          ['committed', 'committed'],
          ['committed', 'committed'],
        ],
        'the rounds',
      );
    },
  },
];
