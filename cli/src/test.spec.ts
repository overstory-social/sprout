import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { checkWorld } from './check.js';
import { playScript } from './play.js';
import { runTests, testFiles } from './test.js';
import { KILN_YARD, worldFolder } from './testing.js';

const bundle = checkWorld(worldFolder('kiln_yard', KILN_YARD)).bundle!;
const run = (...texts: string[]) =>
  runTests(
    bundle,
    texts.map((text, i) => ({ name: `t${i + 1}.txt`, text })),
  );

const HINT =
  'Where the world is right and a test is not, `sprout play` prints what the world says now, to copy under the line.\n';

describe('runTests', () => {
  it('passes where every line written under a line was said, whole or as the words alone', () => {
    const tested = run(
      '@arrive Marta\n@arrive Ines\n  Ines arrives.\n  Ines (described): A kiln yard.\nMarta> fire kiln\n  The chamber takes the flame.\n',
    );
    expect(tested).toEqual({
      ok: true,
      page: 't1.txt: passed, 3 expected lines said\n\n1 test: passed\n',
    });
  });

  it('passes a transcript `sprout play` printed, so accepting what the world says is copying it in', () => {
    const transcript = playScript(
      bundle,
      '@arrive Marta\nMarta> fire kiln\nMarta> fire kiln\n@advance 2 hours\n@tick\n',
    ).page;
    expect(run(transcript).ok).toBe(true);
  });

  it('fails a line whose expected words were not said, naming the line and what it said instead', () => {
    const tested = run('@arrive Marta\nMarta> fire kiln\n  The kiln roars.\nMarta> go in\n');
    expect(tested).toEqual({
      ok: false,
      page:
        't1.txt: failed\n' +
        '  line 2, after `Marta> fire kiln`, the world did not say:\n' +
        '    The kiln roars.\n' +
        '  it said:\n' +
        '    Marta (said): The chamber takes the flame.\n' +
        '\n' +
        HINT +
        '1 test: 0 passed, 1 failed\n',
    });
  });

  it('holds expected lines to the order written, and to the reader named', () => {
    const script = '@arrive Marta\n@arrive Ines\n';
    expect(
      run(`${script}  Ines (described): A kiln yard.\n  Marta (notice): Ines arrives.\n`).page,
    ).toContain(
      'the world did not say, in the order written:\n    Marta (notice): Ines arrives.\n  it said:\n',
    );
    expect(run(`${script}  Ines (notice): Ines arrives.\n`).ok).toBe(false);
    expect(
      run(`${script}  Marta (notice): Ines arrives.\n  Ines (described): A kiln yard.\n`).ok,
    ).toBe(true);
  });

  it('expects silence with (nothing), which fails wherever the line said anything', () => {
    expect(run('@arrive Marta\nMarta> go in\n@tick\n  (nothing)\n').ok).toBe(true);
    const page = run('@arrive Marta\n@tick\n  (nothing)\n').page;
    expect(page).toMatch(
      /line 2, after `@tick`, the world did not say:\n {4}\(nothing\)\n {2}it said:\n {4}Marta \(told\): (Smoke drifts\.|The air is still\.)\n/,
    );
  });

  it('fails a turn that faults unless the fault is written under it', () => {
    const faulted = run('@arrive Marta\n  A kiln yard.\nMarta> kick kiln\n');
    expect(faulted.ok).toBe(false);
    expect(faulted.page).toBe(
      't1.txt: failed\n' +
        '  line 3, after `Marta> kick kiln`, a turn faulted, and nothing under the line expects it:\n' +
        '  it said:\n' +
        '    Marta (notice): Something in this world has gone wrong, and nothing has changed.\n' +
        '    the command faulted, IntegerOverflow: 2147483648 is outside the integer range, -2147483648 to 2147483647.\n' +
        '\n' +
        HINT +
        '1 test: 0 passed, 1 failed\n',
    );
    const expected = run(
      '@arrive Marta\nMarta> kick kiln\n  the command faulted, IntegerOverflow: 2147483648 is outside the integer range, -2147483648 to 2147483647.\n',
    );
    expect(expected.ok).toBe(true);
  });

  it('fails a test that expects nothing, since it would pass whatever the world said', () => {
    expect(run('@arrive Marta\nMarta> fire kiln\n').page).toBe(
      't1.txt: failed, since it expects nothing and would pass whatever the world said\n' +
        '  write what the world should say indented under a line, as in `  You take the brass key.`\n' +
        '\n' +
        HINT +
        '1 test: 0 passed, 1 failed\n',
    );
  });

  it('fails an indented line under nothing, a comment, a blank line or `@seed`, saying where it goes', () => {
    const page = run(
      '  A kiln yard.\n@arrive Marta\n# here\n  A kiln yard.\n\n  A kiln yard.\n@seed 2\n  A kiln yard.\n',
    ).page;
    expect(page).toBe(
      't1.txt: failed\n' +
        '  line 1: an indented line is what the line above it made, and nothing is above it; move it under the line that makes it.\n' +
        '  line 4: an indented line is what the line above it made, and a comment makes nothing; move it under the line that makes it.\n' +
        '  line 6: an indented line is what the line above it made, and a blank line makes nothing; move it under the line that makes it.\n' +
        '  line 8: an indented line is what the line above it made, and `@seed` makes nothing; move it under the line that makes it.\n' +
        '\n' +
        HINT +
        '1 test: 0 passed, 1 failed\n',
    );
  });

  it('reports a script it cannot play as that test failing, and runs the rest', () => {
    const tested = run('@arrive Marta\nInes> look\n', '@arrive Marta\n  A kiln yard.\n');
    expect(tested.page).toBe(
      't1.txt: could not be played\n' +
        '  t1.txt:2: Ines is not in the world: write `@arrive Ines` first.\n' +
        't2.txt: passed, 1 expected line said\n' +
        '\n' +
        HINT +
        '2 tests: 1 passed, 1 failed\n',
    );
  });

  it('plays each test on a freshly loaded world, so one test’s turns never reach another', () => {
    const fired = '@arrive Marta\nMarta> fire kiln\n  The chamber takes the flame.\n';
    expect(run(fired, fired)).toEqual({
      ok: true,
      page: 't1.txt: passed, 1 expected line said\nt2.txt: passed, 1 expected line said\n\n2 tests: all passed\n',
    });
  });
});

describe('testFiles', () => {
  it('reads every .txt in the world’s tests folder, by name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sprout-tests-'));
    mkdirSync(join(dir, 'tests'));
    writeFileSync(join(dir, 'tests', 'b.txt'), 'B');
    writeFileSync(join(dir, 'tests', 'a.txt'), 'A');
    writeFileSync(join(dir, 'tests', 'notes.md'), 'not a test');
    expect(testFiles(dir, [])).toEqual([
      { name: 'a.txt', text: 'A' },
      { name: 'b.txt', text: 'B' },
    ]);
  });

  it('reads the scripts named instead, wherever they are', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sprout-tests-'));
    writeFileSync(join(dir, 'walk.txt'), 'W');
    expect(testFiles('elsewhere', [join(dir, 'walk.txt')])).toEqual([
      { name: 'walk.txt', text: 'W' },
    ]);
  });

  it('says where to write a test where there are none', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sprout-tests-'));
    expect(() => testFiles(dir, [])).toThrow(
      `no tests in ${join(dir, 'tests')}: write a script there, as in \`${join(dir, 'tests', 'first.txt')}\`, ` +
        'with `@arrive Marta`, then `Marta> look`, then what the world should say indented under it.',
    );
  });
});
