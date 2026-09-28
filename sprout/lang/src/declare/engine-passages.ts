// The passages the engine says for itself, and what it binds when it
// does (the spec's Prose › Engine lines; Properties › Where types come
// from). Each line is written by one of the standard library's kinds —
// the world's by `sprout.World`, a place's notices by `sprout.Place`, the
// inventory by `sprout.Actor` — and is found, when the engine says it, on
// the one it is about, then that one's place, then the world. A passage
// of a line's name is checked against exactly what the engine binds: the
// person acting and their place, as `actor` and `here` are in a body that
// binds them, an object, the readings `help` offers, or text; a name the engine may leave unbound is read only inside
// `{if bound …}`. A line a poll says, in place of a description or a
// view, draws nothing.

/**
 * What the engine binds a name to when it says a line: the one acting,
 * their place, an object, the readings `help` offers, each rendering as
 * the words a visitor types for it, or text.
 */
export type EngineBinds = 'actor' | 'here' | 'object' | 'readings' | 'text';

/** One line the engine says, and the names it says it with. */
export interface EnginePassage {
  readonly name: string;
  readonly binds: Readonly<Record<string, EngineBinds>>;
  /** The names among `binds` the engine leaves unbound where there is nothing to bind, each with why. */
  readonly optional?: Readonly<Record<string, string>>;
  /** Said by a poll, which draws nothing (the spec's Chance › The seed). */
  readonly polled?: true;
}

/** Why a move may have no `way`. */
const NO_WAY = 'a move that goes through no exit or link has no way';

/** Who is acting and where, as the engine binds them for a line said to the one acting. */
const ACTING = { actor: 'actor', here: 'here' } as const;

/** The world's own lines, whose defaults `sprout.World` writes. */
export const WORLD_LINES = [
  { name: 'unknown', binds: ACTING },
  { name: 'not_here', binds: ACTING },
  { name: 'meant', binds: { ...ACTING, thing: 'object' } },
  { name: 'nothing_happens', binds: ACTING },
  { name: 'unremarkable', binds: { thing: 'object' }, polled: true },
  { name: 'unseen', binds: {}, polled: true },
  { name: 'fault', binds: ACTING },
  { name: 'missing', binds: {} },
  { name: 'displaced', binds: {} },
  { name: 'inside_itself', binds: { item: 'object' } },
  { name: 'crowded', binds: { item: 'object', to: 'object' } },
  { name: 'waited', binds: {} },
  { name: 'help', binds: { ...ACTING, readings: 'readings' } },
  { name: 'acted', binds: { actor: 'actor', reading: 'text' }, polled: true },
  { name: 'gone_away', binds: { actor: 'actor' } },
  { name: 'npc_says', binds: { actor: 'actor', words: 'text' } },
] as const satisfies readonly EnginePassage[];

/** A place's notices of someone arriving and leaving, whose defaults `sprout.Place` writes. */
export const PLACE_LINES = [
  {
    name: 'arrives',
    binds: { item: 'object', from: 'object', way: 'text' },
    optional: { from: 'someone coming into the world comes from no place', way: NO_WAY },
  },
  {
    name: 'leaves',
    binds: { item: 'object', to: 'object', way: 'text' },
    optional: { to: 'someone leaving the world goes to no place', way: NO_WAY },
  },
] as const satisfies readonly EnginePassage[];

/** What `inventory` says, whose default `sprout.Actor` writes (the spec's Engine verbs). */
export const ACTOR_LINES = [
  { name: 'inventory', binds: ACTING },
] as const satisfies readonly EnginePassage[];

/** Every line the engine says. */
export const ENGINE_LINES: readonly EnginePassage[] = [
  ...WORLD_LINES,
  ...PLACE_LINES,
  ...ACTOR_LINES,
];

/** Every line the engine says, by name. */
export type EngineLineName = (
  typeof WORLD_LINES | typeof PLACE_LINES | typeof ACTOR_LINES
)[number]['name'];

/** Which of the standard library's kinds writes a line's default. */
export type LineOwner = 'World' | 'Place' | 'Actor';

/** The kind of the standard library's that writes `name`'s default. */
export function ownerOf(name: EngineLineName): LineOwner {
  if (PLACE_LINES.some((line) => line.name === name)) return 'Place';
  if (ACTOR_LINES.some((line) => line.name === name)) return 'Actor';
  return 'World';
}
