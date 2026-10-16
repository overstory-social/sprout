import { z } from 'zod';

import {
  catalogueOf,
  compileBundle,
  declaredId,
  DEFAULT_LIMITS,
  libraryHash,
  SourceFile,
  STANDARD_LIBRARY,
  visitKey,
  type Catalogue,
  type Effect,
  type Extension,
  type Manifest,
  type SeenView,
  type VisitKey,
} from '@overstory/sprout/lang';

import { withImports } from './imports.js';

// The showroom, the world core's client specs run: a dark hall whose
// description shows a slide, and a magic lantern that throws another
// when projected, and refuses while it is cold; one kind per file, each
// naming the host's `slides` extension at major 1, whose one statement,
// `show`, records a caption a text client reads as "[A slide: …]"; and
// what Marta, standing there with Ines, is told and shown of it, as the
// engine gives them. Spec support: the package build leaves it out.

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
      files: withImports(Object.entries(FILES).map(([name, text]) => new SourceFile(name, text))),
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

/** What Marta is told projecting the lantern while it is cold: its refusal. */
export const COLD = [
  {
    kind: 'refused',
    from: 'showroom.hall.lantern',
    actor: 'showroom#1',
    to: 'showroom#1',
    visit: 'v-marta',
    paragraphs: ['The lantern is cold.'],
    written: [
      {
        line: 'lantern.sprout:8:45',
      },
    ],
  },
] as unknown as readonly Effect[];

/** What Marta is told projecting the lantern once it is lit: what it says, and the slide it shows. */
export const PROJECTED = [
  {
    kind: 'said',
    from: 'showroom.hall.lantern',
    actor: 'showroom#1',
    to: 'showroom#1',
    visit: 'v-marta',
    paragraphs: ['The lantern throws a picture on the sheet.'],
    written: [
      {
        line: 'lantern.sprout:10:12',
      },
    ],
  },
  {
    kind: 'extension',
    from: 'showroom.hall.lantern',
    actor: 'showroom#1',
    to: 'showroom#1',
    visit: 'v-marta',
    paragraphs: ['[A slide: a ship in a storm]'],
    written: [],
    extension: 'slides',
    statement: 'show',
    payload: {
      caption: 'a ship in a storm',
    },
  },
] as unknown as readonly Effect[];

/** What Marta is told looking about the hall: its description, and the slide it shows. */
export const LOOKED = [
  {
    kind: 'described',
    from: 'showroom.hall',
    actor: 'showroom#1',
    to: 'showroom#1',
    visit: 'v-marta',
    paragraphs: ['A dark hall with a sheet hung at one end.'],
    written: [
      {
        line: 'hall.sprout:5:11',
      },
    ],
  },
  {
    kind: 'extension',
    from: 'showroom.hall',
    actor: 'showroom#1',
    to: 'showroom#1',
    visit: 'v-marta',
    paragraphs: ['[A slide: a moth, very large]'],
    written: [],
    extension: 'slides',
    statement: 'show',
    payload: {
      caption: 'a moth, very large',
    },
  },
] as unknown as readonly Effect[];

