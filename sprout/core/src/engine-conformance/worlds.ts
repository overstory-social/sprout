import {
  compileBundle,
  declaredId,
  DEFAULT_LIMITS,
  emitCartridge,
  libraryHash,
  loadCartridge,
  mintedId,
  neededImports,
  SourceFile,
  STANDARD_LIBRARY,
  visitKey,
  type InstanceId,
  type Manifest,
  type RuntimeBudgets,
  type StoredInstance,
  type StoredVisitor,
  type VisitKey,
} from '@overstory/sprout/lang';

import type { Engine, WorldHost } from '../engine.js';
import { memoryStore } from '../memory-store.js';
import type { StoredState } from '../records.js';
import type { SproutStore } from '../store.js';
import type { LogHost } from '../turns.js';

// The worlds the engine conformance suite runs, each compiled as a host
// publishes one and read back from its cartridge, and the stores they
// start from: stored records written with no turn and no log, so every
// engine is handed the same stored state and nothing runs the world to
// make it. A declared object no turn has written is not stored, and reads
// as its declaration says.

/** One world as an engine is made for it: the host's terms, and its cartridge. */
export interface EngineWorld {
  readonly host: WorldHost;
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

/** `files` compiled as the world `name` at `version`, under the spec's limits, with the imports each file needs. */
function compiled(
  name: string,
  files: Readonly<Record<string, string>>,
  version = '0.1.0',
): EngineWorld {
  const manifest: Manifest = {
    name,
    namespace: name,
    version,
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

/**
 * The porch: a bench to doze on, which asks for two hours to pass, and a
 * gate that passes nothing.
 */
export const PORCH = compiled('porch', {
  'porch.sprout': `world porch is sprout.World {
  visitors are Person
  visitors arrive at steps
  object steps is sprout.Place {
    object bench is Bench
  }
}
verb doze { role target  "doze on [target]" }
`,
  'person.sprout': 'kind Person is sprout.Visitor { }\n',
  'bench.sprout': `kind Bench {
  as target for doze { do { pass 2 hours  say "You doze." } }
}
`,
});
export const STEPS = declaredId('porch', ['steps']);

/**
 * The lamplight: a hall that says whether its lamp is lit, and lighting
 * the lamp lights it. The world writes its own `acted`.
 */
export const LAMPLIGHT = compiled('lamplight', {
  'lamplight.sprout': `world lamplight is sprout.World {
  visitors are Person
  visitors arrive at hall
  passage acted { {actor} has a go at "{reading}". }
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

/**
 * The lamplight's next build, 0.1.1, which keeps its saves: the lamp can
 * be polished too, which it is not until someone does, and an attic is
 * built above the hall.
 */
export const LAMPLIGHT_LATER = compiled(
  'lamplight',
  {
    'lamplight.sprout': `world lamplight is sprout.World {
  visitors are Person
  visitors arrive at hall
  passage acted { {actor} has a go at "{reading}". }
  object hall is sprout.Place {
    grammar { exit up "to the attic" -> attic }
    describe {
      if (lamp.get(:lit)) { text "The hall is bright." } else { text "The hall is dim." }
    }
    object lamp is Lamp
  }
  object attic is sprout.Place { }
}
verb light { role target  "light [target]" }
verb polish { role target  "polish [target]" }
`,
    'person.sprout': 'kind Person is sprout.Visitor { }\n',
    'lamp.sprout': `kind Lamp {
  :lit false
  :polished false
  as target for light { do { self.set(:lit, true)  say "It catches." } }
  as target for polish { do { self.set(:polished, true)  say "It shines." } }
}
`,
  },
  '0.1.1',
);
export const LAMPLIT_LAMP = declaredId('lamplight', ['hall', 'lamp']);
export const LAMPLIT_ATTIC = declaredId('lamplight', ['attic']);

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

/**
 * The belfry: ringing the bell sends its clapper `:struck`, whose handler
 * swings it, and a hook on the swing answers that; the chest's `permit`
 * refuses to be opened; and the tower, where visitors arrive, answers
 * whatever enters it.
 */
export const BELFRY = compiled('belfry', {
  'belfry.sprout': `world belfry is sprout.World {
  visitors are Person
  visitors arrive at tower
  object tower is Tower {
    object bell is Bell
    object chest is Chest
  }
}
message :struck
verb ring { role target  "ring [target]" }
verb open { role target  "open [target]" }
`,
  'person.sprout': 'kind Person is sprout.Visitor { }\n',
  'tower.sprout': 'kind Tower is sprout.Place {\n  on :entered (thing, from) { }\n}\n',
  'bell.sprout': `kind Bell {
  contains
  as target for ring { do { send clapper :struck  say "Dong." } }
  object clapper is Clapper
}
`,
  'clapper.sprout': `kind Clapper {
  :swings 0 min 0 max 99
  on :struck (from) { self.adjust(:swings, 1) }
  changed :swings (was) { }
}
`,
  'chest.sprout': `kind Chest {
  as target for open {
    permit { refuse "It is locked." }
    do { say "It opens." }
  }
}
`,
});
export const TOWER = declaredId('belfry', ['tower']);
/** Where no place stands in the belfry: a visitor seeded there is displaced by their next command. */
export const BELFRY_GONE = declaredId('belfry', ['gone']);

/**
 * The dock: inflating the pile moves its boat out to the dock and destroys
 * the pile, and the label declared inside the boat goes with the boat.
 */
export const DOCK = compiled('dock', {
  'dock.sprout': `world dock is sprout.World {
  visitors are Person
  visitors arrive at quay
  object quay is sprout.Place {
    object pile is Pile {
      object boat is sprout.Container {
        object label is Label
      }
    }
  }
}
verb inflate { role target  "inflate [target]" }
verb read    { role target  "read [target]" }
`,
  'person.sprout': 'kind Person is sprout.Visitor { }\n',
  'pile.sprout': `kind Pile is sprout.Container {
  as target for inflate { do { move quay.pile.boat to quay  destroy self  say "It swells into a boat." } }
}
`,
  'label.sprout': `kind Label {
  as target for read { do { say "Frobozz." } }
}
`,
});
export const QUAY = declaredId('dock', ['quay']);
export const LABEL = declaredId('dock', ['quay', 'pile', 'boat', 'label']);

/**
 * The chapel: a candle that, lit, asks to be woken a minute on and tells
 * whoever hears it that it burns down each time it wakes, and asks again;
 * and a tin to carry it in.
 */
export const CHAPEL = compiled('chapel', {
  'chapel.sprout': `world chapel is sprout.World {
  visitors are Person
  visitors arrive at nave
  object nave is sprout.Place {
    object candle is Candle
    object tin is sprout.Container { grammar { name "tin" } }
  }
}
verb light { role target  "light [target]" }
`,
  'person.sprout': 'kind Person is sprout.Visitor { }\n',
  'candle.sprout': `kind Candle {
  grammar { name "candle" }
  as target for light { do { wake in 1 minutes  say "The wick catches." } }
  on :woke (elapsed) { tell "The candle grows shorter."  wake in 1 minutes }
}
`,
});
export const NAVE = declaredId('chapel', ['nave']);
export const CANDLE = declaredId('chapel', ['nave', 'candle']);

/**
 * The yard: a porter who carries 5 by `:size`, beside a stone of 9 and a
 * pebble of 1, so the stone is too heavy for them and the pebble is not.
 */
export const YARD = compiled('yard', {
  'yard.sprout': `world yard is sprout.World {
  visitors are Porter
  visitors arrive at court
  object court is sprout.Place {
    object stone is Load { :size 9 }
    object pebble is Load { :size 1 }
  }
}
`,
  'porter.sprout': 'kind Porter is sprout.Visitor {\n  capacity 5 by :size\n}\n',
  'load.sprout': 'kind Load {\n  :size 0 min 0 max 99\n}\n',
});
export const COURT = declaredId('yard', ['court']);
export const STONE = declaredId('yard', ['court', 'stone']);
export const PEBBLE = declaredId('yard', ['court', 'pebble']);

/**
 * The hideout: a thief in the hall who is unseen, and a bell whose ringing
 * sends him into the vault, where he stays unseen.
 */
export const HIDEOUT = compiled('hideout', {
  'hideout.sprout': `world hideout is sprout.World {
  visitors are Person
  visitors arrive at hall
  object hall is sprout.Place {
    grammar { exit north "north to the vault" -> vault }
    object bell is Bell {
      as target for ring { do { say "The bell clangs."  send thief :startled } }
    }
    object thief is Thief
  }
  object vault is sprout.Place {
    grammar { exit south "south to the hall" -> hall }
  }
}
message :startled
verb ring { role target  "ring [target]" }
kind Bell { grammar { name "bell" } }
kind Thief is sprout.Actor {
  grammar { name "thief" }
  :unseen true
  on :startled { move self to vault }
}
`,
  'person.sprout': 'kind Person is sprout.Visitor { }\n',
});
export const HIDEOUT_HALL = declaredId('hideout', ['hall']);
export const HIDEOUT_VAULT = declaredId('hideout', ['vault']);
export const THIEF = declaredId('hideout', ['hall', 'thief']);

/**
 * The belfry: a bell that hums after every command of whoever carries it,
 * a hall that echoes after every command made in it, and a world that
 * counts them (the spec's Verbs › After a command).
 */
export const BELFRY_FOLLOWS = compiled('followed', {
  'followed.sprout': `world followed is sprout.World {
  visitors are Person
  visitors arrive at hall
  :commands 0
  after command { self.adjust(:commands, 1) }
  object hall is Hall {
    grammar { exit north "north" refuse "The door is barred." }
    object bell is Bell
  }
}
`,
  'person.sprout': 'kind Person is sprout.Visitor { }\n',
  'hall.sprout': `kind Hall is sprout.Place {
  after command {
    if (bound way) { tell actor "The bar rattles." } else { tell actor "The hall echoes." }
  }
}
`,
  'bell.sprout': `kind Bell {
  grammar { name "bell" }
  after command { say "The bell hums." }
}
`,
});
export const FOLLOWED = declaredId('followed', []);
export const FOLLOWED_HALL = declaredId('followed', ['hall']);
export const FOLLOWED_BELL = declaredId('followed', ['hall', 'bell']);

/**
 * The belfry again, where no declared kind writes `after command`: the
 * bell's own body, the hall's and the world's write it, and they follow a
 * command as a kind's would (the spec's Verbs › After a command).
 */
export const BELFRY_OWN_FOLLOWS = compiled('own_followed', {
  'own_followed.sprout': `world own_followed is sprout.World {
  visitors are Person
  visitors arrive at hall
  :commands 0
  after command { self.adjust(:commands, 1) }
  object hall is sprout.Place {
    after command { tell actor "The hall echoes." }
    object bell is Bell {
      after command { say "The bell hums." }
    }
  }
}
`,
  'person.sprout': 'kind Person is sprout.Visitor { }\n',
  'bell.sprout': `kind Bell {
  grammar { name "bell" }
}
`,
});
export const OWN_FOLLOWED = declaredId('own_followed', []);
export const OWN_FOLLOWED_HALL = declaredId('own_followed', ['hall']);
export const OWN_FOLLOWED_BELL = declaredId('own_followed', ['hall', 'bell']);

export const MARTA = visitKey('v-marta');
export const INES = visitKey('v-ines');
export const PAT = visitKey('v-pat');

/** The host a case runs `world` under, its budgets changed by `budgets`, with the engine `make` makes for it. */
export function played(
  make: MakeEngine,
  world: EngineWorld,
  change: { readonly budgets?: Partial<RuntimeBudgets>; readonly logDepth?: 'play' | 'debug' } = {},
): LogHost {
  const host = { ...world.host, budgets: { ...world.host.budgets, ...change.budgets } };
  return {
    ...host,
    ...(change.logDepth === undefined ? {} : { logDepth: change.logDepth }),
    engine: make({ host, cartridge: world.cartridge }),
  };
}

/**
 * A store holding `world` as `microworldId`, each visit standing where it
 * says under its nickname, written as a store keeps them: for each, in
 * order, a visitor instance minted from the world's serial and arrived on
 * the next, and their visitor record. Nothing else is stored, and what is
 * not stored reads as the bundle declares it: every declared object, and
 * every property of a visitor's kind.
 */
export async function seeded(
  world: EngineWorld,
  standing: readonly (readonly [VisitKey, InstanceId, string])[],
  store: SproutStore = memoryStore(),
  microworldId = 'w',
): Promise<SproutStore> {
  const name = world.host.catalogue.world;
  const people = standing.map(([visit, where, nickname], at) => {
    const instance: StoredInstance = {
      id: mintedId(name, 2 * at + 1),
      made: { from: 'visitor' },
      container: where,
      arrival: 2 * at + 2,
    };
    const visitor: StoredVisitor = {
      visit,
      nickname,
      instance: instance.id,
      lastPlace: where,
      referents: [],
      lastReading: null,
    };
    return { instance, visitor };
  });
  await store.transaction(microworldId, (tx) =>
    tx.putState({
      serial: 2 * standing.length,
      upsert: people.map((one) => one.instance),
      remove: [],
      tombstones: [],
      visitors: people.map((one) => one.visitor),
    }),
  );
  return store;
}

/** The stored state of `microworldId`, with no lock. */
export function storedIn(store: SproutStore, microworldId = 'w'): Promise<StoredState> {
  return store.read(microworldId, (tx) => tx.state());
}

/** The stored value of `property` on `id`; `fallback`, its declared value, where the store holds it at its default. */
export async function propertyOf(
  store: SproutStore,
  id: InstanceId,
  property: string,
  fallback: unknown,
): Promise<unknown> {
  const record = (await storedIn(store)).instances.find((one) => one.id === id);
  return record?.properties?.[property] ?? fallback;
}

/** The tally's counter, or what `id` names, as the store holds it now. */
export const countOf = (store: SproutStore, id: InstanceId = COUNTER) =>
  propertyOf(store, id, 'n', 0);
