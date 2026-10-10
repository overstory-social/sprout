// The cases the prose goldens hold: what a turn said, unrendered, in the bench world
// (`prose-bench.ts`), with the state it was said in, the seed, the host's figures and who
// acted. The oracle renders each (`renderEffects`) and the golden records what every
// reader read; the C runtime replays them. Spec support: the package build leaves it out.

import {
  ENGINE_LINES,
  ownerOf,
  type EngineBinds,
  type EngineLineName,
} from '../declare/engine-passages.js';

/** Someone or something in the bench:a name the state gives (`marta`), or a path under the world (`yard.press`). */
export type Who = string;

/** What a name is bound to when a line is said. */
export type Bind =
  | Who
  | { readonly set: readonly Who[] }
  | { readonly readings: readonly string[] }
  | { readonly value: string | number | boolean };

/** The words a line has. */
export type Say =
  /** The passage of that name, as the kind of `by` has it. */
  | { readonly passage: string }
  /** Words in quotes, a one-line passage; each must be written by one of the bench's handlers. */
  | { readonly text: string }
  /** A passage whose prose file the world was loaded without. */
  | { readonly absent: string }
  /** The standard library's own words for an engine line, which the engine says where nothing writes it. */
  | { readonly stock: string }
  /** An engine line found where the spec says: on `about`, then `place`, then the world. */
  | { readonly engine: string; readonly about?: Who; readonly place?: Who };

/** One line a turn said. */
export interface Line {
  readonly effect?: 'said' | 'told' | 'refused' | 'notice';
  readonly to: readonly Who[];
  /** Whose body said it, which is `self` when it renders; for an `engine` line, whoever the engine finds it on. */
  readonly by?: Who;
  /** An NPC that says it, heard through the engine's `npc_says`. */
  readonly speaker?: Who;
  readonly say: Say;
  readonly bind?: Readonly<Record<string, Bind>>;
}

/** The host's figures a case runs under: unset ones are left to the host's defaults. */
export interface Figures {
  readonly output?: number;
  readonly steps?: number;
  readonly passageDepth?: number;
}

export type StateName = 'yard' | 'laden';

export interface ProseCase {
  readonly name: string;
  readonly area: string;
  readonly state?: StateName;
  readonly seed?: number;
  /** Draws a turn's bodies made before anything was rendered. */
  readonly skip?: number;
  /** Who acted, whose output past the host's figure faults the turn; none where nobody did. */
  readonly actor?: Who | null;
  readonly figures?: Figures;
  /** Nicknames changed in the turn, before anything is rendered. */
  readonly renames?: Readonly<Record<Who, string>>;
  readonly lines: readonly Line[];
}

const said = (to: readonly Who[], by: Who, passage: string, bind: Line['bind'] = {}): Line => ({
  to,
  by,
  say: { passage },
  bind,
});

const both = ['marta', 'ines'] as const;
const INKED: Line['bind'] = { actor: 'marta', tools: { set: ['yard.brass_key', 'yard.oak_door'] } };

/** Every slot, one kind to a case. */
const SLOTS: ProseCase[] = [
  {
    name: 'an object is “you” to its reader and its article and name to anyone else',
    area: 'slots',
    actor: 'marta',
    lines: [said(both, 'yard.press', 'inked', INKED)],
  },
  {
    name: 'an option is humanised, a number is digits and a string is as written',
    area: 'slots',
    actor: 'marta',
    lines: [said(['marta'], 'yard.press', 'mood')],
  },
  {
    name: 'a list is walked with $index and $count, each option humanised',
    area: 'slots',
    actor: 'marta',
    lines: [said(['marta'], 'yard.press', 'moods')],
  },
  {
    name: 'articles come from the grammar block, the identifier or the kind, and none writes none',
    area: 'slots',
    actor: 'marta',
    lines: [said(['marta'], 'yard.echo', 'things')],
  },
  {
    name: 'another object’s passage runs with that object as its own self',
    area: 'slots',
    actor: 'marta',
    lines: [said(['marta'], 'yard.crate', 'listing')],
  },
  {
    name: 'a name the engine gives an object with no identifier is its kind’s, humanised',
    area: 'slots',
    actor: 'marta',
    lines: [said(['marta', 'ines'], 'cell', 'named')],
  },
  {
    name: 'a path names an object and its member, and a passage of a kind found by narrowing',
    area: 'slots',
    actor: 'marta',
    lines: [said(['marta'], 'yard.echo', 'pathed'), said(['marta'], 'yard.echo', 'nearby')],
  },
  {
    name: 'a passage’s padding is lost when a slot puts it in a line',
    area: 'slots',
    actor: 'marta',
    lines: [said(['marta'], 'yard.echo', 'heard')],
  },
];

