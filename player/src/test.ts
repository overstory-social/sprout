import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import type { Bundle } from '@overstory/sprout/lang';

import { heard, playLines, type Made, type PlayedLine, type Written } from './play.js';

// `sprout test`: an author's own tests of their world. A test is a script
// `sprout play` plays, each on a freshly loaded world, and what the author
// indented under a line is what they expect that line to make. Each
// expected line must be among what the line made, in the order written:
// either the whole line, `Ines (told): Marta takes a brass key.`, or the
// words alone, which any reader reading them matches. A line with nothing
// under it is played and not checked, except that a turn which faults
// fails the test unless the fault is written under it. So a transcript
// `sprout play` printed is a test that passes, and an author accepts what
// the world says by copying it in.

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
 * The tests in `dir`: the files named, or every `.txt` in the world's
 * `tests` folder by name; thrown, saying what to write, where there are none.
 */
export function testFiles(dir: string, named: readonly string[]): TestFile[] {
  if (named.length > 0) {
    return named.map((file) => ({ name: basename(file), text: readFileSync(file, 'utf8') }));
  }
  const folder = join(dir, 'tests');
  const files = existsSync(folder)
    ? readdirSync(folder)
        .filter((file) => file.endsWith('.txt'))
        .sort()
    : [];
  if (files.length === 0) {
    throw new Error(
      `no tests in ${folder}: write a script there, as in \`${join(folder, 'first.txt')}\`, ` +
        'with `@arrive Marta`, then `Marta> look`, then what the world should say indented under it.',
    );
  }
  return files.map((file) => ({ name: file, text: readFileSync(join(folder, file), 'utf8') }));
}

/** Whether `expected`, as an author wrote it, is `made`: the whole line, or a reader's words alone. */
function matches(expected: Written, made: Made): boolean {
  return expected.text === made.text || expected.text === made.words;
}

/** What is wrong with one played line against what was written under it; empty where nothing is. */
function problems(line: PlayedLine): string[] {
  const where = `line ${line.at}, after \`${line.line}\``;
  if (line.made === null) {
    if (line.under.length === 0) return [];
    const what =
      line.line === '' ? 'a blank line' : line.line.startsWith('#') ? 'a comment' : '`@seed`';
    return [
      `line ${line.under[0]!.at}: an indented line is what the line above it made, and ${what} makes nothing; ` +
        'move it under the line that makes it.',
    ];
  }
  const made = heard(line.made);
  const missing: Written[] = [];
  let from = 0;
  for (const expected of line.under) {
    const found = made.findIndex((one, i) => i >= from && matches(expected, one));
    if (found < 0) missing.push(expected);
    else from = found + 1;
  }
  const faults = made.filter(
    (one) => one.fault && !line.under.some((expected) => expected.text === one.text),
  );
  const said = ['it said:', ...made.map((one) => `  ${one.text}`)];
  if (missing.length > 0) {
    const order = line.under.length > 1 ? ', in the order written' : '';
    return [
      `${where}, the world did not say${order}:`,
      ...missing.map((expected) => `  ${expected.text}`),
      ...said,
    ];
  }
  if (faults.length > 0) {
    return [`${where}, a turn faulted, and nothing under the line expects it:`, ...said];
  }
  return [];
}

/** One test, run: the lines the page says of it, and whether it passed. */
function runOne(bundle: Bundle, test: TestFile): { passed: boolean; lines: string[] } {
  let played;
  try {
    played = playLines(bundle, test.text, test.name);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return { passed: false, lines: [`${test.name}: could not be played`, `  ${why}`] };
  }
  const stray = played.before.map(
    (written) =>
      `line ${written.at}: an indented line is what the line above it made, and nothing is above it; ` +
      'move it under the line that makes it.',
  );
  const found = [...stray, ...played.lines.flatMap(problems)];
  if (found.length > 0) {
    return { passed: false, lines: [`${test.name}: failed`, ...found.map((line) => `  ${line}`)] };
  }
  const expected = played.lines.reduce((sum, line) => sum + line.under.length, 0);
  if (expected === 0) {
    return {
      passed: false,
      lines: [
        `${test.name}: failed, since it expects nothing and would pass whatever the world said`,
        '  write what the world should say indented under a line, as in `  You take the brass key.`',
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
      'Where the world is right and a test is not, `sprout play` prints what the world says now, to copy under the line.',
      `${count}: ${tests.length - failed} passed, ${failed} failed`,
    );
  }
  return { ok: failed === 0, page: page.map((line) => `${line}\n`).join('') };
}
