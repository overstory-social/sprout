import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { playScript } from './play.js';
import { writeScript, type Script, type Step } from './script.js';
import { runTests, testFiles, type Tested } from './test.js';
import { scriptOf } from './fixtures/scripts.js';
import { bundleOf, KILN_YARD } from './fixtures/worlds.js';

const bundle = bundleOf('kiln_yard', KILN_YARD);
const run = (...scripts: (Script | string)[]) =>
  runTests(
    bundle,
    scripts.map((script, i) => ({
      name: `t${i + 1}.json`,
      text: typeof script === 'string' ? script : writeScript(script),
    })),
  );
const steps = (...all: Step[]): Script => ({ steps: all });
/** Whether the tests passed, and the page, without the runs it was made from. */
const pageOf = ({ ok, page }: Tested) => ({ ok, page });
const ARRIVE: Step = { arrive: 'Marta' };
const OVERFLOW =
  'the command faulted, IntegerOverflow: 2147483648 is outside the integer range, -2147483648 to 2147483647.';

const HINT =
  'Where the world is right and a test is not, `sprout play` prints the script with what the world says now filled in.\n';

describe('runTests', () => {
  it('passes where every expected line was said, whole or as the words alone', () => {
    const tested = run(
      steps(
        ARRIVE,
        {
          arrive: 'Ines',
          expect: [
            { words: 'Ines arrives.' },
            { reader: 'Ines', kind: 'described', words: 'A kiln yard.' },
          ],
        },
        { as: 'Marta', type: 'fire kiln', expect: [{ words: 'The chamber takes the flame.' }] },
      ),
    );
    expect(pageOf(tested)).toEqual({
      ok: true,
      page: 't1.json: passed, 3 expected lines said\n\n1 test: passed\n',
    });
  });

  it('passes a script `sprout play` filled in, so accepting what the world says is keeping it', () => {
    const played = playScript(
      bundle,
      scriptOf('@arrive Marta\nMarta> fire kiln\nMarta> fire kiln\n@advance 2 hours\n@tick\n'),
      'walk.json',
    );
    expect(run(played).ok).toBe(true);
  });

  it('fails a step whose expected words were not said, naming the step and what it said instead', () => {
    const tested = run(
      steps(
        ARRIVE,
        { as: 'Marta', type: 'fire kiln', expect: [{ words: 'The kiln roars.' }] },
        { as: 'Marta', type: 'go in' },
      ),
    );
    expect(pageOf(tested)).toEqual({
      ok: false,
      page:
        't1.json: failed\n' +
        '  step 2, `Marta> fire kiln`, the world did not say:\n' +
        '    The kiln roars.\n' +
        '  it said:\n' +
        '    Marta (said): The chamber takes the flame.\n' +
        '\n' +
        HINT +
        '1 test: 0 passed, 1 failed\n',
    });
  });

  it('holds expected lines to the order written, and to the reader and kind named', () => {
    const arrives = { reader: 'Marta', kind: 'notice', words: 'Ines arrives.' };
    const described = { reader: 'Ines', kind: 'described', words: 'A kiln yard.' };
    expect(run(steps(ARRIVE, { arrive: 'Ines', expect: [described, arrives] })).page).toContain(
      'the world did not say, in the order written:\n    Marta (notice): Ines arrives.\n  it said:\n',
    );
    expect(
      run(steps(ARRIVE, { arrive: 'Ines', expect: [{ ...arrives, reader: 'Ines' }] })).ok,
    ).toBe(false);
    expect(run(steps(ARRIVE, { arrive: 'Ines', expect: [{ ...arrives, kind: 'told' }] })).ok).toBe(
      false,
    );
    expect(run(steps(ARRIVE, { arrive: 'Ines', expect: [arrives, described] })).ok).toBe(true);
  });

  it('expects silence with an empty `expect`, which fails wherever the step said anything', () => {
    expect(run(steps(ARRIVE, { as: 'Marta', type: 'go in' }, { tick: true, expect: [] })).ok).toBe(
      true,
    );
    const page = run(steps(ARRIVE, { tick: true, expect: [] })).page;
    expect(page).toMatch(
      /step 2, `@tick`, expected silence, and\n {2}it said:\n {4}Marta \(told\): (Smoke drifts\.|The air is still\.)\n/,
    );
  });

  it('fails a turn that faults unless the fault is expected, at error', () => {
    const faulted = run(
      steps(
        { arrive: 'Marta', expect: [{ words: 'A kiln yard.' }] },
        { as: 'Marta', type: 'kick kiln' },
      ),
    );
    expect(faulted.ok).toBe(false);
    expect(faulted.page).toBe(
      't1.json: failed\n' +
        '  step 2, `Marta> kick kiln`, a turn faulted, and nothing the step expects is the fault:\n' +
        '  it said:\n' +
        '    Marta (notice): Something in this world has gone wrong, and nothing has changed.\n' +
        `    ${OVERFLOW}\n` +
        '\n' +
        HINT +
        '1 test: 0 passed, 1 failed\n',
    );
    const kicked = (level: 'info' | 'error') =>
      run(steps(ARRIVE, { as: 'Marta', type: 'kick kiln', expect: [{ level, text: OVERFLOW }] }));
    expect(kicked('error').ok).toBe(true);
    expect(kicked('info').ok).toBe(false);
  });

  it('matches a host note at info, and never by its words alone', () => {
    const fired = (expect: Script['steps'][number]) =>
      run(steps(ARRIVE, { as: 'Marta', type: 'fire kiln' }, expect));
    const woke = 'yard.kiln woke, 3600 seconds after it asked';
    expect(fired({ advance: '2 hours', expect: [{ level: 'info', text: woke }] }).ok).toBe(true);
    expect(fired({ advance: '2 hours', expect: [{ words: woke }] }).ok).toBe(false);
  });

  it('fails a test that expects nothing, since it would pass whatever the world said', () => {
    expect(run(steps(ARRIVE, { as: 'Marta', type: 'fire kiln' })).page).toBe(
      't1.json: failed, since it expects nothing and would pass whatever the world said\n' +
        '  give a step what the world should say, as in `"expect": [{ "words": "You take the brass key." }]`\n' +
        '\n' +
        HINT +
        '1 test: 0 passed, 1 failed\n',
    );
  });

  it('reports a script it cannot read or play as that test failing, and runs the rest', () => {
    const tested = run(
      steps(ARRIVE, { as: 'Ines', type: 'look' }),
      '{ "steps": [{ "arrive": "Marta", "expect": "A kiln yard." }] }',
      steps({ arrive: 'Marta', expect: [{ words: 'A kiln yard.' }] }),
    );
    expect(tested.page).toBe(
      't1.json: could not be played\n' +
        '  t1.json, step 2: Ines is not in the world: write `@arrive Ines` first.\n' +
        't2.json: could not be played\n' +
        '  t2.json, step 1: `expect` is a list of lines, or `[]` for silence.\n' +
        't3.json: passed, 1 expected line said\n' +
        '\n' +
        HINT +
        '3 tests: 1 passed, 2 failed\n',
    );
  });

  it('plays each test on a freshly loaded world, so one test’s turns never reach another', () => {
    const fired = steps(ARRIVE, {
      as: 'Marta',
      type: 'fire kiln',
      expect: [{ words: 'The chamber takes the flame.' }],
    });
    expect(pageOf(run(fired, fired))).toEqual({
      ok: true,
      page: 't1.json: passed, 1 expected line said\nt2.json: passed, 1 expected line said\n\n2 tests: all passed\n',
    });
  });
});

