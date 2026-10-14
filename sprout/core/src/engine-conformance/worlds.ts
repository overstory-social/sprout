import {
  compileBundle,
  declaredId,
  DEFAULT_LIMITS,
  Draft,
  emitCartridge,
  initialState,
  libraryHash,
  loadCartridge,
  neededImports,
  newInstance,
  parseCommand,
  renderEffects,
  SourceFile,
  STANDARD_LIBRARY,
  storedChanges,
  visitKey,
  type CommandHost,
  type InstanceId,
  type Manifest,
  type RuntimeBudgets,
  type VisitKey,
} from '@overstory/sprout/lang';

import type { Engine } from '../engine.js';
import { memoryStore } from '../memory-store.js';
import type { StoredState } from '../records.js';
import type { SproutStore } from '../store.js';
import type { LogHost } from '../turns.js';

// The worlds the engine conformance suite runs, each compiled as a host
// publishes one and read back from its cartridge, and the stores they
// start from: written with no turn and no log, so every engine is handed
// the same stored state. A declared object no turn has written is not
// stored, and reads as its declaration says.

/** One world as an engine is made for it: the host's terms, and its cartridge. */
export interface EngineWorld {
  readonly host: CommandHost;
  readonly cartridge: Uint8Array;
}

/** How a host makes its engine for one world. */
export type MakeEngine = (world: EngineWorld) => Engine;

/** One case of the suite: what it proves, in the words a host's test runner prints, run against an engine. */
export interface EngineCase {
  readonly name: string;
  readonly proves: string;
  run(make: MakeEngine): Promise<void>;
}

/** `files` compiled as the world `name`, under the spec's limits, with the imports each file needs. */
function compiled(name: string, files: Readonly<Record<string, string>>): EngineWorld {
  const manifest: Manifest = {
    name,
    namespace: name,
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
    files: Object.keys(files),
  };
  const sources = Object.entries(files).map(([file, text]) => new SourceFile(file, text));
  const needed = neededImports(sources, [STANDARD_LIBRARY]);
  const { bundle } = compileBundle(
    {
      manifestFile: new SourceFile('sprout.json', JSON.stringify(manifest)),
      manifest,
      files: sources.map((file) => {
        const lines = needed.get(file.name);
        return lines === undefined
          ? file
          : new SourceFile(file.name, `${file.text}${lines.join('\n')}\n`);
      }),
      libraries: [STANDARD_LIBRARY],
    },
    { mode: 'publish', limits: DEFAULT_LIMITS },
  );
  if (bundle === null) throw new Error(`the ${name} does not compile`);
  const cartridge = emitCartridge(bundle);
  const catalogue = loadCartridge(cartridge, { caps: DEFAULT_LIMITS.caps });
  return {
    cartridge,
    host: {
      catalogue,
      budgets: DEFAULT_LIMITS.budgets,
      parse: parseCommand,
      render: renderEffects,
    },
  };
}

/**
 * The tally: a counter and a gauge in a hall. Bumping one counts, and
 * smashing it counts and then overflows, so the turn faults after it
 * wrote; resting it asks for a wake a minute on, and a wake sets it to
 * the seconds it waited, which it holds only up to 99. Its intents bump
 * twice, and bump, smash and bump.
 */
export const TALLY = compiled('tally', {
  'tally.sprout': `world tally is sprout.World {
  visitors are Person
  visitors arrive at hall
  object hall is sprout.Place {
    object counter is Counter
    object gauge is Counter
  }
}
verb bump  { role target  "bump [target]" }
verb smash { role target  "smash [target]" }
verb rest  { role target  "rest [target]" }
intent twice { "twice [y]"  do bump (target: y) then bump (target: y) }
intent wreck { "wreck [y]"  do bump (target: y) then smash (target: y) then bump (target: y) }
`,
  'person.sprout': 'kind Person is sprout.Visitor { }\n',
  'counter.sprout': `kind Counter {
  :n 0 min 0 max 99
  as target for bump  { do { self.adjust(:n, 1)  say "Click." } }
  as target for smash { do { self.adjust(:n, 1)  if (2147483647 + 1 > 0) { say "Crunch." } } }
  as target for rest  { do { wake in 1 minutes  say "Resting." } }
  on :woke (elapsed) { self.set(:n, elapsed) }
}
`,
});
export const HALL = declaredId('tally', ['hall']);
export const COUNTER = declaredId('tally', ['hall', 'counter']);
export const GAUGE = declaredId('tally', ['hall', 'gauge']);

