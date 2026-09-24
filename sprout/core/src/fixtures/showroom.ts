import { z } from 'zod';

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
  type Catalogue,
  type CommandHost,
  type Extension,
  type Manifest,
  type VisitKey,
} from '@overstory/sprout/lang';

import { memoryStore } from '../memory-store.js';
import type { SproutStore } from '../store.js';

// The showroom, the world core's client specs run: a dark hall whose
// description shows a slide, and a magic lantern that throws another
// when projected, and refuses while it is cold; one kind per file, each
// naming the host's `slides` extension at major 1, whose one statement,
// `show`, records a caption a text client reads as "[A slide: …]".
// Spec support: the package build leaves it out.

/** The `slides` extension as a host installs it. */
export const SLIDES: Extension = {
  name: 'slides',
  major: 1,
  types: [],
  statements: [
    {
      name: 'show',
      parameters: [{ name: 'caption', type: 'string' }],
      describe: true,
      run: ({ arguments: [caption] }) => ({ caption: caption ?? '' }),
      effect: z.object({ caption: z.string() }),
      transcript: (payload) => `[A slide: ${(payload as { caption: string }).caption}]`,
    },
  ],
  skill: 'Show a slide with `slides.show("caption")`; a text client reads the caption.',
};

const FILES: Record<string, string> = {
  'showroom.sprout': `extension slides 1

world showroom is sprout.World {
  visitors are Person
  visitors arrive at hall
  object hall is Hall {
    object lantern is Lantern
  }
}
verb project { role target  "project [target]" }
verb light   { role target  "light [target]" }
`,
  'hall.sprout': `extension slides 1

kind Hall is sprout.Place {
  describe {
    text "A dark hall with a sheet hung at one end."
    slides.show("a moth, very large")
  }
}
`,
  'lantern.sprout': `extension slides 1

kind Lantern {
  :lit false
  grammar { name "lantern"  nouns "lantern" }
  as target for light { do { self.set(:lit, true)  say "The lantern warms." } }
  as target for project {
    permit { if (!self.get(:lit)) { refuse "The lantern is cold." } }
    do {
      say "The lantern throws a picture on the sheet."
      slides.show("a ship in a storm")
    }
  }
}
`,
  'person.sprout': 'kind Person is sprout.Visitor { }\n',
};

const MANIFEST: Manifest = {
  name: 'showroom',
  namespace: 'showroom',
  version: '0.1.0',
  author: 'Eric Eslinger',
  license: 'MIT',
  level: 1,
  extensions: [{ name: 'slides', major: 1 }],
  libraries: [
    {
      name: STANDARD_LIBRARY.name,
      version: STANDARD_LIBRARY.version,
      sha: libraryHash(STANDARD_LIBRARY),
    },
  ],
  files: Object.keys(FILES),
};

/** The showroom's catalogue, compiled on a host that installed `slides`. */
export function showroomCatalogue(): Catalogue {
  const { bundle, diagnostics } = compileBundle(
    {
      manifestFile: new SourceFile('sprout.json', JSON.stringify(MANIFEST)),
      manifest: MANIFEST,
      files: Object.entries(FILES).map(([name, text]) => new SourceFile(name, text)),
      libraries: [STANDARD_LIBRARY],
    },
    { mode: 'publish', limits: DEFAULT_LIMITS, extensions: [SLIDES] },
  );
  if (bundle === null) throw new Error(diagnostics.map((d) => d.message).join('\n'));
  return catalogueOf(bundle, DEFAULT_LIMITS.caps);
}

export const HALL = declaredId('showroom', ['hall']);
export const LANTERN = declaredId('showroom', ['hall', 'lantern']);
export const MARTA: VisitKey = visitKey('v-marta');
export const INES: VisitKey = visitKey('v-ines');

/** A host running `catalogue` under the default budgets. */
export const showroomHost = (catalogue: Catalogue): CommandHost => ({
  catalogue,
  budgets: DEFAULT_LIMITS.budgets,
  parse: parseCommand,
  render: renderEffects,
});

/** A store holding the showroom with Marta and Ines standing in the hall. */
export async function showroom(catalogue: Catalogue): Promise<SproutStore> {
  const store = memoryStore();
  const draft = new Draft(initialState(catalogue));
  for (const [visit, nickname] of [
    [MARTA, 'Marta'],
    [INES, 'Ines'],
  ] as const) {
    const id = draft.mint();
    draft.add(
      newInstance(
        id,
        { from: 'visitor' },
        catalogue.visitorKind!,
        HALL,
        draft.nextSerial(),
        catalogue.caps,
      ),
    );
    draft.putVisitor({ visit, nickname, instance: id, lastPlace: HALL });
  }
  const { state, changes } = draft.commit();
  await store.transaction('w', (tx) => tx.putState(storedChanges(state, changes)));
  return store;
}

/** A command `visit` types, with a fixed seed at the host's instant 0. */
export const typed = (visit: VisitKey, text: string) => ({
  visit,
  text,
  seed: 3,
  mayHold: null,
  now: 0,
});
