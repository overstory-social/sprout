import { describe, expect, it } from 'vitest';

import { resolveScript } from './readings.js';
import { firstDifference, traceOf, whereDifferent, type TraceStep } from './replay.js';
import { scriptOf } from './fixtures/scripts.js';
import { bundleOf, KILN_YARD } from './fixtures/worlds.js';

const readings = resolveScript(
  bundleOf('kiln_yard', KILN_YARD),
  scriptOf('@arrive Marta\nMarta> fire kiln\nMarta> sing loudly\n'),
  'yard.json',
);

/** The trace a runtime that played `readings` exactly would write. */
function faithful(): Map<number, TraceStep> {
  const steps = new Map<number, TraceStep>();
  for (const step of readings.steps) {
    if (step.after === undefined) continue;
    steps.set(step.index, {
      step: step.index,
      says: step.after.says,
      turns: step.after.turns,
      world: step.after.world,
    });
  }
  return steps;
}

describe('traceOf', () => {
  it('reads one step to a line, by its index', () => {
    const trace = traceOf(
      '{"step":2,"says":[],"turns":[],"world":{}}\n{"step":5,"says":[],"turns":[],"world":{}}\n',
    );
    expect([...trace.keys()]).toEqual([2, 5]);
  });

  it('names the line that is not JSON', () => {
    expect(() => traceOf('{"step":1}\nnot json\n')).toThrow(/line 2 of the trace is not JSON/);
  });
});

describe('whereDifferent', () => {
  it('is null for the same thing, whatever order an object keeps its keys in', () => {
    expect(whereDifferent({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBeNull();
  });

  it('names the path to the first difference, and what each side has', () => {
    expect(whereDifferent({ a: { b: [1, 2] } }, { a: { b: [1, 3] } })).toBe(
      'a.b[1] is 3 where the TypeScript runtime has 2',
    );
    expect(whereDifferent({ a: 1 }, {})).toBe('a is nothing where the TypeScript runtime has 1');
  });
});

describe('firstDifference', () => {
  it('finds nothing in a runtime that left behind what the TypeScript runtime did', () => {
    expect(firstDifference(readings, faithful())).toBeNull();
  });

  it('counts a step the play never reached as a difference', () => {
    const trace = faithful();
    trace.delete(1);
    expect(firstDifference(readings, trace)).toBe('step 1 was never reached');
  });

  it('names the first line a reader read differently', () => {
    const trace = faithful();
    const step = trace.get(0)!;
    trace.set(0, {
      ...step,
      says: step.says.map((said, at) => (at === 0 ? { ...said, words: 'Nothing.' } : said)),
    });
    expect(firstDifference(readings, trace)).toMatch(
      /^step 0 line 1: sproutc says Marta \(described\): Nothing\. and the TypeScript runtime says Marta \(described\): /,
    );
  });

  it('names the turn the log entry differs in, and where', () => {
    const trace = faithful();
    const step = trace.get(1)!;
    trace.set(1, { ...step, turns: step.turns.map((turn) => ({ ...turn, seed: turn.seed + 1 })) });
    expect(firstDifference(readings, trace)).toMatch(
      /^step 1, the log's entry for turn 1 \(command\): seed is 1 where the TypeScript runtime has 0$/,
    );
  });

  it('notices a turn one runtime ran and the other did not', () => {
    const trace = faithful();
    const step = trace.get(1)!;
    trace.set(1, { ...step, turns: [] });
    expect(firstDifference(readings, trace)).toMatch(
      /^step 1 ran 0 turns in sproutc and 1 in the TypeScript runtime/,
    );
  });

  it('names a stored world that differs', () => {
    const trace = faithful();
    const step = trace.get(1)!;
    trace.set(1, { ...step, world: { ...(step.world as object), serial: 99 } });
    expect(firstDifference(readings, trace)).toMatch(
      /^step 1, the stored world: serial is 99 where/,
    );
  });
});
