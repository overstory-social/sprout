// The passages the engine says for itself, and what it binds when it
// does (the spec's A worked microworld › The standard library it needs;
// Properties › Where types come from: `thing` in the world's
// `unreachable` and `unremarkable`, `candidates` in its `which`). The
// world's lines are said on the world's kind, a place's notices on the
// place's, and a passage the engine says is checked against exactly what
// the engine binds where it says it: the person acting, as `actor` is in
// a body that binds one, an object, or a set of objects, by name.

/** What the engine binds a name to when it says a line: the one acting, an object, or a set of them. */
export type EngineBinds = 'actor' | 'object' | 'set';

/** One line the engine says, and the names it says it with. */
export interface EnginePassage {
  readonly name: string;
  readonly binds: Readonly<Record<string, EngineBinds>>;
}

/** Who is acting and where, as the engine binds them for a line said to the one acting. */
const ACTING = { actor: 'actor', here: 'object' } as const;

/** The world's own lines, said on the world's composed kind. */
export const WORLD_LINES: readonly EnginePassage[] = [
  { name: 'unknown', binds: ACTING },
  { name: 'unreachable', binds: { ...ACTING, thing: 'object' } },
  { name: 'which', binds: { ...ACTING, candidates: 'set' } },
  { name: 'nothing_happens', binds: ACTING },
  { name: 'unremarkable', binds: { thing: 'object' } },
  { name: 'unseen', binds: {} },
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
