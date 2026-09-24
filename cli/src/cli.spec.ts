import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { generateSkill } from '@overstory/sprout/lang';

import { USAGE, main, parseArgs } from './cli.js';
import { captured, LANE, worldFolder } from './testing.js';

describe('parseArgs', () => {
  it('reads a command, positionals, --flag value, --flag=value and --flag alone', () => {
    expect(parseArgs(['check', 'world', '--author', 'marta', '--json', '--x=1'])).toEqual({
      command: 'check',
      positional: ['world'],
      flags: { author: 'marta', json: true, x: '1' },
    });
    expect(parseArgs([])).toEqual({ command: null, positional: [], flags: {} });
  });
});

describe('main', () => {
  it('prints the usage and fails with no command, succeeds on help, names an unknown command', () => {
    const none = captured();
    expect(main([], none)).toBe(1);
    expect(none.out()).toBe(USAGE);
    const help = captured();
    expect(main(['help'], help)).toBe(0);
    expect(help.out()).toBe(USAGE);
    const bad = captured();
    expect(main(['frobnicate'], bad)).toBe(1);
    expect(bad.err()).toContain('no such command "frobnicate"');
  });

  it('skill prints the reference this compiler generates, with the usage of this command line in it', () => {
    const io = captured();
    expect(main(['skill'], io)).toBe(0);
    expect(io.out()).toBe(generateSkill({ usage: USAGE }));
    expect(io.out()).toContain(`## Checking what you wrote\n\n\`\`\`text\n${USAGE}\`\`\``);
    expect(io.err()).toBe('');
  });

  it('init then check and test: what init writes passes both', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'sprout-cli-')), 'shed');
    const init = captured();
    expect(main(['init', dir, '--author', 'marta'], init)).toBe(0);
    expect(init.out()).toBe(
      `wrote ${dir}/sprout.json\nwrote ${dir}/shed.sprout\nwrote ${dir}/person.sprout\nwrote ${dir}/tests/arrival.txt\nwrote ${dir}/README.md\n`,
    );
    expect(JSON.parse(readFileSync(join(dir, 'sprout.json'), 'utf8'))).toMatchObject({
      name: 'shed',
      author: 'marta',
      files: ['shed.sprout', 'person.sprout'],
    });
    const check = captured();
    expect(main(['check', dir], check)).toBe(0);
    expect(check.out()).toBe('ok: 3 declarations in 2 files\n');
    const test = captured();
    expect(main(['test', dir], test)).toBe(0);
    expect(test.out()).toBe('arrival.txt: passed, 1 expected line said\n\n1 test: passed\n');
  });

  it('check --json on a broken world fails and names the problem by file, line and column', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'sprout-cli-')), 'broken');
    main(['init', dir, '--author', 'marta'], captured());
    const io = captured();
    expect(main(['check', join(dir, 'nowhere')], io)).toBe(1);
    expect(io.err()).toContain('no such folder');
  });

  it('a folder without a manifest is refused by name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sprout-cli-'));
    const io = captured();
    expect(main(['check', dir], io)).toBe(1);
    expect(io.err()).toContain('no sprout.json here');
  });

  it('parse with no line lists the grammar; with one, reads it where --at stands the visitor', () => {
    const dir = worldFolder('lane', LANE);
    const grammar = captured();
    expect(main(['parse', dir], grammar)).toBe(0);
    expect(grammar.out()).toMatch(/^lane accepts these phrases/);
    const line = captured();
    expect(main(['parse', dir, 'go out', '--at', 'shed'], line)).toBe(0);
    expect(line.out()).toBe(
      'in shed, "go out" reads as sprout.go\n  way: exit out "back to the yard" -> yard\nevery participant consents\n',
    );
  });

  it('view shows where --at stands the visitor, as --as names them', () => {
    const dir = worldFolder('lane', LANE);
    const io = captured();
    expect(main(['view', dir, '--at=shed', '--as', 'Marta'], io)).toBe(0);
    expect(io.out()).toMatch(/^standing in shed\n\ndescription\n {2}Tools hang in rows\.\n/);
  });

  it('parse and view on a refused world print what check prints, and fail', () => {
    const dir = worldFolder('lane', { ...LANE, 'dial.sprout': 'kind Dial {\n' });
    for (const argv of [
      ['parse', dir],
      ['parse', dir, 'look'],
      ['view', dir],
    ]) {
      const io = captured();
      expect(main(argv, io)).toBe(1);
      expect(io.out()).toContain('dial.sprout:');
      expect(io.out()).toMatch(/refused: \d+ problems?\n$/);
    }
  });

  it('refuses a place or a nickname it cannot stand a visitor as, saying what to write instead', () => {
    const dir = worldFolder('lane', LANE);
    const nowhere = captured();
    expect(main(['view', dir, '--at', 'loft'], nowhere)).toBe(1);
    expect(nowhere.err()).toContain('write one of its places');
    const bare = captured();
    expect(main(['view', dir, '--at'], bare)).toBe(1);
    expect(bare.err()).toBe(
      'sprout: --at wants a place after it, as the world names it: --at hall\n',
    );
    const named = captured();
    expect(main(['parse', dir, 'look', '--as'], named)).toBe(1);
    expect(named.err()).toBe('sprout: --as wants a nickname after it: --as Marta\n');
  });

  it('play prints the transcript a script makes, and wants a script and a line it can play', () => {
    const dir = worldFolder('lane', LANE);
    const script = join(mkdtempSync(join(tmpdir(), 'sprout-play-')), 'walk.txt');
    writeFileSync(script, '@arrive Marta\nMarta> go in\n');
    const io = captured();
    expect(main(['play', dir, script], io)).toBe(0);
    expect(io.out()).toBe(
      '@arrive Marta\n  Marta (described): A muddy yard.\nMarta> go in\n  Marta (described): Tools hang in rows.\n',
    );
    const none = captured();
    expect(main(['play', dir], none)).toBe(1);
    expect(none.err()).toContain('play wants a script after the folder');
    writeFileSync(script, 'go in\n');
    const bad = captured();
    expect(main(['play', dir, script], bad)).toBe(1);
    expect(bad.err()).toMatch(/^sprout: walk\.txt:1: a line is what someone types/);
  });

  it('test runs the world’s own tests and exits 1 on a failure, printing what the world said instead', () => {
    const dir = worldFolder('lane', LANE);
    mkdirSync(join(dir, 'tests'));
    writeFileSync(
      join(dir, 'tests', 'walk.txt'),
      '@arrive Marta\nMarta> go in\n  Tools hang in rows.\n',
    );
    const io = captured();
    expect(main(['test', dir], io)).toBe(0);
    expect(io.out()).toBe('walk.txt: passed, 1 expected line said\n\n1 test: passed\n');
    const other = join(mkdtempSync(join(tmpdir(), 'sprout-test-')), 'shed.txt');
    writeFileSync(other, '@arrive Marta\nMarta> go in\n  A muddy yard.\n');
    const failing = captured();
    expect(main(['test', dir, other], failing)).toBe(1);
    expect(failing.out()).toMatch(
      /^shed\.txt: failed\n {2}line 2, after `Marta> go in`, the world did not say:\n {4}A muddy yard\.\n {2}it said:\n {4}Marta \(described\): Tools hang in rows\.\n[^]*\n1 test: 0 passed, 1 failed\n$/,
    );
    const none = captured();
    expect(main(['test', worldFolder('lane', LANE)], none)).toBe(1);
    expect(none.err()).toMatch(/^sprout: no tests in .*tests: write a script there/);
  });
});
