import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LIMITS,
  generateSkill,
  loadCartridge,
  readCartridgeHeader,
} from '@overstory/sprout/lang';

import { checkWorld } from './check.js';
import { USAGE, main, parseArgs } from './cli.js';
import { playScript, writeScript } from '@overstory/sprout-player';
import {
  KILN_YARD,
  LANE,
  scriptOf,
  transcriptOf,
  worldFolder,
} from '@overstory/sprout-player/fixtures';
import { captured } from '@overstory/sprout-repl/fixtures';

describe('parseArgs', () => {
  it('reads a command, positionals, --flag value, --flag=value and --flag alone', () => {
    expect(parseArgs(['check', 'world', '--author', 'marta', '--json', '--x=1'])).toEqual({
      command: 'check',
      positional: ['world'],
      flags: { author: 'marta', json: true, x: '1' },
    });
    expect(parseArgs([])).toEqual({ command: null, positional: [], flags: {} });
  });

  it('never takes the word after --json or --debug as its value', () => {
    expect(parseArgs(['play', '--debug', 'shed', '--json', 'x'])).toEqual({
      command: 'play',
      positional: ['shed', 'x'],
      flags: { debug: true, json: true },
    });
  });
});

/** What a session of `lines` prints with --debug in the world at `dir`: the transcript of that script played. */
const transcript = (dir: string, lines: string) =>
  transcriptOf(playScript(checkWorld(dir).bundle!, scriptOf(lines), 'yard.json'));

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
    // Generating the skill compiles every example it shows, twice here, which a loaded machine takes seconds over.
  }, 30_000);

  it('scaffold world then check and test: what it writes passes both', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'sprout-cli-')), 'shed');
    const init = captured();
    expect(main(['scaffold', 'world', dir, '--author', 'marta'], init)).toBe(0);
    expect(init.out()).toBe(
      `wrote ${dir}/sprout.json\nwrote ${dir}/shed.sprout\nwrote ${dir}/person.sprout\nwrote ${dir}/tests/arrival.json\nwrote ${dir}/README.md\n`,
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
    expect(test.out()).toBe('arrival.json: passed, 1 expected line said\n\n1 test: passed\n');
  });

  it('check --json on a broken world fails and names the problem by file, line and column', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'sprout-cli-')), 'broken');
    main(['scaffold', 'world', dir, '--author', 'marta'], captured());
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

  it('play prints a script with every step expecting all it made, --write saves it, and a bad one is refused', () => {
    const dir = worldFolder('lane', LANE);
    const script = join(mkdtempSync(join(tmpdir(), 'sprout-play-')), 'walk.json');
    const written = '{ "steps": [{ "arrive": "Marta" }, { "as": "Marta", "type": "go in" }] }\n';
    const filled = writeScript({
      steps: [
        {
          arrive: 'Marta',
          expect: [{ reader: 'Marta', kind: 'described', words: 'A muddy yard.' }],
        },
        {
          as: 'Marta',
          type: 'go in',
          expect: [{ reader: 'Marta', kind: 'described', words: 'Tools hang in rows.' }],
        },
      ],
    });
    writeFileSync(script, written);
    const io = captured();
    expect(main(['play', dir, script], io)).toBe(0);
    expect(io.out()).toBe(filled);
    expect(readFileSync(script, 'utf8')).toBe(written);

    const saved = captured();
    expect(main(['play', dir, script, '--write'], saved)).toBe(0);
    expect(saved.out()).toBe(`wrote ${script}\n`);
    expect(readFileSync(script, 'utf8')).toBe(filled);

    writeFileSync(script, 'Marta> go in\n');
    const bad = captured();
    expect(main(['play', dir, script], bad)).toBe(1);
    expect(bad.err()).toMatch(/^sprout: walk\.json: not JSON: /);
    const missing = captured();
    expect(main(['play', dir, join(dir, 'nowhere.json')], missing)).toBe(1);
    expect(missing.err()).toContain('no such file or directory');
  });

  it('play --report writes what the script reached beside the transcript, which it prints unchanged', () => {
    const dir = worldFolder('lane', LANE);
    const folder = mkdtempSync(join(tmpdir(), 'sprout-play-'));
    const script = join(folder, 'walk.json');
    const report = join(folder, 'reached.json');
    writeFileSync(script, writeScript(scriptOf('@arrive Marta\nMarta> go in\nMarta> xyzzy')));
    const io = captured();
    expect(main(['play', dir, script, '--report', report], io)).toBe(0);
    const plain = captured();
    main(['play', dir, script], plain);
    expect(io.out()).toBe(plain.out());
    const reached = JSON.parse(readFileSync(report, 'utf8'));
    expect(reached.scripts).toEqual(['walk.json']);
    expect(reached.reach.places.reached).toEqual(['yard', 'shed']);
    expect(reached.reach.places.never).toEqual(['attic']);
    expect(reached.reading.unread.map((one: { typed: string }) => one.typed)).toEqual(['xyzzy']);

    const saved = captured();
    expect(main(['play', dir, script, '--write', '--report', report], saved)).toBe(0);
    expect(saved.out()).toBe(`wrote ${script}\nwrote ${report}\n`);
  });

  it('play --report wants a file, and a script to have been played', async () => {
    const dir = worldFolder('lane', LANE);
    const alone = captured();
    expect(main(['play', dir, 'walk.json', '--report'], alone)).toBe(1);
    expect(alone.err()).toBe('sprout: --report wants a file after it: --report reached.json\n');
    const live = captured('look\n');
    expect(await main(['play', dir, '--report', 'reached.json'], live)).toBe(1);
    expect(live.err()).toContain(
      '--report reads a script played: record the session with --record',
    );
  });

  it('mcp on a refused world says what check says on stderr, since stdout is the protocol’s, and fails', async () => {
    const dir = worldFolder('lane', {
      ...LANE,
      'lane.sprout': `${LANE['lane.sprout']}\nkind Broken is Nowhere { }\n`,
    });
    const io = captured();
    expect(await main(['mcp', dir], io)).toBe(1);
    expect(io.out()).toBe('');
    expect(io.err()).toMatch(/lane\.sprout:\d+:\d+[^]*\nrefused: 1 problem\n$/);
  });

  it('play with no script and --record writes the session as a script that plays back as written', async () => {
    const dir = worldFolder('kiln_yard', KILN_YARD);
    const file = join(mkdtempSync(join(tmpdir(), 'sprout-record-')), 'session.json');
    const io = captured('fire kiln\n');
    await expect(main(['play', dir, '--as', 'Marta', '--record', file], io)).resolves.toBe(0);
    const replayed = captured();
    expect(main(['play', dir, file], replayed)).toBe(0);
    expect(replayed.out()).toBe(readFileSync(file, 'utf8'));
    const bare = captured('');
    expect(main(['play', dir, '--record'], bare)).toBe(1);
    expect(bare.err()).toContain('--record wants a file after it');
  });

  it('play with no script shows only the prose the visitor reads, without --debug', async () => {
    const dir = worldFolder('kiln_yard', KILN_YARD);
    const io = captured('fire kiln\n');
    await expect(main(['play', dir, '--as', 'Marta'], io)).resolves.toBe(0);
    expect(io.out()).toBe(
      'A kiln yard.\nMarta> fire kiln\nThe chamber takes the flame.\n' +
        'You leave, and take what you carry with you.\n',
    );
  });

  it('play with no script (or `-`) and --debug prints the transcript, admitting Inspector unless --as names another', async () => {
    const dir = worldFolder('kiln_yard', KILN_YARD);
    const asScript = (lines: string) => transcript(dir, `@arrive Marta\n${lines}@leave Marta\n`);

    const typed = 'Marta> fire kiln\n@tick\n@advance 2 hours\nMarta> look\n';
    const io = captured(typed);
    await expect(main(['play', dir, '--as', 'Marta', '--debug'], io)).resolves.toBe(0);
    expect(io.out()).toBe(asScript(typed));

    const dashed = captured(typed);
    await expect(main(['play', dir, '-', '--as', 'Marta', '--debug'], dashed)).resolves.toBe(0);
    expect(dashed.out()).toBe(asScript(typed));
  });

  it('a bare typed line addresses whoever most recently arrived and still stands', async () => {
    const dir = worldFolder('kiln_yard', KILN_YARD);
    const bare = captured('fire kiln\n@tick\n');
    await expect(main(['play', dir, '--as', 'Marta', '--debug'], bare)).resolves.toBe(0);
    expect(bare.out()).toBe(
      transcript(dir, '@arrive Marta\nMarta> fire kiln\n@tick\n@leave Marta\n'),
    );

    const second = captured('@arrive Ines\nlook\n');
    await expect(main(['play', dir, '--debug', '--as', 'Marta'], second)).resolves.toBe(0);
    expect(second.out()).toBe(
      transcript(dir, '@arrive Marta\n@arrive Ines\nInes> look\n@leave Ines\n'),
    );
  });

  it('ends the session with a departure turn for whoever is left standing, on Ctrl-D', async () => {
    const dir = worldFolder('kiln_yard', KILN_YARD);
    const io = captured('');
    await expect(main(['play', '--debug', dir], io)).resolves.toBe(0);
    expect(io.out()).toBe(transcript(dir, '@arrive Inspector\n@leave Inspector\n'));
  });

  it('refuses a nickname or --at as sprout parse would, admitting nobody', async () => {
    const dir = worldFolder('lane', LANE);
    const refused = captured('');
    await expect(main(['play', dir, '--as', 'crate', '--debug'], refused)).resolves.toBe(0);
    expect(refused.out()).toBe(
      '@arrive crate\n  nickname refused: "crate" is a word this world already reads, so "crate" would not always mean you: choose another nickname.\n',
    );
    const nowhere = captured();
    await expect(main(['play', dir, '--at', 'loft'], nowhere)).resolves.toBe(1);
    expect(nowhere.err()).toContain('write one of its places');
  });

  it('test runs the world’s own tests and exits 1 on a failure, printing what the world said instead', () => {
    const dir = worldFolder('lane', LANE);
    mkdirSync(join(dir, 'tests'));
    const goIn = (words: string) =>
      writeScript({
        steps: [{ arrive: 'Marta' }, { as: 'Marta', type: 'go in', expect: [{ words }] }],
      });
    writeFileSync(join(dir, 'tests', 'walk.json'), goIn('Tools hang in rows.'));
    const io = captured();
    expect(main(['test', dir], io)).toBe(0);
    expect(io.out()).toBe('walk.json: passed, 1 expected line said\n\n1 test: passed\n');
    const other = join(mkdtempSync(join(tmpdir(), 'sprout-test-')), 'shed.json');
    writeFileSync(other, goIn('A muddy yard.'));
    const failing = captured();
    expect(main(['test', dir, other], failing)).toBe(1);
    expect(failing.out()).toMatch(
      /^shed\.json: failed\n {2}step 2, `Marta> go in`, the world did not say:\n {4}A muddy yard\.\n {2}it said:\n {4}Marta \(described\): Tools hang in rows\.\n[^]*\n1 test: 0 passed, 1 failed\n$/,
    );
    const report = join(mkdtempSync(join(tmpdir(), 'sprout-test-')), 'reached.json');
    const reported = captured();
    expect(
      main(['test', dir, join(dir, 'tests', 'walk.json'), other, '--report', report], reported),
    ).toBe(1);
    expect(reported.out()).toMatch(/\n2 tests: 1 passed, 1 failed\nwrote .*reached\.json\n$/);
    // Both played, the failing one too: what they reached between them.
    expect(JSON.parse(readFileSync(report, 'utf8')).scripts).toEqual(['walk.json', 'shed.json']);
    const none = captured();
    expect(main(['test', worldFolder('lane', LANE)], none)).toBe(1);
    expect(none.err()).toMatch(/^sprout: no tests in .*tests: write a script there/);
  });

  it('pack writes the world as a cartridge a runtime loads, and play and test accept it in the folder’s place', () => {
    const dir = worldFolder('lane', LANE);
    mkdirSync(join(dir, 'tests'));
    writeFileSync(
      join(dir, 'tests', 'walk.json'),
      writeScript({
        steps: [
          { arrive: 'Marta' },
          { as: 'Marta', type: 'go in', expect: [{ words: 'Tools hang in rows.' }] },
        ],
      }),
    );
    const file = join(mkdtempSync(join(tmpdir(), 'sprout-pack-')), 'lane.sproutworld');
    const packed = captured();
    expect(main(['pack', dir, '-o', file], packed)).toBe(0);
    expect(packed.out()).toMatch(new RegExp(`^packed lane into ${file}: \\d+ bytes\\n$`));
    const bytes = readFileSync(file);
    expect(readCartridgeHeader(bytes)).toMatchObject({ format: 1 });
    expect(loadCartridge(bytes, { caps: DEFAULT_LIMITS.caps }).declared.size).toBeGreaterThan(0);

    const script = join(dir, 'tests', 'walk.json');
    const fromFolder = captured();
    const fromCartridge = captured();
    expect(main(['play', dir, script], fromFolder)).toBe(0);
    expect(main(['play', file, script], fromCartridge)).toBe(0);
    expect(fromCartridge.out()).toBe(fromFolder.out());
    const tested = captured();
    expect(main(['test', file, script], tested)).toBe(0);
    expect(tested.out()).toBe('walk.json: passed, 1 expected line said\n\n1 test: passed\n');
    const bare = captured();
    expect(main(['test', file], bare)).toBe(1);
    expect(bare.err()).toContain('a cartridge carries no tests: name the scripts');
  });

  it('pack names the file after the world without -o, wants a folder, and refuses a world that does not check', () => {
    const dir = worldFolder('lane', LANE);
    const cwd = process.cwd();
    const into = mkdtempSync(join(tmpdir(), 'sprout-pack-'));
    process.chdir(into);
    try {
      const io = captured();
      expect(main(['pack', dir], io)).toBe(0);
      expect(io.out()).toMatch(/^packed lane into lane\.sproutworld: \d+ bytes\n$/);
      expect(readFileSync(join(into, 'lane.sproutworld')).subarray(0, 4).toString()).toBe('SPRT');
    } finally {
      process.chdir(cwd);
    }
    const bare = captured();
    expect(main(['pack'], bare)).toBe(1);
    expect(bare.err()).toContain('pack wants a world folder');
    const dangling = captured();
    expect(main(['pack', dir, '-o'], dangling)).toBe(1);
    expect(dangling.err()).toContain('-o wants a file');
    const broken = worldFolder('lane', { ...LANE, 'lane.sprout': 'world lane is' });
    const refused = captured();
    expect(main(['pack', broken, '-o', join(into, 'broken.sproutworld')], refused)).toBe(1);
    expect(refused.out() + refused.err()).toContain('lane.sprout');
  });

  it('play refuses a file that is not a cartridge, in words, without a stack', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'sprout-pack-')), 'not.sproutworld');
    writeFileSync(file, 'hello');
    const io = captured();
    expect(main(['play', file, 'x.json'], io)).toBe(1);
    expect(io.out() + io.err()).toContain('not.sproutworld: This is not a Sprout cartridge');
  });
});
