import { describe, expect, it } from 'vitest';

import {
  catalogueOf,
  compileBundle,
  declaredId,
  DEFAULT_LIMITS,
  Draft,
  initialState,
  libraryHash,
  newInstance,
  SourceFile,
  STANDARD_LIBRARY,
  storedChanges,
  visitKey,
  type InstanceId,
  type Manifest,
  type TurnHost,
  type VisitKey,
} from '@overstory/sprout/lang';

import { memoryStore } from './memory-store.js';
import type { SproutStore } from './store.js';
import { Ticker, type Ticking } from './ticks.js';

// Two moors that keep the gap each tick hands them, which holds at most
// 1,000 seconds, and a cellar nobody stands in; one kind per file.
const FILES: Record<string, string> = {
  'world.sprout': `world heath is sprout.World {
  visitors are Person
  visitors arrive at north
  object north is Moor { }
  object south is Moor { }
  object cellar is Moor { }
}
`,
  'person.sprout': 'kind Person is sprout.Visitor { }\n',
  'moor.sprout': `kind Moor is sprout.Place {
  :gap 0 min 0 max 1000
  :ticks 0 min 0 max 99
  on :tick (elapsed) {
    self.set(:gap, elapsed)
    self.adjust(:ticks, 1)
  }
}
`,
};

const MANIFEST: Manifest = {
  name: 'heath',
  namespace: 'heath',
  version: '0.1.0',
  author: 'Eric Eslinger',
  license: 'MIT',
  level: 1,
  extensions: [],
  libraries: [
    {
      name: STANDARD_LIBRARY.name,
      version: STANDARD_LIBRARY.version,
      sha: libraryHash(STANDARD_LIBRARY),
    },
  ],
  files: Object.keys(FILES),
};

const { bundle } = compileBundle(
  {
    manifestFile: new SourceFile('sprout.json', JSON.stringify(MANIFEST)),
    manifest: MANIFEST,
    files: Object.entries(FILES).map(([name, text]) => new SourceFile(name, text)),
    libraries: [STANDARD_LIBRARY],
  },
  { mode: 'publish', limits: DEFAULT_LIMITS },
);
if (bundle === null) throw new Error('the heath does not compile');
const catalogue = catalogueOf(bundle, DEFAULT_LIMITS.caps);
const host: TurnHost = { catalogue, budgets: DEFAULT_LIMITS.budgets };
const NORTH = declaredId('heath', ['north']);
const SOUTH = declaredId('heath', ['south']);
const CELLAR = declaredId('heath', ['cellar']);

/** `store` holding the heath as `microworldId`, with each visit standing where it says. */
async function seeded(
  standing: readonly [VisitKey, InstanceId][],
  store: SproutStore = memoryStore(),
  microworldId = 'w',
): Promise<SproutStore> {
  const draft = new Draft(initialState(catalogue));
  for (const [visit, where] of standing) {
    const id = draft.mint();
    draft.add(
      newInstance(
        id,
        { from: 'visitor' },
        catalogue.visitorKind!,
        where,
        draft.nextSerial(),
        catalogue.caps,
      ),
    );
    draft.putVisitor({ visit, nickname: visit, instance: id, lastPlace: where });
  }
  const { state, changes } = draft.commit();
  await store.transaction(microworldId, (tx) => tx.putState(storedChanges(state, changes)));
  return store;
}

const TWO: [VisitKey, InstanceId][] = [
  [visitKey('v-marta'), NORTH],
  [visitKey('v-ines'), SOUTH],
];
const seedOf = (place: InstanceId) => ({ seed: place.length, mayHold: null });

/** A place's stored record, its last tick and its gap; null where nothing has written it. */
async function recordOf(store: SproutStore, id: InstanceId) {
  const stored = await store.read('w', (tx) => tx.state());
  const record = stored.instances.find((instance) => instance.id === id);
  if (record === undefined) return null;
  return { lastTick: record.lastTick, gap: record.properties['gap']?.value };
}

const elapsedOf = (ticking: Ticking): number | 'skipped' | 'not committed' => {
  if ('skipped' in ticking) return 'skipped';
  return ticking.turn.committed ? ticking.turn.value.elapsed : 'not committed';
};

describe('a round of ticks', () => {
  it('runs one tick turn for each place a visitor stands in, and writes each', async () => {
    const store = await seeded(TWO);
    const ticker = new Ticker();
    const asked: InstanceId[] = [];
    const first = await ticker.round(store, 'w', host, 100, (place) => {
      asked.push(place);
      return seedOf(place);
    });
    expect(first.map((ticking) => ticking.place)).toEqual([NORTH, SOUTH]);
    expect(asked).toEqual([NORTH, SOUTH]);
    expect(first.map(elapsedOf)).toEqual([0, 0]);
    const second = await ticker.round(store, 'w', host, 130, seedOf);
    expect(second.map(elapsedOf)).toEqual([30, 30]);
    expect(await recordOf(store, NORTH)).toEqual({ lastTick: 130, gap: 30 });
    // Nobody stands in the cellar, so it is never ticked, nor written.
    expect(await recordOf(store, CELLAR)).toBeNull();
  });

  it('ticks nothing in a world nobody stands in', async () => {
    const store = await seeded([]);
    expect(await new Ticker().round(store, 'w', host, 5, seedOf)).toEqual([]);
  });

  it('skips a place whose last tick has not run, rather than queue another, and folds the gap in', async () => {
    const store = await seeded(TWO);
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
    const skipped = await ticker.round(store, 'w', host, 120, seedOf);
    expect(skipped.map(elapsedOf)).toEqual(['skipped', 'skipped']);
    release();
    await held;
    expect((await waiting).map(elapsedOf)).toEqual([10, 10]);
    // Nothing was queued behind it: the next tick covers everything since 110.
    const next = await ticker.round(store, 'w', host, 150, seedOf);
    expect(next.map(elapsedOf)).toEqual([40, 40]);
  });

  it('drops a tick that faults, writing nothing, so the next one covers the interval', async () => {
    const store = await seeded(TWO);
    const ticker = new Ticker();
    await ticker.round(store, 'w', host, 100, seedOf);
    const dropped = await ticker.round(store, 'w', host, 2000, seedOf);
    expect(dropped.map(elapsedOf)).toEqual(['not committed', 'not committed']);
    expect(dropped[0]).toMatchObject({ turn: { fault: { name: 'ValueOutOfRange' } } });
    expect(await recordOf(store, NORTH)).toEqual({ lastTick: 100, gap: 0 });
  });

  it('keeps one world’s waiting ticks apart from another’s', async () => {
    const store = await seeded(TWO, await seeded(TWO), 'v');
    const ticker = new Ticker();
    const both = await Promise.all([
      ticker.round(store, 'w', host, 100, seedOf),
      ticker.round(store, 'v', host, 100, seedOf),
    ]);
    expect(both.map((round) => round.map(elapsedOf))).toEqual([
      [0, 0],
      [0, 0],
    ]);
  });
});