/** `{if}`, `{for}` and `{one of}`. */
const FLOW: ProseCase[] = [
  {
    name: 'an if chain renders the first branch that holds, and a passage’s blocks leave no empty paragraph',
    area: 'flow',
    actor: 'marta',
    lines: [said(['marta'], 'yard.press', 'sheets')],
  },
  {
    name: 'a loop over contents renders each in range once, with $first and $last',
    area: 'flow',
    actor: 'marta',
    lines: [said(['marta'], 'yard.crate', 'listing')],
  },
  {
    name: 'a loop over a set role, in the order the reading bound it',
    area: 'flow',
    actor: 'marta',
    lines: [
      said(['marta', 'ines'], 'yard.echo', 'calls', {
        tools: { set: ['yard.brass_key', 'yard.oak_door', 'yard.owl'] },
      }),
    ],
  },
  {
    name: 'a one of draws from the turn’s stream, once for every reader of the line',
    area: 'flow',
    seed: 7,
    actor: 'marta',
    lines: [said(both, 'yard.echo', 'call', { actor: 'marta' })],
  },
  {
    name: 'a one of draws after the draws the bodies made',
    area: 'flow',
    seed: 7,
    skip: 3,
    actor: 'marta',
    lines: [said(both, 'yard.echo', 'call', { actor: 'marta' })],
  },
  {
    name: 'another seed draws other words',
    area: 'flow',
    seed: 90210,
    actor: 'marta',
    lines: [said(both, 'yard.echo', 'call', { actor: 'marta' })],
  },
  {
    name: 'a chance in a condition and a one of in a passage a slot renders draw in render order',
    area: 'flow',
    seed: 11,
    actor: 'marta',
    lines: [
      said(both, 'yard.echo', 'toss', { actor: 'marta' }),
      said(both, 'yard.echo', 'toss', { actor: 'marta' }),
      said(['ines'], 'yard.echo', 'calls', { tools: { set: ['yard.brass_key', 'yard.oak_door'] } }),
    ],
  },
  {
    name: 'a one of with a single choice still draws',
    area: 'flow',
    seed: 5,
    actor: 'marta',
    lines: [said(['marta'], 'yard.echo', 'hum', { actor: 'marta' })],
  },
];