describe('testFiles', () => {
  it('reads every .json in the world’s tests folder, by name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sprout-tests-'));
    mkdirSync(join(dir, 'tests'));
    writeFileSync(join(dir, 'tests', 'b.json'), 'B');
    writeFileSync(join(dir, 'tests', 'a.json'), 'A');
    writeFileSync(join(dir, 'tests', 'notes.md'), 'not a test');
    expect(testFiles(dir, [])).toEqual([
      { name: 'a.json', text: 'A' },
      { name: 'b.json', text: 'B' },
    ]);
  });

  it('reads the scripts named instead, wherever they are', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sprout-tests-'));
    writeFileSync(join(dir, 'walk.json'), 'W');
    expect(testFiles('elsewhere', [join(dir, 'walk.json')])).toEqual([
      { name: 'walk.json', text: 'W' },
    ]);
  });

  it('says where to write a test where there are none', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sprout-tests-'));
    expect(() => testFiles(dir, [])).toThrow(
      `no tests in ${join(dir, 'tests')}: write a script there, as in \`${join(dir, 'tests', 'first.json')}\``,
    );
  });
});

describe('the runs a test page is made from', () => {
  it('are every test that could be played, passed or failed, as played, under its name', () => {
    const passing = playScript(bundle, scriptOf('@arrive Marta\nMarta> fire kiln'), 'a.json');
    const failing = steps(ARRIVE, { as: 'Marta', type: 'look', expect: [{ words: 'Nothing.' }] });
    const tested = runTests(bundle, [
      { name: 'a.json', text: writeScript(passing) },
      { name: 'b.json', text: writeScript(failing) },
      { name: 'c.json', text: 'not a script' },
    ]);
    expect(tested.ok).toBe(false);
    expect(tested.runs.map((one) => [one.name, one.played.length])).toEqual([
      ['a.json', 2],
      ['b.json', 2],
    ]);
  });
});
