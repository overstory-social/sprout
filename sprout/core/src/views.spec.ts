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
  parseCommand,
  renderEffects,
  SourceFile,
  STANDARD_LIBRARY,
  storedChanges,
  visitKey,
  type CommandHost,
  type Manifest,
} from '@overstory/sprout/lang';

import { memoryStore } from './memory-store.js';
import type { SproutStore } from './store.js';
import { runCommand } from './turns.js';
import { readLog } from './log/entry.js';
import { runView, ViewCache } from './views.js';

// A hall with a lamp in it, one kind per file: the hall says whether the
// lamp is lit, and lighting it lights it.
const FILES: Record<string, string> = {
  'world.sprout': `world lamplight is sprout.World {
  visitors are Person
  visitors arrive at hall
  object hall is sprout.Place {
    describe {
      if (lamp.get(:lit)) { text "The hall is bright." } else { text "The hall is dim." }
    }
    object lamp is Lamp
  }
}
verb light { role target  "light [target]" }
`,
  'person.sprout': 'kind Person is sprout.Visitor { }\n',
  'lamp.sprout': `kind Lamp {
  :lit false
  as target for light { do { self.set(:lit, true)  say "It catches." } }
}
`,
};

const MANIFEST: Manifest = {
  name: 'lamplight',
  namespace: 'lamplight',
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
if (bundle === null) throw new Error('the lamplight does not compile');
const catalogue = catalogueOf(bundle, DEFAULT_LIMITS.caps);
const HALL = declaredId('lamplight', ['hall']);
const MARTA = visitKey('v-marta');
const host: CommandHost = {
  catalogue,
  budgets: DEFAULT_LIMITS.budgets,
  parse: parseCommand,
  render: renderEffects,
};
const light = { visit: MARTA, text: 'light lamp', seed: 1, mayHold: null, now: 0 };

/** A store holding the lamplight with Marta standing in the hall. */
async function seeded(store: SproutStore = memoryStore()): Promise<SproutStore> {
  const draft = new Draft(initialState(catalogue));
  const marta = draft.mint();
  draft.add(
    newInstance(
      marta,
      { from: 'visitor' },
      catalogue.visitorKind!,
      HALL,
      draft.nextSerial(),
      catalogue.caps,
    ),
  );
  draft.putVisitor({ visit: MARTA, nickname: 'Marta', instance: marta, lastPlace: HALL });
  const { state, changes } = draft.commit();
  await store.transaction('w', (tx) => tx.putState(storedChanges(state, changes)));
  return store;
}

/** Light the lamp as Marta, and give back who the turn named stale. */
async function lit(store: SproutStore) {
  const turn = await runCommand(store, 'w', host, light);
  if (!turn.committed) throw new Error(turn.fault.detail);
  return turn.stale;
}

describe('a view polled against a store', () => {
  it('is rendered from the last committed state', async () => {
    const store = await seeded();
    expect((await runView(store, 'w', host, MARTA, 0)).view.description).toEqual([
      'The hall is dim.',
    ]);
    await lit(store);
    const polled = await runView(store, 'w', host, MARTA, 0);
    expect(polled.fault).toBeNull();
    expect(polled.view.description).toEqual(['The hall is bright.']);
    // The command is logged; neither poll is.
    expect((await readLog(store, 'w', { limit: 10 })).map((one) => one.entry.kind)).toEqual([
      'command',
    ]);
  });

  it('carries the world’s `unseen` and its fault where the poll runs out', async () => {
    const store = await seeded();
    const tight = { ...host, budgets: { ...host.budgets, pollSteps: 1 } };
    const polled = await runView(store, 'w', tight, MARTA, 7);
    expect(polled.view.description).toEqual(['Something here is too much to take in.']);
    expect(polled.fault).toMatchObject({ name: 'BudgetExhausted', object: HALL });
    // Logged as an authoring fault against the place, at the instant the host polled at.
    expect(await readLog(store, 'w', { limit: 10 })).toEqual([
      {
        seq: 1,
        entry: {
          kind: 'poll-fault',
          now: 7,
          fault: {
            name: 'BudgetExhausted',
            detail: polled.fault!.detail,
            object: HALL,
            engine: false,
          },
        },
      },
    ]);
  });

  it('logs a faulted view once, however often the cache hands it back', async () => {
    const store = await seeded();
    const tight = { ...host, budgets: { ...host.budgets, pollSteps: 1 } };
    const cache = new ViewCache();
    await cache.view(store, 'w', tight, MARTA, 0);
    await cache.view(store, 'w', tight, MARTA, 1);
    expect(await readLog(store, 'w', { limit: 10 })).toHaveLength(1);
  });
});

describe('a cache of views', () => {
  it('keeps a view until a committed write turn names its visitor stale', async () => {
    const store = await seeded();
    const cache = new ViewCache();
    const first = await cache.view(store, 'w', host, MARTA, 0);
    const stale = await lit(store);
    expect(stale).toEqual([MARTA]);
    // Nobody has told the cache yet, so it still holds the view it made.
    expect(await cache.view(store, 'w', host, MARTA, 0)).toBe(first);
    cache.stale('w', stale);
    const next = await cache.view(store, 'w', host, MARTA, 0);
    expect(next.view.description).toEqual(['The hall is bright.']);
    expect(await cache.view(store, 'w', host, MARTA, 0)).toBe(next);
  });

  it('does not keep a view whose poll began before its visitor was named stale', async () => {
    const store = await seeded();
    const cache = new ViewCache();
    const pending = cache.view(store, 'w', host, MARTA, 0);
    cache.stale('w', [MARTA]);
    const raced = await pending;
    expect(await cache.view(store, 'w', host, MARTA, 0)).not.toBe(raced);
  });

  it('keeps each world’s views apart, and drops them all when a world is cleared', async () => {
    const store = await seeded();
    const cache = new ViewCache();
    const kept = await cache.view(store, 'w', host, MARTA, 0);
    cache.stale('elsewhere', [MARTA]);
    expect(await cache.view(store, 'w', host, MARTA, 0)).toBe(kept);
    cache.clear('w');
    const pending = cache.view(store, 'w', host, MARTA, 0);
    cache.clear('w');
    const raced = await pending;
    expect(raced).not.toBe(kept);
    expect(await cache.view(store, 'w', host, MARTA, 0)).not.toBe(raced);
  });
});
