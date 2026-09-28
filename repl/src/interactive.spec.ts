import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { playScript, readScript } from '@overstory/sprout-player';
import {
  bundleOf,
  KILN_YARD,
  LANE,
  scriptOf,
  transcriptOf,
} from '@overstory/sprout-player/fixtures';

import { captured } from './fixtures/io.js';
import { playInteractively } from './interactive.js';

const kilnYard = bundleOf('kiln_yard', KILN_YARD);
const lane = bundleOf('lane', LANE);
const asScript = (lines: string) =>
  transcriptOf(playScript(kilnYard, scriptOf(lines), 'yard.json'));

describe('playInteractively with debug, which prints what a script of the same lines prints', () => {
  it('admits Inspector, unless told another name, prints what they read, and prompts nothing more when stdin is empty', async () => {
    const io = captured('');
    expect(await playInteractively(kilnYard, { debug: true }, io)).toBe(0);
    expect(io.out()).toBe(asScript('@arrive Inspector\n@leave Inspector\n'));
  });

  it('plays typed lines and host events one at a time, equal to the same lines played as a script', async () => {
    const typed = 'Marta> fire kiln\n@tick\n@advance 2 hours\nMarta> look\n';
    const io = captured(typed);
    expect(await playInteractively(kilnYard, { nickname: 'Marta', debug: true }, io)).toBe(0);
    expect(io.out()).toBe(asScript(`@arrive Marta\n${typed}@leave Marta\n`));
  });

  it('addresses a bare line to whoever most recently arrived and still stands', async () => {
    const io = captured('fire kiln\n@arrive Ines\nlook\n@leave Marta\nlook\n');
    expect(await playInteractively(kilnYard, { nickname: 'Marta', debug: true }, io)).toBe(0);
    expect(io.out()).toBe(
      asScript(
        '@arrive Marta\nMarta> fire kiln\n@arrive Ines\nInes> look\n@leave Marta\nInes> look\n@leave Ines\n',
      ),
    );
  });

  it('ends the session with a departure turn for whoever is left, on Ctrl-D', async () => {
    const io = captured('fire kiln\n');
    expect(await playInteractively(kilnYard, { nickname: 'Marta', debug: true }, io)).toBe(0);
    expect(io.out()).toBe(asScript('@arrive Marta\nMarta> fire kiln\n@leave Marta\n'));
  });

  it('seats a returning visitor where --at names, as sprout parse does', async () => {
    const io = captured('go out\n');
    expect(await playInteractively(lane, { at: 'shed', nickname: 'Marta', debug: true }, io)).toBe(
      0,
    );
    expect(io.out()).toBe(
      [
        '@arrive Marta',
        '  Marta (described): Tools hang in rows.',
        'Marta> go out',
        '  Marta (described): A muddy yard.',
        '@leave Marta',
        '  Marta (notice): You leave, and take what you carry with you.',
        '',
      ].join('\n'),
    );
  });

  it('prints a refusal and admits nobody where a nickname collides, ending the session quietly', async () => {
    const io = captured('look\n');
    expect(await playInteractively(lane, { nickname: 'crate', debug: true }, io)).toBe(0);
    expect(io.out()).toBe(
      '@arrive crate\n  nickname refused: "crate" is a word this world already reads, ' +
        'so "crate" would not always mean you: choose another nickname.\n',
    );
  });

  it('refuses a place --at cannot seat a visitor at, naming what to write instead, admitting nobody', async () => {
    const io = captured('look\n');
    expect(await playInteractively(lane, { at: 'loft', debug: true }, io)).toBe(1);
    expect(io.err()).toContain('write one of its places');
    expect(io.out()).toBe('');
  });

  it('refuses a malformed typed line, naming where, and stops there', async () => {
    const io = captured('@dance\n');
    expect(await playInteractively(kilnYard, { nickname: 'Marta', debug: true }, io)).toBe(1);
    expect(io.err()).toBe(
      'sprout: stdin:2: `@dance` is not something the host does here. ' +
        'Write `@arrive`, `@leave`, `@tick`, `@advance` or `@seed`.\n',
    );
  });

  it('does not echo the typed line itself where stdin is a real terminal, since its own echo already shows it', async () => {
    const io = captured('fire kiln\n');
    (io.stdin as unknown as { isTTY: boolean }).isTTY = true;
    expect(await playInteractively(kilnYard, { nickname: 'Marta', debug: true }, io)).toBe(0);
    expect(io.out()).not.toContain('Marta> fire kiln');
    expect(io.out()).toContain('Marta> ');
    expect(io.out()).toContain('Marta (said): The chamber takes the flame.');
  });

  it('plays on past everyone leaving, since a host line needs no addressee to revive the session', async () => {
    const io = captured('@leave Marta\n@arrive Ines\nlook\n');
    expect(await playInteractively(kilnYard, { nickname: 'Marta', debug: true }, io)).toBe(0);
    expect(io.out()).toBe(
      asScript('@arrive Marta\n@leave Marta\n@arrive Ines\nInes> look\n@leave Ines\n'),
    );
  });

  it('writes the prompt before reading a line, not after, so a real terminal shows it while waiting', async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const stdin = new PassThrough();
    let out = '';
    stdout.on('data', (c: Buffer | string) => (out += c.toString()));
    const io = { stdout, stderr, stdin };
    (io.stdin as unknown as { isTTY: boolean }).isTTY = true;
    const played = playInteractively(kilnYard, { nickname: 'Marta', debug: true }, io);
    await new Promise((resolve) => setImmediate(resolve));
    expect(out).toBe('@arrive Marta\n  Marta (described): A kiln yard.\nMarta> ');
    stdin.write('fire kiln\n');
    await new Promise((resolve) => setImmediate(resolve));
    expect(out).toContain('Marta (said): The chamber takes the flame.');
    stdin.end();
    expect(await played).toBe(0);
  });
});

