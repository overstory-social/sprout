import { describe, expect, it } from 'vitest';

import { resolveScript, writeReadings, type ReadStep } from './readings.js';
import { scriptOf } from './fixtures/scripts.js';
import { bundleOf, KILN_YARD } from './fixtures/worlds.js';

const bundle = bundleOf('kiln_yard', KILN_YARD);
const resolve = (lines: string) => resolveScript(bundle, scriptOf(lines), 'yard.json');

function commandOf(step: ReadStep | undefined) {
  if (step === undefined || step.kind !== 'command') throw new Error('not a command step');
  return step;
}

describe('resolveScript', () => {
  it('carries the verb, the actor and each role’s filler by id for a line the parser read', () => {
    const readings = resolve('@arrive Marta\nMarta> fire kiln\n');
    const [turn] = commandOf(readings.steps[1]).turns;
    expect(turn).toMatchObject({
      typed: 'fire kiln',
      skip: false,
      verb: 'kiln_yard.fire',
      refused: false,
      fillers: [{ role: 'target', binds: 'object', id: 'kiln_yard.yard.kiln', name: 'yard.kiln' }],
    });
    expect(turn?.skip === false && turn.actor).toMatch(/^kiln_yard#/);
  });

  it('marks a line the parser answered instead of reading, so the other runtime skips it', () => {
    const readings = resolve('@arrive Marta\nMarta> sing loudly\nMarta> fire kiln\n');
    const [answered] = commandOf(readings.steps[1]).turns;
    expect(answered).toMatchObject({ typed: 'sing loudly', skip: true });
    expect(answered?.skip === true && answered.why).not.toBe('faulted');
    const [read] = commandOf(readings.steps[2]).turns;
    expect(read?.skip).toBe(false);
  });

  it('keeps a reading the consent pass refused as a reading to run, flagged as refused', () => {
    const readings = resolve('@arrive Marta\nMarta> fire kiln\nMarta> fire kiln\n');
    const [first] = commandOf(readings.steps[1]).turns;
    const [second] = commandOf(readings.steps[2]).turns;
    expect(first).toMatchObject({ skip: false, refused: false });
    expect(second).toMatchObject({ skip: false, refused: true, verb: 'kiln_yard.fire' });
  });

  it('records the clock and seed each step begins under, and the seed a script sets', () => {
    const readings = resolve('@seed 7\n@arrive Marta\n@advance 40 minutes\nMarta> fire kiln\n');
    expect(readings.steps.map((step) => [step.kind, step.now, step.seed])).toEqual([
      ['seed', 0, 0],
      ['arrive', 0, 7],
      ['advance', 0, 7],
      ['command', 2400, 7],
    ]);
    expect(readings.steps[2]).toMatchObject({ kind: 'advance', seconds: 2400 });
  });

  it('numbers the turns of one line with consecutive seeds', () => {
    const readings = resolve('@seed 4294967295\n@arrive Marta\nMarta> fire kiln and kick kiln\n');
    const { turns } = commandOf(readings.steps[2]);
    expect(turns.map((turn) => turn.seed)).toEqual([4294967295, 0]);
  });

  it('writes one step to a line, and the file reads back as the same readings', () => {
    const readings = resolve('@arrive Marta\nMarta> fire kiln\n');
    const text = writeReadings(readings);
    expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(readings)));
    expect(text.split('\n').filter((line) => line.startsWith('    {'))).toHaveLength(2);
  });
});
