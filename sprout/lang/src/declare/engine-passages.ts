// The passages the engine says for itself, and what it binds when it
// does (the spec's A worked microworld › The standard library it needs;
// Properties › Where types come from: `thing` in the world's
// `unreachable` and `unremarkable`, `candidates` in its `which`). The
// world's lines are said on the world's kind, a place's notices on the
// place's, and a passage the engine says is checked against exactly what
// the engine binds where it says it: the person acting and their place,
// as `actor` and `here` are in a body that binds them, an object, or a set
// of objects, by name. A line
// a poll says, in place of a description or a view, draws nothing.

/** What the engine binds a name to when it says a line: the one acting, their place, an object, or a set of them. */
export type EngineBinds = 'actor' | 'here' | 'object' | 'set';

/** One line the engine says, and the names it says it with. */
export interface EnginePassage {
  readonly name: string;
  readonly binds: Readonly<Record<string, EngineBinds>>;
  /** Said by a poll, which draws nothing (the spec's Chance › The seed). */
  readonly polled?: true;
}

/** Who is acting and where, as the engine binds them for a line said to the one acting. */
const ACTING = { actor: 'actor', here: 'here' } as const;

/** The world's own lines, said on the world's composed kind. */
export const WORLD_LINES: readonly EnginePassage[] = [
  { name: 'unknown', binds: ACTING },
  { name: 'unreachable', binds: { ...ACTING, thing: 'object' } },
  { name: 'which', binds: { ...ACTING, candidates: 'set' } },
  { name: 'nothing_happens', binds: ACTING },
  { name: 'unremarkable', binds: { thing: 'object' }, polled: true },
  { name: 'unseen', binds: {}, polled: true },
  { name: 'fault', binds: ACTING },
  { name: 'missing', binds: {} },
  { name: 'displaced', binds: {} },
  { name: 'inside_itself', binds: { item: 'object' } },
];

/** A place's notices of someone arriving and leaving, said on the place's composed kind. */
export const PLACE_LINES: readonly EnginePassage[] = [
  { name: 'arrives', binds: { item: 'object' } },
  { name: 'leaves', binds: { item: 'object' } },
];
