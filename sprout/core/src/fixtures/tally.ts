import {
  catalogueOf,
  compileBundle,
  declaredId,
  DEFAULT_LIMITS,
  Draft,
  initialState,
  libraryHash,
  newInstance,
  renderEffects,
  SourceFile,
  STANDARD_LIBRARY,
  storedChanges,
  visitKey,
  type Bundle,
  type CommandHost,
  type Manifest,
  type Parser,
} from '@overstory/sprout/lang';

import { memoryStore } from '../memory-store.js';
import type { SproutStore } from '../store.js';

// The tally, the world core's turn and log specs run: a counter and a
// gauge in a hall, both of one kind, one kind per file. Bumping one
// counts, and smashing it counts and then overflows, so the turn faults
// after it wrote; resting it asks for a wake a minute on, and a wake sets
// it to the seconds it waited, which it holds only up to 99. `tally(click)`
// compiles it with another word for a bump, so a spec can republish.

const MANIFEST: Manifest = {
  name: 'tally',
  namespace: 'tally',
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
  files: ['world.sprout', 'person.sprout', 'counter.sprout'],
};

/** The tally's files, a bump saying `click`. */
function files(click: string): Record<string, string> {
  return {
    'world.sprout': `world tally is sprout.World {
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
`,
    'person.sprout': 'kind Person is sprout.Visitor { }\n',
    'counter.sprout': `kind Counter {
  :n 0 min 0 max 99
  as target for bump  { do { self.adjust(:n, 1)  say "${click}" } }
  as target for smash { do { self.adjust(:n, 1)  if (2147483647 + 1 > 0) { say "Crunch." } } }
  as target for rest  { do { wake in 1 minutes  say "Resting." } }
  on :woke (elapsed) { self.set(:n, elapsed) }
}
`,
  };
}

export const HALL = declaredId('tally', ['hall']);
export const COUNTER = declaredId('tally', ['hall', 'counter']);
export const GAUGE = declaredId('tally', ['hall', 'gauge']);
export const MARTA = visitKey('v-marta');

/** The tally compiled with a bump saying `click`, and a host running it under the spec's budgets. */
export function tally(click = 'Click.'): { bundle: Bundle; host: CommandHost } {
  const { bundle } = compileBundle(
    {
      manifestFile: new SourceFile('sprout.json', JSON.stringify(MANIFEST)),
      manifest: MANIFEST,
      files: Object.entries(files(click)).map(([name, text]) => new SourceFile(name, text)),
      libraries: [STANDARD_LIBRARY],
    },
    { mode: 'publish', limits: DEFAULT_LIMITS },
  );
  if (bundle === null) throw new Error('the tally does not compile');
  /** Reads `verb counter` and `verb gauge`; anything else is not reached by these cases. */
  const parse: Parser = (text, actor) => {
    const [word, noun] = text.split(' ');
    const verb = bundle.verbs.qualified('tally', word!);
    if (verb === null) throw new Error(`no verb in \`${text}\``);
    const object = noun === 'gauge' ? GAUGE : COUNTER;
    return { reading: { verb, actor, bindings: new Map([['target', { object }]]) } };
  };
  const catalogue = catalogueOf(bundle, DEFAULT_LIMITS.caps);
  return {
    bundle,
    host: { catalogue, budgets: DEFAULT_LIMITS.budgets, parse, render: renderEffects },
  };
}

/** Marta's `text`, typed at `now` with seed 1. */
export const command = (text: string, now = 0) => ({
  visit: MARTA,
  text,
  seed: 1,
  mayHold: null,
  now,
});

/** A store holding the tally, as `host` runs it, with Marta standing in the hall, written with no turn and no log. */
export async function seeded(
  host: CommandHost,
  store: SproutStore = memoryStore(),
): Promise<SproutStore> {
  const { catalogue } = host;
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
