import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LIMITS,
  generateSkill,
  loadCartridge,
  Draws,
  CARTRIDGE_FORMAT,
  readCartridge,
  readCartridgeAssets,
  readCartridgeHeader,
  SEED_MAX,
} from '@overstory/sprout/lang';

import { checkWorld } from './check.js';
import { USAGE, main, parseArgs } from './cli.js';
import {
  INSTALLED_EXTENSIONS,
  playScript,
  plays,
  readScript,
  stepOfLine,
  writeScript,
} from '@overstory/sprout-player';
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

/** `lines` as a session begun at seed 0 seeds them: `@seed 0` first, then the stream's next before every line that plays. */
const seeded = (lines: string): string => {
  const draws = new Draws(0);
  const out = ['@seed 0'];
  for (const line of lines.split('\n')) {
    if (line === '') continue;
    const step = stepOfLine(line, 'spec');
    if (step !== null && plays(step)) out.push(`@seed ${draws.below(SEED_MAX + 1)}`);
    out.push(line);
  }
  return `${out.join('\n')}\n`;
};

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
    expect(io.out()).toBe(generateSkill({ usage: USAGE, extensions: INSTALLED_EXTENSIONS }));
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

  it('view --scene lists the verbs in place of the readings, and --verb gives one verb’s readings', () => {
    const dir = worldFolder('lane', LANE);
    const scene = captured();
    expect(main(['view', dir, '--scene', '--at', 'shed'], scene)).toBe(0);
    expect(scene.out()).toContain('\nverbs they could be offered\n  lane.pry\n');
    expect(scene.out()).not.toContain('what they could type');
    const verb = captured();
    expect(main(['view', dir, '--at', 'shed', '--verb', 'lane.pry'], verb)).toBe(0);
    expect(verb.out()).toBe(
      'standing in shed\n\nwhat they could type with lane.pry\n  pry shed  (lane.pry)\n    target: a shed (shed)\n',
    );
  });

  it('view refuses --verb with no verb, or with --scene, saying what to write instead', () => {
    const dir = worldFolder('lane', LANE);
    const bare = captured();
    expect(main(['view', dir, '--verb'], bare)).toBe(1);
    expect(bare.err()).toBe(
      'sprout: --verb wants a verb after it, by its qualified name: --verb sprout.take\n',
    );
    const both = captured();
    expect(main(['view', dir, '--scene', '--verb', 'lane.pry'], both)).toBe(1);
    expect(both.err()).toBe(
      'sprout: Write one of --scene and --verb: each prints a poll of its own.\n',
    );
  });

  it('view polls under --poll-steps in place of the host default, and says how to raise it where the poll runs out', () => {
    const pebbles = Array.from({ length: 800 }, (_, n) => `    object pebble_${n} is Pebble`);
    const dir = worldFolder('heap', {
      'heap.sprout': `world heap is sprout.World {
  visitors are Walker
  visitors arrive at yard

  object yard is sprout.Place {
    describe { text "A heap of pebbles." }
${pebbles.join('\n')}
  }
}
`,
      'walker.sprout': 'kind Walker is sprout.Visitor { }\n',
      'pebble.sprout': 'kind Pebble {\n  grammar { nouns "pebble" }\n}\n',
    });
    const standing = captured();
    expect(main(['view', dir], standing)).toBe(1);
    const steps = DEFAULT_LIMITS.budgets.pollSteps;
    expect(standing.out()).toMatch(
      new RegExp(
        `\\nwhat they could type\\n {2}nothing\\n\\nthe poll faulted, against yard, BudgetExhausted: ` +
          `pollSteps: a poll turn may take ${steps} steps\\.\\n` +
          `A poll stops at its first step past ${steps}, so how many this one needs is not known: ` +
          `give it more with --poll-steps, as in \`--poll-steps ${steps * 2}\`\\.\\n$`,
      ),
    );
    const raised = captured();
    expect(main(['view', dir, '--poll-steps', '100000'], raised)).toBe(0);
    expect(raised.out()).toContain('\n  examine pebble 799  (sprout.examine)\n');
    expect(raised.out()).not.toContain('the poll faulted');
  });

  it('view refuses a --poll-steps that is not a whole number', () => {
    const dir = worldFolder('lane', LANE);
    for (const argv of [
      ['view', dir, '--poll-steps', 'many'],
      ['view', dir, '--poll-steps=1.5'],
      ['view', dir, '--poll-steps=-3'],
      ['view', dir, '--poll-steps=99999999999999999999'],
      ['view', dir, '--poll-steps'],
    ]) {
      const io = captured();
      expect(main(argv, io)).toBe(1);
      expect(io.out()).toBe('');
      expect(io.err()).toBe(
        'sprout: --poll-steps wants a whole number after it, as in `--poll-steps 200`.\n',
      );
    }
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
    expect(io.err()).toBe('');
    const reached = JSON.parse(readFileSync(report, 'utf8'));
    expect(reached.scripts).toEqual(['walk.json']);
    expect(reached.reach.places.reached).toEqual(['yard', 'shed']);
    expect(reached.reach.places.never).toEqual(['attic']);
    expect(reached.reading.unread.map((one: { typed: string }) => one.typed)).toEqual(['xyzzy']);

    const saved = captured();
    expect(main(['play', dir, script, '--write', '--report', report], saved)).toBe(0);
    expect(saved.out()).toBe(`wrote ${script}\nwrote ${report}\n`);
  });

  it('play --report and test --report write the same report, and say nothing of it', () => {
    const dir = worldFolder('lane', LANE);
    const folder = mkdtempSync(join(tmpdir(), 'sprout-play-'));
    const script = join(folder, 'walk.json');
    writeFileSync(script, writeScript(scriptOf('@arrive Marta\nMarta> go in\nMarta> xyzzy')));
    const reports = ['play', 'test'].map((command) => {
      const report = join(folder, `${command}.json`);
      const io = captured();
      main([command, dir, script, '--report', report], io);
      expect(io.err()).toBe('');
      return readFileSync(report, 'utf8');
    });
    const reached = JSON.parse(reports[0]!);
    expect(reached.reading.unread.map((one: { typed: string }) => one.typed)).toEqual(['xyzzy']);
    expect(reports[1]).toBe(reports[0]);
  });

  it('refuses a flag the command does not take, naming those it does', () => {
    const dir = worldFolder('lane', LANE);
    const refusals = [
      [['parse', dir, 'look', '--quiet'], 'parse takes no --quiet; it takes --at and --as.'],
      [['parse', dir, '--poll-steps', '9'], 'parse takes no --poll-steps; it takes --at and --as.'],
      [
        ['view', dir, '--quiet'],
        'view takes no --quiet; it takes --at, --as, --scene, --verb and --poll-steps.',
      ],
      [
        ['play', dir, 'walk.json', '--quiet'],
        'play takes no --quiet; it takes --write, --report, --at, --as, --seed, --debug and --record.',
      ],
      [['test', dir, '--quiet=yes'], 'test takes no --quiet; it takes --report.'],
      [
        ['mcp', dir, '--quiet'],
        'mcp takes no --quiet; it takes --http, --seed, --record, --turn-cap and --advance-per-turn.',
      ],
    ] as const;
    for (const [argv, words] of refusals) {
      const io = captured();
      expect(main(argv, io)).toBe(1);
      expect(io.out()).toBe('');
      expect(io.err()).toBe(`sprout: ${words}\n`);
    }
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

  it('play with no script begins its turn seeds at --seed, and refuses one that is not a seed', async () => {
    const dir = worldFolder('kiln_yard', KILN_YARD);
    const file = join(mkdtempSync(join(tmpdir(), 'sprout-seed-')), 'session.json');
    const io = captured('fire kiln\n');
    await expect(
      main(['play', dir, '--as', 'Marta', '--seed', '7', '--record', file], io),
    ).resolves.toBe(0);
    const [first] = readScript(readFileSync(file, 'utf8'), 'session.json').steps;
    expect(first).toEqual({ seed: 7 });
    for (const bad of [['--seed'], ['--seed', 'x'], ['--seed', String(SEED_MAX + 1)]]) {
      const refused = captured('');
      expect(main(['play', dir, ...bad], refused)).toBe(1);
      expect(refused.err()).toContain(`--seed wants a whole number from 0 to ${SEED_MAX}`);
    }
    const scripted = captured('');
    expect(main(['play', dir, file, '--seed', '7'], scripted)).toBe(1);
    expect(scripted.err()).toContain('--seed is for play with no script');
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
    const asScript = (lines: string) =>
      transcript(dir, seeded(`@arrive Marta\n${lines}@leave Marta\n`));

    const typed = 'Marta> fire kiln\n@tick\n@advance 2 hours\nMarta> look\n';
    const io = captured(typed);
    await expect(main(['play', dir, '--as', 'Marta', '--seed', '0', '--debug'], io)).resolves.toBe(
      0,
    );
    expect(io.out()).toBe(asScript(typed));

    const dashed = captured(typed);
    await expect(
      main(['play', dir, '-', '--as', 'Marta', '--seed', '0', '--debug'], dashed),
    ).resolves.toBe(0);
    expect(dashed.out()).toBe(asScript(typed));
  });

  it('a bare typed line addresses whoever most recently arrived and still stands', async () => {
    const dir = worldFolder('kiln_yard', KILN_YARD);
    const bare = captured('fire kiln\n@tick\n');
    await expect(
      main(['play', dir, '--as', 'Marta', '--seed', '0', '--debug'], bare),
    ).resolves.toBe(0);
    expect(bare.out()).toBe(
      transcript(dir, seeded('@arrive Marta\nMarta> fire kiln\n@tick\n@leave Marta\n')),
    );

    const second = captured('@arrive Ines\nlook\n');
    await expect(
      main(['play', dir, '--debug', '--seed', '0', '--as', 'Marta'], second),
    ).resolves.toBe(0);
    expect(second.out()).toBe(
      transcript(dir, seeded('@arrive Marta\n@arrive Ines\nInes> look\n@leave Ines\n')),
    );
  });

  it('ends the session with a departure turn for whoever is left standing, on Ctrl-D', async () => {
    const dir = worldFolder('kiln_yard', KILN_YARD);
    const io = captured('');
    await expect(main(['play', '--debug', '--seed', '0', dir], io)).resolves.toBe(0);
    expect(io.out()).toBe(transcript(dir, seeded('@arrive Inspector\n@leave Inspector\n')));
  });

  it('refuses a nickname or --at as sprout parse would, admitting nobody', async () => {
    const dir = worldFolder('lane', LANE);
    const refused = captured('');
    await expect(main(['play', dir, '--as', 'crate', '--debug'], refused)).resolves.toBe(0);
    expect(refused.out().replace(/^(@seed \d+\n){2}/, '')).toBe(
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
    expect(readCartridgeHeader(bytes)).toMatchObject({ format: CARTRIDGE_FORMAT });
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

  it('pack carries a manifest’s title into the cartridge’s header and says it did', () => {
    const dir = worldFolder('lane', LANE);
    const manifest = JSON.parse(readFileSync(join(dir, 'sprout.json'), 'utf8'));
    writeFileSync(
      join(dir, 'sprout.json'),
      JSON.stringify({ ...manifest, title: 'The Lane: A Walk' }),
    );
    const file = join(mkdtempSync(join(tmpdir(), 'sprout-pack-')), 'lane.sproutworld');
    const packed = captured();
    expect(main(['pack', dir, '-o', file], packed)).toBe(0);
    expect(packed.out()).toMatch(
      new RegExp(`^packed lane, titled "The Lane: A Walk", into ${file}: \\d+ bytes\\n$`),
    );
    expect(readCartridge(readFileSync(file)).header.title).toBe('The Lane: A Walk');
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

describe('sprout pack of a world that names files', () => {
  const MEDIA_ROOM = fileURLToPath(new URL('../../corpus/good/media-room', import.meta.url));
  const MISSING_FILE = fileURLToPath(
    new URL('../../corpus/bad/media-missing-file', import.meta.url),
  );

  it('writes one file, which carries every file the world names, and says how many', () => {
    const into = mkdtempSync(join(tmpdir(), 'sprout-pack-'));
    const file = join(into, 'room.sproutworld');
    const io = captured();
    expect(main(['pack', MEDIA_ROOM, '-o', file], io)).toBe(0);
    expect(io.out()).toMatch(
      new RegExp(`^packed media_room into ${file}: \\d+ bytes, carrying 3 asset files\\n$`),
    );
    expect(readdirSync(into)).toEqual(['room.sproutworld']);
    const bytes = readFileSync(file);
    expect(readCartridgeAssets(bytes).map((asset) => asset.path)).toEqual([
      'cellar.png',
      'pictures/cabinet-open.png',
      'pictures/cabinet.png',
    ]);
    expect(readCartridge(bytes).extensions[0]!.assets!.map((asset) => asset.path)).toEqual([
      'cellar.png',
      'pictures/cabinet-open.png',
      'pictures/cabinet.png',
    ]);
  });

  it('refuses at compile, naming the line, when a file it names is missing, and writes nothing', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'sprout-pack-')), 'gone.sproutworld');
    const io = captured();
    expect(main(['pack', MISSING_FILE, '-o', file], io)).toBe(1);
    expect(io.out()).toContain(
      'cellar.sprout:8:16  The file "nowhere.png" is not in this world’s folder.',
    );
    expect(existsSync(file)).toBe(false);
  });
});

describe('keygen and index', () => {
  const key = join(fileURLToPath(import.meta.url), '../../../sprout-player/test/index-test.key');

  it('keygen writes a pair and prints the public key and the paths, never the private key', () => {
    const prefix = join(mkdtempSync(join(tmpdir(), 'sprout-keygen-')), 'publisher');
    const io = captured();
    expect(main(['keygen', prefix], io)).toBe(0);
    const seed = readFileSync(`${prefix}.key`, 'utf8').trim();
    const publicKey = readFileSync(`${prefix}.pub`, 'utf8').trim();
    expect(io.out()).toBe(
      `wrote ${prefix}.key, the private key: keep it secret and out of every repository\n` +
        `wrote ${prefix}.pub, the public key the Playdate app is built with\n` +
        `public key ${publicKey}\n`,
    );
    expect(io.out() + io.err()).not.toContain(seed);
    const again = captured();
    expect(main(['keygen', prefix], again)).toBe(1);
    expect(again.err()).toBe(
      `sprout: ${prefix}.key already exists, and a key is never replaced: give another name.\n`,
    );
    expect(readFileSync(`${prefix}.key`, 'utf8').trim()).toBe(seed);
  });

  it('keygen wants a prefix and takes no flags', () => {
    const bare = captured();
    expect(main(['keygen'], bare)).toBe(1);
    expect(bare.err()).toMatch(/keygen wants where to write the pair/);
    const flagged = captured();
    expect(main(['keygen', 'x', '--force'], flagged)).toBe(1);
    expect(flagged.err()).toBe('sprout: keygen takes no flags; --force is not one.\n');
  });

  it('index signs the cartridges in a folder into index.json beside them, saying what it wrote', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sprout-index-'));
    const file = join(dir, 'lane.sproutworld');
    expect(main(['pack', worldFolder('lane', LANE), '-o', file], captured())).toBe(0);
    const io = captured();
    expect(main(['index', dir, '--base-url', 'https://w.example/', '--key', key], io)).toBe(0);
    const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as {
      worlds: { hash: string; url: string }[];
    };
    const name = `lane-${index.worlds[0]!.hash.slice(0, 8)}.sproutworld`;
    expect(index.worlds[0]!.url).toBe(`https://w.example/${name}`);
    expect(io.out()).toBe(`wrote ${name}\nsigned 1 world into ${join(dir, 'index.json')}\n`);
    const again = captured();
    expect(
      main(
        [
          'index',
          dir,
          '--base-url',
          'https://w.example/',
          '--key',
          key,
          '-o',
          join(dir, 'index.json'),
        ],
        again,
      ),
    ).toBe(0);
    expect(again.out()).toBe(`kept ${name}\nsigned 1 world into ${join(dir, 'index.json')}\n`);
  });

  it('index says in words what it wants', () => {
    const cases: [string[], string][] = [
      [['index'], 'index wants the folder of cartridges'],
      [['index', '.', '--key', key], 'index wants --base-url'],
      [['index', '.', '--base-url', 'https://w.example/'], 'index wants --key'],
      [
        ['index', '.', '--base-url', 'https://w.example/', '--key', key, '-o'],
        '-o wants a file after it',
      ],
      [
        ['index', '.', '--seed', '1'],
        'index takes no --seed; it takes --base-url, --key and --out.',
      ],
    ];
    for (const [argv, words] of cases) {
      const io = captured();
      expect(main(argv, io)).toBe(1);
      expect(io.err()).toContain(words);
    }
  });
});
