// A write turn's draws (the spec's Chance › The seed). Every `chance`,
// `random` and `{one of}` a turn makes comes from one stream, begun from
// the seed the host drew and recorded for the turn, and taken in the
// order the turn runs, so replaying the turn with its seed makes every
// draw again. Nothing else is random: nothing reads the clock or the
// platform's generator. A poll has no stream, and neither does a body
// that decides, so a draw there is the engine's defect.
//
// The generator is mulberry32 over a 32-bit state, and a draw below n
// rejects the values past the largest multiple of n, so every result is
// equally likely.

/** Where draws come from: an integer from 0 to `n` − 1, each equally likely. */
export interface Draw {
  below(n: number): number;
}

/** The largest seed: a seed is a whole number from 0 to this. */
export const SEED_MAX = 0xffff_ffff;

const RANGE = 0x1_0000_0000;

/** A turn's one stream of draws, from its seed. */
export class Draws implements Draw {
  private state: number;
  /** How many draws have been made. */
  private made = 0;

  constructor(seed: number) {
    if (!Number.isInteger(seed) || seed < 0 || seed > SEED_MAX) {
      throw new Error(`\`${seed}\` is not a seed: a seed is a whole number from 0 to ${SEED_MAX}.`);
    }
    this.state = seed;
  }

  /** How many draws the turn has made so far. */
  get drawn(): number {
    return this.made;
  }

  below(n: number): number {
    if (!Number.isInteger(n) || n < 1 || n > RANGE) {
      throw new Error(`a draw below \`${n}\` reached the stream, which the checker refuses.`);
    }
    this.made += 1;
    const limit = RANGE - (RANGE % n);
    for (;;) {
      const value = this.next();
      if (value < limit) return value % n;
    }
  }

  /** The next 32 bits of the stream. */
  private next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }
}