/** Marta's view of the hall, Ines standing there with her. */
export const HALL_VIEW = {
  description: ['A dark hall with a sheet hung at one end.'],
  effects: [
    {
      extension: 'slides',
      statement: 'show',
      payload: {
        caption: 'a moth, very large',
      },
      transcript: '[A slide: a moth, very large]',
    },
  ],
  exits: [],
  occupants: [
    {
      id: 'showroom#3',
      name: 'Ines',
    },
  ],
  carried: [],
  readings: [
    {
      verb: 'showroom.project',
      typed: 'project hall',
      refused: null,
      fillers: [
        {
          role: 'target',
          words: '',
          binds: 'object',
          id: 'showroom.hall',
          name: 'a hall',
          all: false,
        },
      ],
      options: [],
    },
    {
      verb: 'showroom.project',
      typed: 'project lantern',
      refused: ['The lantern is cold.'],
      fillers: [
        {
          role: 'target',
          words: '',
          binds: 'object',
          id: 'showroom.hall.lantern',
          name: 'a lantern',
          all: true,
        },
      ],
      options: [],
    },
    {
      verb: 'showroom.project',
      typed: 'project Ines',
      refused: null,
      fillers: [
        {
          role: 'target',
          words: '',
          binds: 'object',
          id: 'showroom#3',
          name: 'Ines',
          all: false,
        },
      ],
      options: [],
    },
    {
      verb: 'showroom.light',
      typed: 'light hall',
      refused: null,
      fillers: [
        {
          role: 'target',
          words: '',
          binds: 'object',
          id: 'showroom.hall',
          name: 'a hall',
          all: false,
        },
      ],
      options: [],
    },
    {
      verb: 'showroom.light',
      typed: 'light lantern',
      refused: null,
      fillers: [
        {
          role: 'target',
          words: '',
          binds: 'object',
          id: 'showroom.hall.lantern',
          name: 'a lantern',
          all: true,
        },
      ],
      options: [],
    },
    {
      verb: 'showroom.light',
      typed: 'light Ines',
      refused: null,
      fillers: [
        {
          role: 'target',
          words: '',
          binds: 'object',
          id: 'showroom#3',
          name: 'Ines',
          all: false,
        },
      ],
      options: [],
    },
    {
      verb: 'sprout.look',
      typed: 'look',
      refused: null,
      fillers: [],
      options: [],
    },
    {
      verb: 'sprout.examine',
      typed: 'examine hall',
      refused: null,
      fillers: [
        {
          role: 'target',
          words: '',
          binds: 'object',
          id: 'showroom.hall',
          name: 'a hall',
          all: false,
        },
      ],
      options: [],
    },
    {
      verb: 'sprout.examine',
      typed: 'examine lantern',
      refused: null,
      fillers: [
        {
          role: 'target',
          words: '',
          binds: 'object',
          id: 'showroom.hall.lantern',
          name: 'a lantern',
          all: true,
        },
      ],
      options: [],
    },
    {
      verb: 'sprout.examine',
      typed: 'examine Ines',
      refused: null,
      fillers: [
        {
          role: 'target',
          words: '',
          binds: 'object',
          id: 'showroom#3',
          name: 'Ines',
          all: false,
        },
      ],
      options: [],
    },
    {
      verb: 'sprout.inventory',
      typed: 'inventory',
      refused: null,
      fillers: [],
      options: [],
    },
    {
      verb: 'sprout.wait',
      typed: 'wait',
      refused: null,
      fillers: [],
      options: [],
    },
    {
      verb: 'sprout.help',
      typed: 'help',
      refused: null,
      fillers: [],
      options: [],
    },
    {
      verb: 'sprout.take',
      typed: 'take lantern',
      refused: null,
      fillers: [
        {
          role: 'target',
          words: '',
          binds: 'object',
          id: 'showroom.hall.lantern',
          name: 'a lantern',
          all: true,
        },
        {
          role: 'source',
          words: 'from',
          binds: 'unbound',
        },
      ],
      options: [],
    },
    {
      verb: 'sprout.take',
      typed: 'take Ines',
      refused: null,
      fillers: [
        {
          role: 'target',
          words: '',
          binds: 'object',
          id: 'showroom#3',
          name: 'Ines',
          all: false,
        },
        {
          role: 'source',
          words: 'from',
          binds: 'unbound',
        },
      ],
      options: [],
    },
    {
      verb: 'sprout.drop',
      typed: 'drop lantern',
      refused: ['You are not holding a lantern.'],
      fillers: [
        {
          role: 'target',
          words: '',
          binds: 'object',
          id: 'showroom.hall.lantern',
          name: 'a lantern',
          all: true,
        },
      ],
      options: [],
    },
    {
      verb: 'sprout.drop',
      typed: 'drop Ines',
      refused: ['You are not holding Ines.'],
      fillers: [
        {
          role: 'target',
          words: '',
          binds: 'object',
          id: 'showroom#3',
          name: 'Ines',
          all: false,
        },
      ],
      options: [],
    },
    {
      verb: 'sprout.give',
      typed: 'give lantern to Ines',
      refused: ['You are not holding a lantern.'],
      fillers: [
        {
          role: 'item',
          words: '',
          binds: 'object',
          id: 'showroom.hall.lantern',
          name: 'a lantern',
          all: true,
        },
        {
          role: 'recipient',
          words: 'to',
          binds: 'object',
          id: 'showroom#3',
          name: 'Ines',
          all: true,
        },
      ],
      options: [],
    },
    {
      verb: 'sprout.ask',
      typed: 'ask hall about …',
      refused: null,
      fillers: [
        {
          role: 'target',
          words: '',
          binds: 'object',
          id: 'showroom.hall',
          name: 'a hall',
          all: false,
        },
        {
          role: 'topic',
          words: 'about',
          binds: 'unbound',
        },
      ],
      options: [
        {
          role: 'topic',
          takes: 'symbol',
          options: [],
        },
      ],
    },
    {
      verb: 'sprout.ask',
      typed: 'ask lantern about …',
      refused: null,
      fillers: [
        {
          role: 'target',
          words: '',
          binds: 'object',
          id: 'showroom.hall.lantern',
          name: 'a lantern',
          all: true,
        },
        {
          role: 'topic',
          words: 'about',
          binds: 'unbound',
        },
      ],
      options: [
        {
          role: 'topic',
          takes: 'symbol',
          options: [],
        },
      ],
    },
    {
      verb: 'sprout.ask',
      typed: 'ask Ines about …',
      refused: null,
      fillers: [
        {
          role: 'target',
          words: '',
          binds: 'object',
          id: 'showroom#3',
          name: 'Ines',
          all: false,
        },
        {
          role: 'topic',
          words: 'about',
          binds: 'unbound',
        },
      ],
      options: [
        {
          role: 'topic',
          takes: 'symbol',
          options: [],
        },
      ],
    },
  ],
} as unknown as SeenView;
