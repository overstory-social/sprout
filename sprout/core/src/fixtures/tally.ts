import {
  catalogueOf,
  compileBundle,
  declaredId,
  DEFAULT_LIMITS,
  libraryHash,
  SourceFile,
  STANDARD_LIBRARY,
  visitKey,
  type Bundle,
  type Catalogue,
  type Manifest,
} from '@overstory/sprout/lang';

import { withImports } from './imports.js';

// The tally, the world core's log specs read entries against: a counter
// and a gauge in a hall, both of one kind, one kind per file, with verbs
// to bump, smash and rest one, and intents that bump twice, and bump,
// smash and bump. Spec support: the package build leaves it out.

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
  files: ['tally.sprout', 'person.sprout', 'counter.sprout'],
};

/** The tally's files. */
const FILES: Record<string, string> = {
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
};

export const HALL = declaredId('tally', ['hall']);
export const COUNTER = declaredId('tally', ['hall', 'counter']);
export const GAUGE = declaredId('tally', ['hall', 'gauge']);
export const MARTA = visitKey('v-marta');

/** The tally compiled under the spec's limits. */
export function tallyBundle(): Bundle {
  const { bundle } = compileBundle(
    {
      manifestFile: new SourceFile('sprout.json', JSON.stringify(MANIFEST)),
      manifest: MANIFEST,
      files: withImports(Object.entries(FILES).map(([name, text]) => new SourceFile(name, text))),
      libraries: [STANDARD_LIBRARY],
    },
    { mode: 'publish', limits: DEFAULT_LIMITS },
  );
  if (bundle === null) throw new Error('the tally does not compile');
  return bundle;
}

/** The tally's catalogue, read under the spec's caps. */
export const tally = (): Catalogue => catalogueOf(tallyBundle(), DEFAULT_LIMITS.caps);
