// The closed set of directions an exit may lead in, each with its usual
// abbreviation (the spec's Verbs › Exits). A bare direction is `go`, and
// the engine reads both the direction and its abbreviation; `in` and
// `out` have no shorter form.

export const DIRECTIONS = [
  'north',
  'south',
  'east',
  'west',
  'northeast',
  'northwest',
  'southeast',
  'southwest',
  'up',
  'down',
  'in',
  'out',
] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** Each direction's usual abbreviation, where it has one. */
export const ABBREVIATIONS: ReadonlyMap<string, Direction> = new Map<string, Direction>([
  ['n', 'north'],
  ['s', 'south'],
  ['e', 'east'],
  ['w', 'west'],
  ['ne', 'northeast'],
  ['nw', 'northwest'],
  ['se', 'southeast'],
  ['sw', 'southwest'],
  ['u', 'up'],
  ['d', 'down'],
]);

/** The direction one typed word names, written out or abbreviated; null where it names none. */
export function directionOf(word: string): Direction | null {
  if ((DIRECTIONS as readonly string[]).includes(word)) return word as Direction;
  return ABBREVIATIONS.get(word) ?? null;
}
