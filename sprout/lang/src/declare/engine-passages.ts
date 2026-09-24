// The passages the engine says for itself, and what it binds when it
// does (the spec's A worked microworld › The standard library it needs;
// Properties › Where types come from: `thing` in the world's
// `unreachable` and `unremarkable`, `candidates` in its `which`). The
// world's lines are said on the world's kind, a place's notices on the
// place's, and a passage the engine says is checked against exactly what
// it binds there: an object, or a set of objects, by name.

/** What the engine binds a name to when it says a line: an object, or a set of them. */
export type EngineBinds = 'object' | 'set';

/** One line the engine says, and the names it says it with. */
export interface EnginePassage {
  readonly name: string;
  readonly binds: Readonly<Record<string, EngineBinds>>;
}

/** The world's own lines, said on the world's composed kind. */
export const WORLD_LINES: readonly EnginePassage[] = [
  { name: 'unknown', binds: {} },
  { name: 'unreachable', binds: { thing: 'object' } },
  { name: 'which', binds: { candidates: 'set' } },
  { name: 'nothing_happens', binds: {} },
  { name: 'unremarkable', binds: { thing: 'object' } },
  { name: 'unseen', binds: {} },
  { name: 'fault', binds: {} },
  { name: 'missing', binds: {} },
  { name: 'displaced', binds: {} },
  { name: 'inside_itself', binds: { item: 'object' } },
];

/** A place's notices of someone arriving and leaving, said on the place's composed kind. */
export const PLACE_LINES: readonly EnginePassage[] = [
  { name: 'arrives', binds: { item: 'object' } },
  { name: 'leaves', binds: { item: 'object' } },
];
