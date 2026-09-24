import { describe, expect, it } from 'vitest';

import { checkWorld } from './check.js';
import { heard, playLines, playScript } from './play.js';
import { KILN_YARD, worldFolder } from './testing.js';

const bundle = checkWorld(worldFolder('kiln_yard', KILN_YARD)).bundle!;
const play = (script: string): string => playScript(bundle, script, 'yard.txt').page;

describe('playScript', () => {
  it('writes each line, then what every reader read of it, under their nickname and the kind', () => {
    expect(play('@arrive Marta\n@arrive Ines\nMarta> fire kiln\nMarta> fire kiln\n')).toBe(
      [
        '@arrive Marta',
        '  Marta (described): A kiln yard.',
        '@arrive Ines',
        '  Marta (notice): Ines arrives.',
        '  Ines (described): A kiln yard.',
        'Marta> fire kiln',
        '  Marta (said): The chamber takes the flame.',
        'Marta> fire kiln',
        '  Marta (refused): It is firing already.',
        '',
      ].join('\n'),
    );
  });

  it('keeps comments and blank lines, and writes what a line made afresh', () => {
    const script =
      '# A walk.\n\n@arrive Marta\n  Marta (said): whatever was here before\nMarta> go in\n';
    expect(play(script)).toBe(
      [
        '# A walk.',
        '',
        '@arrive Marta',
        '  Marta (described): A kiln yard.',
        'Marta> go in',
        '  Marta (described): A dark shed.',
        '',
      ].join('\n'),
    );
  });

  it('is its own golden: a transcript played again plays as written', () => {
    const once = play('@arrive Marta\nMarta> fire kiln\n@tick\n@advance 2 hours\nMarta> look\n');
    expect(play(once)).toBe(once);
  });

  it('ticks each place a visitor stands in, and says so where a tick says nothing', () => {
    expect(play('@arrive Marta\n@tick\nMarta> go in\n@tick\n')).toBe(
      [
        '@arrive Marta',
        '  Marta (described): A kiln yard.',
        '@tick',
        '  Marta (told): Smoke drifts.',
        'Marta> go in',
        '  Marta (described): A dark shed.',
        '@tick',
        '  (nothing)',
        '',
      ].join('\n'),
    );
  });

  it('delivers a wake live at the instant it falls due, while anyone is there', () => {
    const page = play(
      '@arrive Marta\nMarta> fire kiln\n@advance 59 minutes\n@advance 30 minutes\n',
    );
    expect(page).toContain('@advance 59 minutes\n  (nothing)\n');
    expect(page).toContain(
      '@advance 30 minutes\n  yard.kiln woke, 3600 seconds after it asked\n  Marta (told): The kiln ticks as it cools.\n',
    );
  });

  it('keeps a wake for the next arrival’s catch-up while nobody is there, which says nothing', () => {
    const page = play(
      '@arrive Marta\nMarta> fire kiln\n@leave Marta\n@advance 5 hours\n@arrive Marta\nMarta> fire kiln\n',
    );
    expect(page).toContain('@advance 5 hours\n  (nothing)\n');
    expect(page).toContain(
      '@arrive Marta\n  caught up: yard.kiln woke, 18000 seconds after it asked\n  Marta (described): A kiln yard.\n',
    );
    expect(page).toContain('Marta> fire kiln\n  Marta (said): The chamber takes the flame.\n');
  });

  it('gives every turn after `@seed` that seed, and writes nothing for the line itself', () => {
    const seeds = [0, 1, 2, 3, 4, 5, 6, 7];
    // Each is `@seed n`, `@tick`, its line, `@tick`, its line.
    const heard = seeds.map((seed) =>
      play(`@arrive Marta\n@seed ${seed}\n@tick\n@tick\n`).split('\n').slice(2, 7),
    );
    for (const [seed, lines] of heard.entries()) {
      expect(lines.slice(0, 2)).toEqual([`@seed ${seed}`, '@tick']);
      expect(lines[4], `seed ${seed}: each tick draws from the one seed`).toBe(lines[2]);
    }
    expect(new Set(heard.map((lines) => lines[2]))).toEqual(
      new Set(['  Marta (told): Smoke drifts.', '  Marta (told): The air is still.']),
    );
  });

  it('refuses a nickname the world’s words collide with, admitting nobody', () => {
    const page = play('@arrive kiln\n');
    expect(page).toMatch(/^@arrive kiln\n {2}nickname refused: /);
  });

  it('throws, naming the line and what to write, for a line it cannot play', () => {
    expect(() => play('take kiln\n')).toThrow(
      'yard.txt:1: a line is what someone types, as in `Marta> take brass key`',
    );
    expect(() => play('@dance\n')).toThrow(
      'yard.txt:1: `@dance` is not something the host does here.',
    );
    expect(() => play('@advance soon\n')).toThrow(
      'yard.txt:1: write how long passes, as in `@advance 40 minutes`.',
    );
    expect(() => play('@arrive Marta\nInes> look\n')).toThrow(
      'yard.txt:2: Ines is not in the world: write `@arrive Ines` first.',
    );
    expect(() => play('@arrive Marta\n@leave Marta\nMarta> look\n')).toThrow(
      'yard.txt:3: Marta is not in the world',
    );
  });
});

describe('playLines', () => {
  it('keeps what is indented under each line, and marks what a reader read and what faulted', () => {
    const played = playLines(
      bundle,
      '  above everything\n@arrive Marta\n  A kiln yard.\n# aside\n  under a comment\nMarta> kick kiln\n',
      'yard.txt',
    );
    expect(played.before).toEqual([{ at: 1, text: 'above everything' }]);
    expect(played.lines.map(({ at, line, under }) => [at, line, under])).toEqual([
      [2, '@arrive Marta', [{ at: 3, text: 'A kiln yard.' }]],
      [4, '# aside', [{ at: 5, text: 'under a comment' }]],
      [6, 'Marta> kick kiln', []],
    ]);
    const [arrived, aside, kicked] = played.lines;
    expect(arrived!.made).toEqual([
      { text: 'Marta (described): A kiln yard.', words: 'A kiln yard.', fault: false },
    ]);
    expect(aside!.made).toBeNull();
    expect(kicked!.made!.map((made) => [made.words === null, made.fault])).toEqual([
      [false, false],
      [true, true],
    ]);
    expect(kicked!.made![1]!.text).toMatch(/^the command faulted, IntegerOverflow: /);
  });

  it('gives `@seed` nothing made, and a line that made nothing an empty list the page writes as (nothing)', () => {
    const played = playLines(bundle, '@seed 3\n@arrive Marta\nMarta> go in\n@tick\n');
    expect(played.lines.map((line) => line.made?.length ?? null)).toEqual([null, 1, 1, 0]);
    expect(heard([])).toEqual([{ text: '(nothing)', words: null, fault: false }]);
  });
});
