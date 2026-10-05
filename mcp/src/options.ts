import { SEED_MAX } from '@overstory/sprout/lang';

import type { Listen } from './serve.js';
import type { SessionOptions } from './session.js';

// What `sprout mcp <dir>` is told on its command line: the session's
// host-side settings (`--seed`, `--record`, `--turn-cap`,
// `--advance-per-turn`) and where to serve (`--http host:port`, stdio
// otherwise). Each is refused in words that say what to write instead.
// With no `--seed`, a session is seeded from the clock, so live play
// draws differently each time; the seed is recorded, so it replays.

/** Flags as the command line reads them: `--name value`, or `--name` alone. */
export type Flags = Readonly<Record<string, string | true>>;

const UNITS: Readonly<Record<string, number>> = {
  s: 1,
  second: 1,
  seconds: 1,
  m: 60,
  minute: 60,
  minutes: 60,
  h: 3600,
  hour: 3600,
  hours: 3600,
};

/** `30s`, `2m`, `1h` or `40 minutes`, in seconds; null where it is none of them. */
export function secondsIn(written: string): number | null {
  const match = /^(\d+)\s*([a-z]+)$/.exec(written.trim());
  const each = match === null ? undefined : UNITS[match[2]!];
  return each === undefined ? null : Number(match![1]) * each;
}

/** A whole number at least `least`, from `--name`; thrown where it is not one. */
function whole(flags: Flags, name: string, least: number, example: string): number | undefined {
  const value = flags[name];
  if (value === undefined) return undefined;
  if (value === true || !/^\d+$/.test(value) || Number(value) < least) {
    throw new Error(
      `--${name} wants a whole number${least > 0 ? ` from ${least}` : ''}: --${name} ${example}`,
    );
  }
  return Number(value);
}

/** What the host sets for the session, read from `flags`; the seed, where none is given, from `now` in milliseconds. */
export function sessionOptions(flags: Flags, now: () => number = Date.now): SessionOptions {
  const given = whole(flags, 'seed', 0, '7');
  if (given !== undefined && given > SEED_MAX) {
    throw new Error(`--seed wants a whole number from 0 to ${SEED_MAX}: --seed 7`);
  }
  const seed = given ?? now() % (SEED_MAX + 1);
  const turnCap = whole(flags, 'turn-cap', 1, '200');
  const record = flags['record'];
  if (record === true) throw new Error('--record wants a file after it: --record run.json');
  const advance = flags['advance-per-turn'];
  let advancePerTurn: number | undefined;
  if (advance !== undefined) {
    const seconds = advance === true ? null : secondsIn(advance);
    if (seconds === null) {
      throw new Error('--advance-per-turn wants how long each turn takes: --advance-per-turn 30s');
    }
    advancePerTurn = seconds;
  }
  return {
    seed,
    ...(record === undefined ? {} : { record }),
    ...(turnCap === undefined ? {} : { turnCap }),
    ...(advancePerTurn === undefined ? {} : { advancePerTurn }),
  };
}

/** Where to serve, read from `flags`: `--http host:port`, or stdio. */
export function listenAt(flags: Flags): Listen {
  const http = flags['http'];
  if (http === undefined) return { stdio: true };
  const match = http === true ? null : /^(?:(.+):)?(\d+)$/.exec(http);
  const port = match === null ? NaN : Number(match[2]);
  if (match === null || port > 65535) {
    throw new Error('--http wants where to listen: --http 127.0.0.1:4711, or --http 4711');
  }
  return { host: match[1] ?? '127.0.0.1', port };
}