/** Text, a break and the width of space. */
const LAYOUT: ProseCase[] = [
  {
    name: 'a blank line is a paragraph, a \\n is a line, and the rest of the space is one',
    area: 'layout',
    actor: 'marta',
    lines: [said(['marta'], 'yard.press', 'sheets')],
  },
  {
    name: 'a passage put in a slot keeps the breaks it opens and closes with only where it renders words',
    area: 'layout',
    actor: 'marta',
    lines: [
      said(['marta'], 'yard.echo', 'faded'),
      said(['marta'], 'yard.echo', 'carried'),
      said(['marta'], 'yard.echo', 'lined'),
      said(['marta'], 'yard.echo', 'room'),
    ],
  },
  {
    name: 'a paragraph that renders nothing is no paragraph',
    area: 'layout',
    actor: 'marta',
    lines: [said(['marta'], 'yard.echo', 'room')],
  },
  {
    name: 'the first letter is capitalised past quotation marks and dashes, not past a bracket',
    area: 'layout',
    actor: 'marta',
    lines: [
      said(['marta'], 'yard.echo', 'quoted'),
      said(['marta'], 'yard.echo', 'bracketed'),
      said(['marta'], 'yard.echo', 'dashed'),
      said(['marta'], 'yard.echo', 'digit'),
    ],
  },
  {
    name: 'reflow takes the white space JavaScript does: no-break, ideographic and byte-order spaces',
    area: 'layout',
    actor: 'marta',
    lines: [said(['marta'], 'yard.echo', 'wide')],
  },
  {
    name: 'capitalising maps a letter as JavaScript’s upper case does, special casing included',
    area: 'layout',
    actor: 'marta',
    lines: [
      said(['marta'], 'yard.echo', 'sharp'),
      said(['marta'], 'yard.echo', 'digraph'),
      said(['marta'], 'yard.echo', 'apostrophe'),
      said(['marta'], 'yard.echo', 'ligature'),
      said(['marta'], 'yard.echo', 'greek'),
      said(['marta'], 'yard.echo', 'dotless'),
      said(['marta'], 'yard.echo', 'astral'),
      said(['marta'], 'yard.echo', 'emoji'),
      said(['marta'], 'yard.echo', 'cased'),
    ],
  },
  {
    name: 'a string given to say is a one-line passage with slots',
    area: 'layout',
    actor: 'marta',
    lines: [
      {
        to: ['marta'],
        by: 'yard.sayer',
        say: { text: 'You count {value}, and {who} nods.' },
        bind: { who: 'ines', value: { value: 3 } },
      },
      { to: ['marta'], by: 'yard.sayer', say: { text: 'plain words, “quoted” ones' } },
    ],
  },
];

/** Names. */
const NAMES: ProseCase[] = [
  {
    name: 'a nickname changed in the turn reads as changed, to everyone',
    area: 'names',
    actor: 'marta',
    renames: { marta: 'Marta B' },
    lines: [said(both, 'yard.press', 'inked', INKED)],
  },
  {
    name: 'a visitor is their nickname with no article, whoever reads',
    area: 'names',
    actor: 'ines',
    renames: { ines: 'Ines the Elder' },
    lines: [said(both, 'yard.press', 'inked', { actor: 'ines', tools: { set: ['marta'] } })],
  },
  {
    name: 'a visitor in the set a loop walks is named by their nickname, or “you” to themselves',
    area: 'names',
    actor: 'ines',
    lines: [said(both, 'yard.echo', 'calls', { tools: { set: ['marta', 'ines'] } })],
  },
  {
    name: 'what a visitor carries is listed to them',
    area: 'names',
    state: 'laden',
    actor: 'marta',
    lines: [said(['marta'], 'marta', 'carrying')],
  },
];