describe('playInteractively, as a player plays', () => {
  const LEFT = 'You leave, and take what you carry with you.';

  it('shows only the prose the visitor reads, one paragraph to a line, with no label and no host line', async () => {
    const io = captured('');
    expect(await playInteractively(kilnYard, {}, io)).toBe(0);
    expect(io.out()).toBe(`A kiln yard.\n${LEFT}\n`);
  });

  it('echoes a typed line where stdin is not a terminal, then what it made', async () => {
    const io = captured('fire kiln\n');
    expect(await playInteractively(kilnYard, { nickname: 'Marta' }, io)).toBe(0);
    expect(io.out()).toBe(
      `A kiln yard.\nMarta> fire kiln\nThe chamber takes the flame.\n${LEFT}\n`,
    );
  });

  it('hides the host’s notes, keeping what the world tells the visitor', async () => {
    const io = captured('fire kiln\n@advance 2 hours\n');
    expect(await playInteractively(kilnYard, { nickname: 'Marta' }, io)).toBe(0);
    expect(io.out()).toContain('@advance 2 hours\nThe kiln ticks as it cools.\n');
    expect(io.out()).not.toContain('woke');
    expect(io.out()).not.toContain('Marta (');
  });

  it('shows a fault as the world’s `fault` line and the fault’s name, never its detail', async () => {
    const io = captured('kick kiln\n');
    expect(await playInteractively(kilnYard, { nickname: 'Marta' }, io)).toBe(0);
    expect(io.out()).toBe(
      'A kiln yard.\nMarta> kick kiln\n' +
        'Something in this world has gone wrong, and nothing has changed.\n' +
        `[error] IntegerOverflow\n${LEFT}\n`,
    );
  });

  it('hands the screen to whoever arrives, and shows someone else’s line as the world’s `acted`', async () => {
    const io = captured('@arrive Ines\nMarta> fire kiln\nlook\n');
    expect(await playInteractively(kilnYard, { nickname: 'Marta' }, io)).toBe(0);
    expect(io.out()).toBe(
      [
        'A kiln yard.',
        '@arrive Ines',
        'A kiln yard.',
        'Marta> fire kiln',
        'Marta tries to fire kiln.',
        'Ines> look',
        'A kiln yard.',
        LEFT,
        '',
      ].join('\n'),
    );
  });

  it('shows a refusal at the door in its own words, and admits nobody', async () => {
    const io = captured('look\n');
    expect(await playInteractively(lane, { nickname: 'crate' }, io)).toBe(0);
    expect(io.out()).toBe(
      '"crate" is a word this world already reads, ' +
        'so "crate" would not always mean you: choose another nickname.\n',
    );
  });

  it('prompts on a real terminal without echoing, since the terminal already shows the line', async () => {
    const io = captured('fire kiln\n');
    (io.stdin as unknown as { isTTY: boolean }).isTTY = true;
    expect(await playInteractively(kilnYard, { nickname: 'Marta' }, io)).toBe(0);
    expect(io.out()).toBe(`A kiln yard.\nMarta> The chamber takes the flame.\nMarta> \n${LEFT}\n`);
  });
});

describe('playInteractively with record', () => {
  const recording = () => join(mkdtempSync(join(tmpdir(), 'sprout-record-')), 'session.json');

  it('writes the session as a script, each step expecting all it made, which plays back as written', async () => {
    const file = recording();
    const typed = 'fire kiln\n@arrive Ines\nMarta> look\n@tick\n# done\n';
    const io = captured(typed);
    expect(await playInteractively(kilnYard, { nickname: 'Marta', record: file }, io)).toBe(0);
    const recorded = readScript(readFileSync(file, 'utf8'), 'session.json');
    expect(recorded.steps.map((step) => Object.keys(step)[0])).toEqual([
      'arrive',
      'as',
      'arrive',
      'as',
      'tick',
      'comment',
      'leave',
    ]);
    expect(recorded.steps[1]).toEqual({
      as: 'Marta',
      type: 'fire kiln',
      expect: [{ reader: 'Marta', kind: 'said', words: 'The chamber takes the flame.' }],
    });
    expect(playScript(kilnYard, recorded, 'session.json')).toEqual(recorded);
  });

  it('prints with --debug exactly the transcript of what it records', async () => {
    const file = recording();
    const io = captured('fire kiln\n@advance 2 hours\n@leave Marta\n@arrive Ines\nlook\n');
    expect(
      await playInteractively(kilnYard, { nickname: 'Marta', debug: true, record: file }, io),
    ).toBe(0);
    expect(io.out()).toBe(transcriptOf(readScript(readFileSync(file, 'utf8'), 'session.json')));
  });

  it('keeps what played before a line it refuses', async () => {
    const file = recording();
    const io = captured('fire kiln\n@dance\n');
    expect(await playInteractively(kilnYard, { nickname: 'Marta', record: file }, io)).toBe(1);
    const recorded = readScript(readFileSync(file, 'utf8'), 'session.json');
    expect(recorded.steps).toHaveLength(2);
  });

  it('refuses --at, since a script brings everyone in where visitors arrive', async () => {
    const io = captured('look\n');
    expect(await playInteractively(lane, { at: 'shed', record: recording() }, io)).toBe(1);
    expect(io.err()).toContain('--record cannot keep --at');
  });
});
