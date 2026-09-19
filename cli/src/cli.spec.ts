import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { sproutSkill } from '@overstory/sprout';
import { MEDIA } from '@overstory/sprout-ext-media';

import { readArchiveZip } from './archive.js';
import { checkArchive } from './check.js';
import { USAGE, main, parseArgs } from './cli.js';
import { initArchive } from './init.js';
import { captured } from './testing.js';
import { renderTurn } from './transcript.js';

// The command line's edges: the arguments, init, pack, skill, and the
// transcript's rendering of each line kind.

const EXAMPLES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'sprout-examples');

describe('parseArgs', () => {
  it('a command, positionals, --flag value, --flag=value, --flag alone, and -o', () => {
    expect(
      parseArgs(['play', 'world', '--as', 'marta', '--fresh', '--store=memory', '-o', 'x.zip']),
    ).toEqual({
      command: 'play',
      positional: ['world'],
      flags: { as: 'marta', fresh: true, store: 'memory', o: 'x.zip' },
    });
    expect(parseArgs([])).toEqual({ command: null, positional: [], flags: {} });
  });
});

describe('main', () => {
  it('no command prints the usage and fails; help prints it and succeeds; an unknown command names itself', async () => {
    const none = captured();
    expect(await main([], none)).toBe(1);
    expect(none.out()).toBe(USAGE);
    const help = captured();
    expect(await main(['help'], help)).toBe(0);
    const bad = captured();
    expect(await main(['frobnicate'], bad)).toBe(1);
    expect(bad.err()).toContain('no such command "frobnicate"');
  });

  it('init: a manifest, one room, a README line — and it checks and has a door; a full folder is refused', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'sprout-init-')), 'shed');
    const io = captured();
    expect(await main(['init', dir], io)).toBe(0);
    expect(io.out()).toBe(
      `wrote ${dir}/sprout.json\nwrote ${dir}/rooms/hall.sprout\nwrote ${dir}/README.md\n`,
    );
    expect(JSON.parse(readFileSync(join(dir, 'sprout.json'), 'utf8'))).toMatchObject({
      format: 1,
      entry: 'hall',
    });
    expect(readFileSync(join(dir, 'README.md'), 'utf8')).toContain('sprout play .');
    const check = captured();
    expect(await main(['check', dir], check)).toBe(0);
    expect(check.out()).toContain('the door is hall');
    expect(() => initArchive(dir)).toThrow('not empty');
  });

  it('pack: the folder as one zip, checked first; a broken folder is not packed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sprout-pack-'));
    const out = join(dir, 'out', 'studio.zip');
    const io = captured();
    expect(await main(['pack', join(EXAMPLES, 'pottery-studio'), '-o', out], io)).toBe(0);
    expect(io.out()).toBe(`wrote ${out} (26 files, sprout.json)\n`);
    const zipped = readArchiveZip(out);
    expect(zipped.files).toHaveLength(26);
    expect(zipped.manifest?.entry).toBe('front');
    expect(checkArchive(zipped).ok).toBe(true);
    // …and the zip plays: check through the command reads a zip too
    const check = captured();
    expect(await main(['check', out], check)).toBe(0);
    const broken = join(dir, 'broken');
    initArchive(broken);
    writeFileSync(join(broken, 'rooms', 'hall.sprout'), 'room hall {\n  exit "up" to attic\n}\n');
    const refused = captured();
    expect(await main(['pack', broken, '-o', join(dir, 'never.zip')], refused)).toBe(1);
    expect(refused.out()).toContain('No room is called "attic"');
    expect(existsSync(join(dir, 'never.zip'))).toBe(false);
  });

  it('skill: the SKILL.md as this sprout speaks it — with pictures', async () => {
    const io = captured();
    expect(await main(['skill'], io)).toBe(0);
    expect(io.out()).toBe(sproutSkill(MEDIA));
    expect(io.out()).toContain('use media');
  });
});

describe('renderTurn', () => {
  it('a room block is a heading, paragraphs and the ways on; a notice is marked; a picture is named; the rest is said', () => {
    const scene = {
      stamp: 's',
      room: { id: 'hall', name: 'The Hall', prose: 'Quiet.', entry: true },
      exits: [
        { label: 'up', to: 'attic' },
        { label: 'out', to: 'yard' },
      ],
      items: [],
      carrying: [],
      memory: [],
      present: [],
    };
    expect(
      renderTurn({
        lines: [
          { kind: 'notice', text: 'alba arrives.' },
          { kind: 'room', text: 'The Hall\n\nQuiet.\n\nYou can see a cat here.' },
          { kind: 'said', text: 'The cat yawns.' },
          {
            kind: 'effect',
            text: '',
            effect: { extension: 'media', kind: 'show', mediaId: 'm-1' } as never,
          },
          { kind: 'miss', text: 'Nothing here answers to that.' },
        ],
        scene,
        affordances: { actions: [], nouns: [] },
      }),
    ).toEqual([
      '* alba arrives.',
      '',
      '== The Hall ==',
      '',
      'Quiet.',
      '',
      'You can see a cat here.',
      '',
      'Ways on: up; out.',
      'The cat yawns.',
      '[a picture opens: m-1]',
      'Nothing here answers to that.',
    ]);
    expect(
      renderTurn({
        lines: [{ kind: 'room', text: 'X' }],
        scene: { ...scene, exits: [] },
        affordances: { actions: [], nouns: [] },
      }),
    ).toEqual(['', '== X ==', '', 'No way on from here.']);
  });
});
