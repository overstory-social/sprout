// Levels (the spec's The runtime › Levels): the five a record is at,
// whether a turn produced it or the host kept it. A record's level is
// fixed by what it is, and a level only filters: nothing a turn reads or
// writes depends on one.

/** The five levels, from what a person playing reads to everything in full. */
export const LEVELS = ['prose', 'error', 'warning', 'info', 'debug'] as const;
export type Level = (typeof LEVELS)[number];

/** Whether `value` is one of the five levels. */
export function isLevel(value: unknown): value is Level {
  return typeof value === 'string' && (LEVELS as readonly string[]).includes(value);
}

/**
 * Whether a view asking for records up to `upTo` keeps one at `level`:
 * play asks up to `error`, and `debug` keeps everything.
 */
export function keeps(upTo: Level, level: Level): boolean {
  return LEVELS.indexOf(level) <= LEVELS.indexOf(upTo);
}
