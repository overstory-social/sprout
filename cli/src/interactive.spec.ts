import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { checkWorld } from './check.js';
import { playInteractively } from './interactive.js';
import { playScript } from './play.js';
import { captured, KILN_YARD, LANE, worldFolder } from './testing.js';

const kilnYard = checkWorld(worldFolder('kiln_yard', KILN_YARD)).bundle!;
const lane = checkWorld(worldFolder('lane', LANE)).bundle!;
const asScript = (script: string) => playScript(kilnYard, script).page;

describe('playInteractively', () => {
  it('admits Inspector, unless told another name, prints what they read, and prompts nothing more when stdin is empty', async () => {
    const io = captured('');
    expect(await playInteractively(kilnYard, {}, io)).toBe(0);
    expect(io.out()).toBe(asScript('@arrive Inspector\n@leave Inspector\n'));
  });

  it('plays typed lines and host events one at a time, equal to the same lines played as a script', async () => {
    const typed = 'Marta> fire kiln\n@tick\n@advance 2 hours\nMarta> look\n';
    const io = captured(typed);
    expect(await playInteractively(kilnYard, { nickname: 'Marta' }, io)).toBe(0);
    expect(io.out()).toBe(asScript(`@arrive Marta\n${typed}@leave Marta\n`));
  });

  it('addresses a bare line to whoever most recently arrived and still stands', async () => {
    const io = captured('fire kiln\n@arrive Ines\nlook\n@leave Marta\nlook\n');
    expect(await playInteractively(kilnYard, { nickname: 'Marta' }, io)).toBe(0);
    expect(io.out()).toBe(
      asScript(
        '@arrive Marta\nMarta> fire kiln\n@arrive Ines\nInes> look\n@leave Marta\nInes> look\n@leave Ines\n',
      ),
    );
  });

  it('ends the session with a departure turn for whoever is left, on Ctrl-D', async () => {
    const io = captured('fire kiln\n');
    expect(await playInteractively(kilnYard, { nickname: 'Marta' }, io)).toBe(0);
    expect(io.out()).toBe(asScript('@arrive Marta\nMarta> fire kiln\n@leave Marta\n'));
  });

  it('seats a returning visitor where --at names, as sprout parse does', async () => {
    const io = captured('go out\n');
    expect(await playInteractively(lane, { at: 'shed', nickname: 'Marta' }, io)).toBe(0);
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
    expect(await playInteractively(lane, { nickname: 'crate' }, io)).toBe(0);
    expect(io.out()).toBe(
      '@arrive crate\n  nickname refused: "crate" is a word this world already reads, ' +
        'so "crate" would not always mean you: choose another nickname.\n',
    );
  });

  it('refuses a place --at cannot seat a visitor at, naming what to write instead, admitting nobody', async () => {
    const io = captured('look\n');
    expect(await playInteractively(lane, { at: 'loft' }, io)).toBe(1);
    expect(io.err()).toContain('write one of its places');
    expect(io.out()).toBe('');
  });

  it('refuses a malformed typed line, naming where, and stops there', async () => {
    const io = captured('@dance\n');
    expect(await playInteractively(kilnYard, { nickname: 'Marta' }, io)).toBe(1);
    expect(io.err()).toBe(
      'sprout: stdin:2: `@dance` is not something the host does here. ' +
        'Write `@arrive`, `@leave`, `@tick`, `@advance` or `@seed`.\n',
    );
  });

  it('does not echo the typed line itself where stdin is a real terminal, since its own echo already shows it', async () => {
    const io = captured('fire kiln\n');
    (io.stdin as unknown as { isTTY: boolean }).isTTY = true;
    expect(await playInteractively(kilnYard, { nickname: 'Marta' }, io)).toBe(0);
    expect(io.out()).not.toContain('Marta> fire kiln');
    expect(io.out()).toContain('Marta> ');
    expect(io.out()).toContain('Marta (said): The chamber takes the flame.');
  });

  it('plays on past everyone leaving, since a host line needs no addressee to revive the session', async () => {
    const io = captured('@leave Marta\n@arrive Ines\nlook\n');
    expect(await playInteractively(kilnYard, { nickname: 'Marta' }, io)).toBe(0);
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
    const played = playInteractively(kilnYard, { nickname: 'Marta' }, io);
    await new Promise((resolve) => setImmediate(resolve));
    expect(out).toBe('@arrive Marta\n  Marta (described): A kiln yard.\nMarta> ');
    stdin.write('fire kiln\n');
    await new Promise((resolve) => setImmediate(resolve));
    expect(out).toContain('Marta (said): The chamber takes the flame.');
    stdin.end();
    expect(await played).toBe(0);
  });
});