/** Who reads, and what each is charged. */
const READERS: ProseCase[] = [
  {
    name: 'a plain say reaches one reader, a tell the others, a refusal the actor',
    area: 'readers',
    actor: 'marta',
    lines: [
      { effect: 'said', to: ['marta'], by: 'yard.press', say: { passage: 'inked' }, bind: INKED },
      { effect: 'told', to: ['ines'], by: 'yard.press', say: { passage: 'inked' }, bind: INKED },
      { effect: 'refused', to: ['marta'], by: 'yard.crate', say: { passage: 'listing' } },
      {
        effect: 'notice',
        to: ['ines'],
        by: 'yard',
        say: { stock: 'arrives' },
        bind: { item: 'marta' },
      },
    ],
  },
  {
    name: 'a line that renders nothing for a reader leaves that reader nothing',
    area: 'readers',
    actor: 'marta',
    lines: [
      { to: ['marta', 'ines'], by: 'yard.echo', say: { absent: 'gone_missing' } },
      said(both, 'yard.echo', 'room'),
      said(both, 'yard.echo', 'aside'),
    ],
  },
  {
    name: 'an NPC’s line is heard through npc_says, the same draw for every reader',
    area: 'readers',
    seed: 3,
    actor: 'marta',
    lines: [{ to: both, by: 'yard.cat', speaker: 'yard.cat', say: { passage: 'purr' } }],
  },
  {
    name: 'an NPC’s line that renders nothing is not heard',
    area: 'readers',
    actor: 'marta',
    lines: [{ to: both, by: 'yard.cat', speaker: 'yard.cat', say: { absent: 'gone_missing' } }],
  },
  {
    name: 'a reader is cut short at the first whole line that would take them past the figure, and read nothing after',
    area: 'output',
    actor: 'marta',
    figures: { output: 40 },
    lines: [
      said(['marta', 'ines'], 'yard.echo', 'heard'),
      said(['ines'], 'yard.echo', 'faded'),
      said(['ines', 'marta'], 'yard.echo', 'heard'),
    ],
  },
  {
    name: 'a cut reader stays cut for a shorter line that would have fitted',
    area: 'output',
    actor: 'marta',
    figures: { output: 30 },
    lines: [
      said(['marta'], 'yard.echo', 'heard'),
      said(['ines'], 'yard.press', 'mood'),
      said(['ines'], 'yard.echo', 'short'),
      said(['marta'], 'yard.echo', 'short'),
    ],
  },
  {
    name: 'a line charges code points, not bytes',
    area: 'output',
    actor: 'marta',
    figures: { output: 14 },
    lines: [said(['marta'], 'yard.echo', 'emoji'), said(['ines'], 'yard.echo', 'emoji')],
  },
  {
    name: 'the actor’s own output past the figure faults the turn',
    area: 'output',
    actor: 'marta',
    figures: { output: 20 },
    lines: [said(['marta'], 'yard.echo', 'heard'), said(['marta'], 'yard.echo', 'faded')],
  },
  {
    name: 'nobody’s output faults a turn nobody acted in',
    area: 'output',
    actor: null,
    figures: { output: 20 },
    lines: [said(['marta'], 'yard.echo', 'heard'), said(['marta'], 'yard.echo', 'faded')],
  },
  {
    name: 'output exactly at the figure fits',
    area: 'output',
    actor: 'marta',
    figures: { output: 17 },
    lines: [said(['marta', 'ines'], 'yard.echo', 'heard')],
  },
];

/** The invocation depth and the step budget. */
const BOUNDS: ProseCase[] = [
  {
    name: 'passages nest to the host’s depth',
    area: 'bounds',
    actor: 'marta',
    figures: { passageDepth: 3 },
    lines: [said(['marta'], 'yard.echo', 'tier1')],
  },
  {
    name: 'a passage one level past the host’s depth faults the turn',
    area: 'bounds',
    actor: 'marta',
    figures: { passageDepth: 2 },
    lines: [said(['marta'], 'yard.echo', 'tier1')],
  },
  {
    name: 'a passage that renders itself faults at the default depth',
    area: 'bounds',
    actor: 'marta',
    lines: [said(['marta'], 'yard.echo', 'ring')],
  },
  {
    name: 'every expression, condition, iteration and choice is a step',
    area: 'bounds',
    actor: 'marta',
    seed: 2,
    lines: [
      said(both, 'yard.echo', 'call', { actor: 'marta' }),
      said(['marta'], 'yard.crate', 'listing'),
    ],
  },
  {
    name: 'rendering past the step budget faults the turn',
    area: 'bounds',
    actor: 'marta',
    figures: { steps: 9 },
    lines: [said(['marta'], 'yard.crate', 'listing')],
  },
];

/** What the engine binds a name to when it says a line, as the bench has it. */
const ENGINE_BINDS: Record<EngineBinds, Bind> = {
  actor: 'marta',
  here: 'yard',
  object: 'yard.brass_key',
  readings: { readings: ['look', 'take brass key', 'inventory'] },
  text: { value: 'north' },
};

