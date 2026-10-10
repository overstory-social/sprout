import { sha256 } from '@overstory/sprout/lang';

// The seed the player gives a tick's or a wake's turn. The spec's Chance ›
// The seed leaves each turn's seed to the host; the player derives it from
// the step's seed and what the turn is for, never from how many turns came
// before it in the step, so adding a clock to a world leaves every other
// object's draws as they were.

/**
 * The seed of the `nth` turn (from 0) a step runs for the thing at `path`,
 * under the step's `seed`: the first eight hex digits of the SHA-256 of
 * `<seed> <path> <nth>` as UTF-8, read as a whole number.
 */
export function turnSeed(seed: number, path: string, nth: number): number {
  return Number.parseInt(sha256(`${seed} ${path} ${nth}`).slice(0, 8), 16);
}
