// What a line draws, the same for every reader (the spec's Chance › The
// forms, The seed). A line is rendered once for each reader, since it
// says "you" to the one it names, and what it draws — a `{one of}`, a
// `chance` in a condition — is drawn from the turn's stream the first
// time it renders and read back every time after, so everyone who hears
// one line hears the same words. What rendering asks of the draws does
// not depend on who reads, so the second reading asks exactly what the
// first did; anything else is the engine's defect.

import type { Draw, Draws } from '../runtime/draws.js';
import type { Line } from './speech.js';

/** Every line's draws in one write turn, each kept by the line it was drawn for. */
export class LineDraws {
  private readonly tapes = new WeakMap<Line, Tape>();

  constructor(private readonly draws: Draws) {}

  /** The draws `line` renders with: new from the turn's stream the first time, read back after. */
  of(line: Line): Draw {
    const kept = this.tapes.get(line);
    if (kept !== undefined) {
      kept.rewind();
      return kept;
    }
    const tape = new Tape(this.draws);
    this.tapes.set(line, tape);
    return tape;
  }
}

/** One line's draws, in the order it asked for them. */
class Tape implements Draw {
  private readonly taken: { readonly n: number; readonly value: number }[] = [];
  private at = 0;

  constructor(private readonly draws: Draws) {}

  rewind(): void {
    this.at = 0;
  }

  below(n: number): number {
    const kept = this.taken[this.at];
    this.at += 1;
    if (kept === undefined) {
      const value = this.draws.below(n);
      this.taken.push({ n, value });
      return value;
    }
    if (kept.n !== n) {
      throw new Error(
        `a line drew below ${n} for one reader where it drew below ${kept.n} for another.`,
      );
    }
    return kept.value;
  }
}
