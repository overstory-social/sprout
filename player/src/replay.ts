import type { Readings, Said, TurnEntry } from './readings.js';

// The comparison half of the differential replay: what `sproutc play --trace` wrote after each step, read
// back, and what the TypeScript runtime left behind the same step (`readings.ts`, `After`): the lines
// readers read, the entry the log keeps of each turn that ran, and the stored world. A turn the parser
// answered rather than read is echoed by the other runtime as it was recorded, so it compares as itself.

/** One step as the other runtime's trace holds it. */
export interface TraceStep {
  readonly step: number;
  readonly says: readonly Said[];
  readonly turns: readonly TurnEntry[];
  readonly world: unknown;
}

/** The steps a trace holds, by index; thrown, saying which line, where one is not JSON. */
export function traceOf(printed: string): Map<number, TraceStep> {
  const steps = new Map<number, TraceStep>();
  printed.split('\n').forEach((line, at) => {
    if (line === '') return;
    let parsed: TraceStep;
    try {
      parsed = JSON.parse(line) as TraceStep;
    } catch (err) {
      throw new Error(
        `line ${at + 1} of the trace is not JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    steps.set(parsed.step, parsed);
  });
  return steps;
}

/** `value` shown on one line, cut where it runs long. */
function shown(value: unknown): string {
  const text = JSON.stringify(value) ?? 'nothing';
  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
}

/** Where `got` first differs from `want`, as a path into them, in words; null where they are the same. */
export function whereDifferent(want: unknown, got: unknown, path = ''): string | null {
  if (want === got) return null;
  const here = path === '' ? 'it' : path;
  if (Array.isArray(want) && Array.isArray(got)) {
    for (let at = 0; at < Math.max(want.length, got.length); at++) {
      const found = whereDifferent(want[at], got[at], `${path}[${at}]`);
      if (found !== null) return found;
    }
    return null;
  }
  if (
    typeof want === 'object' &&
    want !== null &&
    typeof got === 'object' &&
    got !== null &&
    !Array.isArray(want) &&
    !Array.isArray(got)
  ) {
    const keys = new Set([...Object.keys(want), ...Object.keys(got)]);
    for (const key of [...keys].sort()) {
      const found = whereDifferent(
        (want as Record<string, unknown>)[key],
        (got as Record<string, unknown>)[key],
        path === '' ? key : `${path}.${key}`,
      );
      if (found !== null) return found;
    }
    return null;
  }
  return `${here} is ${shown(got)} where the TypeScript runtime has ${shown(want)}`;
}

/** A line as a page shows it: `Marta (said): You take a brass key.` */
function lineOf(said: Said): string {
  return `${said.reader} (${said.kind}): ${said.words}`;
}

/**
 * The first way the trace differs from what the TypeScript runtime left behind each step of `readings`, in
 * words naming the step and what differs; null where they agree. A step the play never reached is a
 * difference.
 */
export function firstDifference(
  readings: Readings,
  trace: ReadonlyMap<number, TraceStep>,
): string | null {
  for (const step of readings.steps) {
    const { after } = step;
    if (after === undefined) continue;
    const got = trace.get(step.index);
    if (got === undefined) return `step ${step.index} was never reached`;
    for (let at = 0; at < Math.max(after.says.length, got.says.length); at++) {
      const want = after.says[at];
      const said = got.says[at];
      if (want === undefined || said === undefined || lineOf(want) !== lineOf(said)) {
        return `step ${step.index} line ${at + 1}: sproutc says ${said === undefined ? '(nothing)' : lineOf(said)} and the TypeScript runtime says ${want === undefined ? '(nothing)' : lineOf(want)}`;
      }
    }
    for (let at = 0; at < Math.max(after.turns.length, got.turns.length); at++) {
      const want = after.turns[at];
      const turn = got.turns[at];
      if (want === undefined || turn === undefined) {
        return `step ${step.index} ran ${got.turns.length} turns in sproutc and ${after.turns.length} in the TypeScript runtime; ${turn === undefined ? `the log has no entry for the ${want!.kind} turn` : `sproutc logged an extra ${turn.kind} turn`}`;
      }
      const found = whereDifferent(want, turn);
      if (found !== null)
        return `step ${step.index}, the log's entry for turn ${at + 1} (${want.kind}): ${found}`;
    }
    const world = whereDifferent(after.world, got.world);
    if (world !== null) return `step ${step.index}, the stored world: ${world}`;
  }
  return null;
}