/** The lamplight: a hall that says whether its lamp is lit, and lighting the lamp lights it. */
export const LAMPLIGHT = compiled('lamplight', {
  'lamplight.sprout': `world lamplight is sprout.World {
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
});
export const LAMPLIT_HALL = declaredId('lamplight', ['hall']);

/** The heath: two moors that keep the gap each tick hands them, which holds at most 1,000 seconds, and a cellar. */
export const HEATH = compiled('heath', {
  'heath.sprout': `world heath is sprout.World {
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
});
export const NORTH = declaredId('heath', ['north']);
export const SOUTH = declaredId('heath', ['south']);
export const CELLAR = declaredId('heath', ['cellar']);

/** The stair: a cellar that faults whatever leaves it, since its `:left` adds past the end of the integers. */
export const STAIR = compiled('stair', {
  'stair.sprout': `world stair is sprout.World {
  visitors are Person
  visitors arrive at cellar
  object cellar is Cellar { }
}
`,
  'person.sprout': 'kind Person is sprout.Visitor { }\n',
  'cellar.sprout': `kind Cellar is sprout.Place {
  on :left (item, to) {
    if (2147483647 + 1 > 0) { tell "Nobody hears this." }
  }
}
`,
});
export const STAIR_CELLAR = declaredId('stair', ['cellar']);

export const MARTA = visitKey('v-marta');
export const INES = visitKey('v-ines');
export const PAT = visitKey('v-pat');

/** The host a case runs `world` under, its budgets changed by `budgets`, with the engine `make` makes for it. */
export function played(
  make: MakeEngine,
  world: EngineWorld,
  change: { readonly budgets?: Partial<RuntimeBudgets>; readonly logDepth?: 'play' | 'debug' } = {},
): CommandHost & LogHost {
  const host = { ...world.host, budgets: { ...world.host.budgets, ...change.budgets } };
  return {
    ...host,
    ...(change.logDepth === undefined ? {} : { logDepth: change.logDepth }),
    engine: make({ host, cartridge: world.cartridge }),
  };
}

/** A store holding `world` as `microworldId`, each visit standing where it says under its nickname. */
export async function seeded(
  world: EngineWorld,
  standing: readonly (readonly [VisitKey, InstanceId, string])[],
  store: SproutStore = memoryStore(),
  microworldId = 'w',
): Promise<SproutStore> {
  const { catalogue } = world.host;
  const draft = new Draft(initialState(catalogue));
  for (const [visit, where, nickname] of standing) {
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
    draft.putVisitor({
      visit,
      nickname,
      instance: id,
      lastPlace: where,
      referents: [],
      lastReading: null,
    });
  }
  const { state, changes } = draft.commit();
  await store.transaction(microworldId, (tx) => tx.putState(storedChanges(state, changes)));
  return store;
}

/** The stored state of `microworldId`, with no lock. */
export function storedIn(store: SproutStore, microworldId = 'w'): Promise<StoredState> {
  return store.read(microworldId, (tx) => tx.state());
}

/** The stored value of `property` on `id`; `fallback`, its declared value, where no turn has written the object. */
export async function propertyOf(
  store: SproutStore,
  id: InstanceId,
  property: string,
  fallback: unknown,
): Promise<unknown> {
  const record = (await storedIn(store)).instances.find((one) => one.id === id);
  return record === undefined ? fallback : record.properties[property]?.value;
}

/** The tally's counter, or what `id` names, as the store holds it now. */
export const countOf = (store: SproutStore, id: InstanceId = COUNTER) =>
  propertyOf(store, id, 'n', 0);
