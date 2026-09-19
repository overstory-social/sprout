import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { main } from './cli.js';
import { play } from './play.js';
import { captured } from './testing.js';

// `sprout play`, driven by a script on stdin, through BOTH example
// archives with the memory store: the room on arrival, a verb answered,
// `help` from the room's grammar, an exit taken, a miss, `quit` — the
// transcript as the terminal prints it. Then PGlite: a session that
// survives the process, and `--fresh` that does not.

const EXAMPLES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'sprout-examples');
const NOW = new Date('2026-09-18T12:00:00Z');

describe('play', () => {
  it('the pottery studio: arrival, a verb, help, an exit, a miss, quit', async () => {
    const io = captured(['put the kettle on', 'help', 'out to the kiln yard', 'dance', 'quit']);
    const code = await play({
      archive: join(EXAMPLES, 'pottery-studio'),
      as: 'marta',
      store: 'memory',
      input: io.stdin,
      output: io.stdout,
      now: () => NOW,
    });
    expect(code).toBe(0);
    const out = io.out();
    expect(out).toContain('(loaded 26 files as pottery-studio)');
    expect(out).toContain('== The Front Room ==');
    expect(out).toContain('You can see bench, guest book, kettle, shelf of finished ware here.');
    expect(out).toContain('Ways on: through to the wheel room;');
    expect(out).toContain('> put the kettle on');
    expect(out).toMatch(/> help\nHere you might: .*And always: look, examine, take, drop/);
    expect(out).toContain('== The Kiln Yard ==');
    expect(out).toContain('> dance\n');
    expect(out).toContain('> quit\n');
    // the script's lines answered in order: the yard comes after help, the miss after the yard
    expect(out.indexOf('== The Kiln Yard ==')).toBeGreaterThan(out.indexOf('> help'));
    expect(out.indexOf('> dance')).toBeGreaterThan(out.indexOf('== The Kiln Yard =='));
  });

  it('the wanderer’s shed, and the end of input is a leave', async () => {
    const io = captured(['look']);
    expect(
      await play({
        archive: join(EXAMPLES, 'wanderers-shed'),
        as: 'wanderer',
        store: 'memory',
        input: io.stdin,
        output: io.stdout,
        now: () => NOW,
      }),
    ).toBe(0);
    expect(io.out()).toContain('(loaded');
    expect(io.out().match(/== .* ==/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('an archive that does not check is not played; one without a door neither', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sprout-play-'));
    const io = captured([]);
    expect(await main(['play', dir, '--store', 'memory'], io)).toBe(1);
    expect(io.out()).toContain('No door here');
  });

  it('PGlite: the session survives the process; --fresh puts the world back; the state sits in --state', async () => {
    const state = mkdtempSync(join(tmpdir(), 'sprout-state-'));
    const run = (lines: string[], extra: string[] = []) => {
      const io = captured(lines);
      return main(
        ['play', join(EXAMPLES, 'pottery-studio'), '--as', 'marta', '--state', state, ...extra],
        io,
      ).then((code) => ({ code, out: io.out() }));
    };
    const first = await run(['put the kettle on', 'quit']);
    expect(first.code).toBe(0);
    expect(first.out).toContain('(loaded');
    // …the kettle is on when marta comes back, and the archive is not loaded again
    const second = await run(['examine kettle', 'quit']);
    expect(second.out).not.toContain('(loaded');
    expect(second.out).toMatch(/> examine kettle\n.*(steam|boil|hiss|warm|hot|on)/i);
    const fresh = await run(['examine kettle', 'quit'], ['--fresh']);
    expect(fresh.out).not.toMatch(/> examine kettle\n.*(steam|boil)/i);
  }, 60_000);
});
