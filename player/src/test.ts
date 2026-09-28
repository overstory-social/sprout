import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import type { Bundle } from '@overstory/sprout/lang';

import { playSteps, type Made, type PlayedStep } from './play.js';
import { lineOf, readScript, shownExpectation, type Expectation } from './script.js';

// `sprout test`: an author's own tests of their world. A test is a script
// `sprout play` plays, each on a freshly loaded world, and a step's
// `expect` is what the author expects it to make. Each expected line must
// be among what the step made, in the order written: a reader's line
// whole, or the words alone, which any reader reading them matches; `[]`
// expects silence. A step with no `expect` is played and not checked,
// except that a turn which faults fails the test unless the fault is
// expected. So a script `sprout play` filled in is a test that passes,
// and an author accepts what the world says by keeping it.

/** A test to run: its name as the page shows it, and its script. */
export interface TestFile {
  readonly name: string;
  readonly text: string;
}

/** What running the tests gave: whether every one passed, and the page saying so. */
export interface Tested {
  readonly ok: boolean;
  readonly page: string;
}

/**
 * The tests in `dir`: the files named, or every `.json` in the world's
 * `tests` folder by name; thrown, saying what to write, where there are none.
 */
export function testFiles(dir: string, named: readonly string[]): TestFile[] {
  if (named.length > 0) {
    return named.map((file) => ({ name: basename(file), text: readFileSync(file, 'utf8') }));
  }
  const folder = join(dir, 'tests');
  const files = existsSync(folder)
    ? readdirSync(folder)
        .filter((file) => file.endsWith('.json'))
        .sort()
    : [];
  if (files.length === 0) {
    throw new Error(
      `no tests in ${folder}: write a script there, as in \`${join(folder, 'first.json')}\`: ` +
        '`{ "steps": [{ "arrive": "Marta" }, { "as": "Marta", "type": "look", "expect": [{ "words": "…" }] }] }`.',
    );
  }
  return files.map((file) => ({ name: file, text: readFileSync(join(folder, file), 'utf8') }));
}

/** Whether `expected`, as an author wrote it, is `made`. */
function matches(expected: Expectation, made: Made): boolean {
  if ('level' in expected) {
    return made.words === null && made.text === expected.text && made.level === expected.level;
  }
  if ('reader' in expected) {
    return (
      made.reader === expected.reader &&
      made.kind === expected.kind &&
      made.words === expected.words
    );
  }
  return made.words === expected.words;
}

/** `made` as the page shows what a step said: its transcript lines, or `(nothing)`. */
function said(made: readonly Made[]): string[] {
  return [
    'it said:',
    ...(made.length === 0 ? ['(nothing)'] : made.map((one) => one.text)).map((line) => `  ${line}`),
  ];
}

/** What is wrong with one played step against what it expects; empty where nothing is. */
function problems(played: PlayedStep, at: number): string[] {
  const { step, made } = played;
  if (made === null) return [];
  const where = `step ${at}, \`${lineOf(step)}\``;
  const expect = 'expect' in step ? step.expect : undefined;
  if (expect !== undefined && expect.length === 0) {
    return made.length === 0 ? [] : [`${where}, expected silence, and`, ...said(made)];
  }
  const written = expect ?? [];
  const missing: Expectation[] = [];
  let from = 0;
  for (const expected of written) {
    const found = made.findIndex((one, i) => i >= from && matches(expected, one));
    if (found < 0) missing.push(expected);
    else from = found + 1;
  }
  if (missing.length > 0) {
    const order = written.length > 1 ? ', in the order written' : '';
    return [
      `${where}, the world did not say${order}:`,
      ...missing.map((expected) => `  ${shownExpectation(expected)}`),
      ...said(made),
    ];
  }
  const faults = made.filter(
    (one) => one.level === 'error' && !written.some((expected) => matches(expected, one)),
  );
  if (faults.length > 0) {
    return [`${where}, a turn faulted, and nothing the step expects is the fault:`, ...said(made)];
  }
  return [];
}

/** One test, run: the lines the page says of it, and whether it passed. */
function runOne(bundle: Bundle, test: TestFile): { passed: boolean; lines: string[] } {
  let played: PlayedStep[];
  try {
    played = playSteps(bundle, readScript(test.text, test.name), test.name);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return { passed: false, lines: [`${test.name}: could not be played`, `  ${why}`] };
  }
  const found = played.flatMap((one, i) => problems(one, i + 1));
  if (found.length > 0) {
    return { passed: false, lines: [`${test.name}: failed`, ...found.map((line) => `  ${line}`)] };
  }
  const expected = played.reduce(
    (sum, { step }) =>
      sum + ('expect' in step && step.expect !== undefined ? Math.max(step.expect.length, 1) : 0),
    0,
  );
  if (expected === 0) {
    return {
      passed: false,
      lines: [
        `${test.name}: failed, since it expects nothing and would pass whatever the world said`,
        '  give a step what the world should say, as in `"expect": [{ "words": "You take the brass key." }]`',
      ],
    };
  }
  const plural = expected === 1 ? 'line' : 'lines';
  return { passed: true, lines: [`${test.name}: passed, ${expected} expected ${plural} said`] };
}
/** Run each test on a freshly loaded `bundle`: a line for each, what each failure said instead, and a count. */
export function runTests(bundle: Bundle, tests: readonly TestFile[]): Tested {
  const results = tests.map((test) => runOne(bundle, test));
  const failed = results.filter((result) => !result.passed).length;
  const count = `${tests.length} test${tests.length === 1 ? '' : 's'}`;
  const page = [...results.flatMap((result) => result.lines), ''];
  if (failed === 0) page.push(`${count}: ${tests.length === 1 ? 'passed' : 'all passed'}`);
  else {
    page.push(
      'Where the world is right and a test is not, `sprout play` prints the script with what the world says now filled in.',
      `${count}: ${tests.length - failed} passed, ${failed} failed`,
    );
  }
  return { ok: failed === 0, page: page.map((line) => `${line}\n`).join('') };
}