/** The words a text binding takes by the name it is bound under. */
const ENGINE_TEXT: Record<string, string> = {
  way: 'through the low door',
  reading: 'eat the door',
  pronoun: 'she',
  words: 'Mrrp.',
};

/** Who says an engine line in the standard library’s own words: the one it is about, or the world. */
const bySaying = (name: EngineLineName): Who | undefined => {
  const owner = ownerOf(name);
  return owner === 'Place' ? 'yard' : owner === 'Actor' ? 'marta' : undefined;
};

/** What a name the engine binds is bound to. */
function engineBind(key: string, kind: EngineBinds): Bind {
  if (kind === 'text') return { value: ENGINE_TEXT[key] ?? 'north' };
  if (key === 'to' || key === 'from' || key === 'item') return 'yard.oak_door';
  return ENGINE_BINDS[kind];
}

/** Every line the engine says in the standard library’s own words, with and without what it may leave unbound. */
function engineCases(): ProseCase[] {
  const cases: ProseCase[] = [];
  for (const line of ENGINE_LINES) {
    const name = line.name as EngineLineName;
    const all = Object.keys(line.binds);
    const optional = Object.keys(line.optional ?? {});
    const variants =
      optional.length > 0 ? [all, all.filter((key) => !optional.includes(key))] : [all];
    for (const names of variants) {
      const bind: Record<string, Bind> = {};
      for (const key of names) bind[key] = engineBind(key, line.binds[key] as EngineBinds);
      const by = bySaying(name);
      const unbound = names.length < all.length ? `, with ${optional.join(' and ')} unbound` : '';
      cases.push({
        name: `${name}, in the standard library’s words${unbound}`,
        area: 'engine',
        actor: 'marta',
        lines: [
          {
            to: ['marta', 'ines'],
            ...(by === undefined ? {} : { by }),
            say: { stock: name },
            bind,
          },
        ],
      });
    }
  }
  return cases;
}

const ENGINE: ProseCase[] = [
  ...engineCases(),
  {
    name: 'a move into what holds no actors is refused in the engine’s own words',
    area: 'engine',
    actor: 'marta',
    lines: [
      {
        to: ['marta'],
        by: 'yard',
        say: { stock: 'not_a_place' },
        bind: { item: 'yard.oak_door', to: 'yard.crate' },
      },
    ],
  },
  {
    name: 'the inventory of a visitor who carries things, in the standard library’s words',
    area: 'engine',
    state: 'laden',
    actor: 'marta',
    lines: [
      {
        to: ['marta', 'ines'],
        by: 'marta',
        say: { stock: 'inventory' },
        bind: { actor: 'marta', here: 'yard' },
      },
    ],
  },
  {
    name: 'an engine line is the first found on the one it is about, its place, then the world',
    area: 'engine',
    actor: 'marta',
    lines: [
      { to: ['marta'], say: { engine: 'waited', about: 'marta', place: 'yard' } },
      {
        to: ['marta'],
        say: { engine: 'unknown', about: 'marta', place: 'yard' },
        bind: { actor: 'marta', here: 'yard' },
      },
      {
        to: ['marta', 'ines'],
        say: { engine: 'arrives', about: 'marta', place: 'yard' },
        bind: { item: 'marta' },
      },
      {
        to: ['marta'],
        say: { engine: 'help', about: 'marta', place: 'yard' },
        bind: {
          actor: 'marta',
          here: 'yard',
          readings: { readings: ['look', 'take brass key'] },
        },
      },
    ],
  },
];

export const PROSE_CASES: readonly ProseCase[] = [
  ...SLOTS,
  ...FLOW,
  ...LAYOUT,
  ...NAMES,
  ...READERS,
  ...BOUNDS,
  ...ENGINE,
];
