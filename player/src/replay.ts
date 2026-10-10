import type { Readings } from './readings.js';
import type { Script } from './script.js';

// The comparison half of the differential replay: what `sproutc play`
// printed, read back as one block of lines per step, and what a transcript
// expects, as the same blocks. A block holding a skipped turn (one the
// parser answered, which the other runtime does not run) is unchecked on
// whichever side has it. Only a reader's words are compared today, as
// `<reader>: <words>`.

/** The lines one step printed or is expected to print. */
export interface Block {
  readonly lines: string[];
  unchecked: boolean;
}

/** What a play printed after its `--- play` line, by step index, and the words it stopped on, if it did. */
export function blocksOf(printed: string): {
  blocks: Map<number, Block>;
  stoppedOn: string | null;
} {
  const blocks = new Map<number, Block>();
  const rest = printed.split('--- play\n')[1] ?? '';
  let current: Block | null = null;
  let stoppedOn: string | null = null;
  for (const line of rest.split('\n')) {
    if (line === '') continue;
    const step = /^## step (\d+): /.exec(line);
    if (step !== null) {
      current = { lines: [], unchecked: false };
      blocks.set(Number(step[1]), current);
    } else if (line.startsWith('!! ')) stoppedOn = line.slice(3);
    else if (current !== null && line.startsWith('-- skipped')) current.unchecked = true;
    else if (current !== null) current.lines.push(line);
  }
  return { blocks, stoppedOn };
}

/** The lines `script` expects, by step index, each reader's line as `<reader>: <words>`. */
export function expectedBlocks(script: Script, readings: Readings): Map<number, Block> {
  const blocks = new Map<number, Block>();
  for (const step of readings.steps) {
    if (step.kind === 'comment' || step.kind === 'seed') continue;
    const written = script.steps[step.index];
    const expect = written !== undefined && 'expect' in written ? (written.expect ?? []) : [];
    blocks.set(step.index, {
      lines: expect.flatMap((one) => ('reader' in one ? [`${one.reader}: ${one.words}`] : [])),
      unchecked: step.kind === 'command' && step.turns.some((turn) => turn.skip),
    });
  }
  return blocks;
}

/**
 * The first way `actual` differs from `expected`, in words naming its step;
 * null where they agree. A step the play never reached is a difference.
 */
export function firstDifference(
  expected: ReadonlyMap<number, Block>,
  actual: ReadonlyMap<number, Block>,
): string | null {
  for (const [index, want] of expected) {
    const got = actual.get(index);
    if (got === undefined) return `step ${index} was never reached`;
    if (want.unchecked || got.unchecked) continue;
    if (want.lines.join('\n') !== got.lines.join('\n')) {
      return `step ${index} said\n${got.lines.join('\n') || '(nothing)'}\nand the transcript has\n${want.lines.join('\n') || '(nothing)'}`;
    }
  }
  return null;
}
