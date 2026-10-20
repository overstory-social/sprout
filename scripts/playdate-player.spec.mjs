// Specs for the shipping half of scripts/playdate-player.mjs: the list of graduated worlds, packing
// them with their assets apart from the pdx, the pdx carrying none, and the public key baked into the app. Run by `node --test`
// (`shippingSpecs`); they need `npm run build` for the CLI and no Playdate SDK.

import assert from 'node:assert/strict';
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
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { readCartridgeAssets } from '@overstory/sprout/lang';

import {
  appPollSteps,
  noWorlds,
  publicKeyFile,
  PUBLISHER_PUBLIC_KEY,
  readGraduated,
  stageWorlds,
  TEST_PUBLIC_KEY,
  unmetExpectation,
  WORLDS_FILE,
  readPublicKey,
} from './playdate-player.mjs';

const root = join(fileURLToPath(import.meta.url), '../..');
const scratch = () => mkdtempSync(join(tmpdir(), 'sprout-shipping-'));

function listFile(value) {
  const file = join(scratch(), 'worlds.json');
  writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  return file;
}

test("the graduated list in the repository packs the worked microworld and the studio's finished world, once each", () => {
  const list = readGraduated(WORLDS_FILE);
  for (const name of ['printers_shop', 'underground_caverns']) {
    assert.ok(
      list.some((entry) => entry.file === `${name}.sproutworld`),
      `${name} is packed`,
    );
  }
  assert.equal(new Set(list.map((entry) => entry.file)).size, list.length);
  for (const entry of list) assert.ok(existsSync(join(entry.dir, 'sprout.json')), entry.world);
  const caverns = list.find((entry) => entry.file === 'underground_caverns.sproutworld');
  assert.deepEqual(caverns.plays, ['tests/walkthrough.json'], 'the whole of Zork is a listed play');
  assert.equal(caverns.dir, join(root, 'sprout-player/worlds/underground_caverns'));
  const pin = JSON.parse(readFileSync(join(caverns.dir, 'source.json'), 'utf8'));
  assert.equal(pin.world, 'worlds/underground_caverns/world');
  assert.match(
    pin.commit,
    /^[0-9a-f]{40}$/,
    'the snapshot names the studio commit it was copied at',
  );
});

test('a world may list plays under its folder, and one that is not there is refused by name', () => {
  const list = readGraduated(
    listFile({
      graduated: [{ world: 'chip-tree', title: 'Chip Tree', plays: ['transcripts/chips.json'] }],
    }),
  );
  assert.deepEqual(list[0].plays, ['transcripts/chips.json']);
  assert.deepEqual(
    readGraduated(listFile({ graduated: [{ world: 'teashop', title: 'T' }] }))[0].plays,
    [],
  );
  assert.throws(
    () =>
      readGraduated(
        listFile({
          graduated: [{ world: 'chip-tree', title: 'C', plays: ['transcripts/none.json'] }],
        }),
      ),
    /the play "transcripts\/none.json" of the world "chip-tree" is not at/,
  );
  assert.throws(
    () =>
      readGraduated(listFile({ graduated: [{ world: 'chip-tree', title: 'C', plays: 'chips' }] })),
    /"plays" of the world "chip-tree" should be a list/,
  );
});

test('the poll budget the plays are held to is the one src/budgets.h defines', () => {
  assert.ok(Number.isInteger(appPollSteps()) && appPollSteps() > 10_000);
});

test('a world is named by its corpus/good name or by a path from the repository root, and its cartridge for its manifest', () => {
  const list = readGraduated(
    listFile({
      graduated: [
        { world: 'chip-tree', title: 'Chip Tree' },
        { world: 'corpus/good/teashop', title: 'Teashop' },
      ],
    }),
  );
  assert.deepEqual(
    list.map((entry) => [entry.file, entry.title]),
    [
      ['chip_tree.sproutworld', 'Chip Tree'],
      ['teashop.sproutworld', 'Teashop'],
    ],
  );
  assert.equal(list[1].dir, join(root, 'corpus/good/teashop'));
});

test('a list that cannot be used says what to write', () => {
  const cases = [
    ['{', /cannot be read as JSON/],
    [{ worlds: [] }, /should be \{ "graduated"/],
    [
      { graduated: [{ world: 'chip-tree' }] },
      /entry 1 of "graduated" needs a "world" and a "title"/,
    ],
    [
      { graduated: [{ world: 'no-such-world', title: 'X' }] },
      /the world "no-such-world" is not at/,
    ],
    [
      {
        graduated: [
          { world: 'chip-tree', title: 'A' },
          { world: 'corpus/good/chip-tree', title: 'B' },
        ],
      },
      /the world "chip_tree" is listed twice/,
    ],
  ];
  for (const [value, pattern] of cases)
    assert.throws(() => readGraduated(listFile(value)), pattern);
});

test('each listed world is packed as one file, its pictures inside it, into the folder named', async () => {
  const out = join(scratch(), 'worlds');
  const list = readGraduated(
    listFile({
      graduated: [
        { world: 'chip-tree', title: 'Chip Tree' },
        { world: 'media-room', title: 'Media Room' },
      ],
    }),
  );
  const staged = await stageWorlds({ list, out });
  assert.equal(staged.length, 2);
  assert.deepEqual(readdirSync(out).sort(), ['chip_tree.sproutworld', 'media_room.sproutworld']);
  assert.deepEqual(
    readCartridgeAssets(readFileSync(join(out, 'media_room.sproutworld'))).map((one) => one.path),
    ['cellar.png', 'pictures/cabinet-open.png', 'pictures/cabinet.png'],
  );
  assert.equal(readFileSync(join(out, 'chip_tree.sproutworld')).subarray(0, 4).toString(), 'SPRT');
});

test('staging again replaces what an earlier list left', async () => {
  const out = join(scratch(), 'worlds');
  await stageWorlds({
    list: readGraduated(listFile({ graduated: [{ world: 'teashop', title: 'T' }] })),
    out,
  });
  await stageWorlds({
    list: readGraduated(listFile({ graduated: [{ world: 'chip-tree', title: 'C' }] })),
    out,
  });
  assert.equal(existsSync(join(out, 'teashop.sproutworld')), false);
  assert.equal(existsSync(join(out, 'chip_tree.sproutworld')), true);
});

test('a world folder without a manifest, or with no name in it, is refused by name', () => {
  const bare = scratch();
  assert.throws(
    () => readGraduated(listFile({ graduated: [{ world: bare, title: 'Bare' }] })),
    /the world ".*" has no readable sprout.json/,
  );
  const unnamed = scratch();
  writeFileSync(join(unnamed, 'sprout.json'), '{ "version": "0.1.0" }');
  assert.throws(
    () => readGraduated(listFile({ graduated: [{ world: unnamed, title: 'Unnamed' }] })),
    /has no "name" in its sprout.json/,
  );
});

test('a world that does not pack fails the build and names it', async () => {
  const dir = scratch();
  writeFileSync(join(dir, 'sprout.json'), '{ "name": "broken" }');
  const list = readGraduated(listFile({ graduated: [{ world: dir, title: 'Broken' }] }));
  await assert.rejects(
    stageWorlds({ list, out: join(scratch(), 'worlds') }),
    /Broken .* did not pack/,
  );
});

test('a cartridge anywhere in the pdx or its Source/ is refused by path, and a folder without one passes', () => {
  const source = scratch();
  mkdirSync(join(source, 'fonts'));
  writeFileSync(join(source, 'pdxinfo'), 'name=Sprout\n');
  writeFileSync(join(source, 'fonts', 'frame.fnt'), '');
  noWorlds(source);
  mkdirSync(join(source, 'worlds'));
  writeFileSync(join(source, 'worlds', 'teashop.sproutworld'), 'SPRT');
  assert.throws(
    () => noWorlds(source),
    /worlds\/teashop\.sproutworld is a cartridge, and the pdx carries no worlds: delete it/,
  );
});

test("the app's Source/ in the repository holds no cartridge", () => {
  noWorlds(join(root, 'sprout-player/Source'));
});

test('the public key the app trusts is read from the file named', () => {
  const keyFile = join(scratch(), 'publisher.pub');
  writeFileSync(keyFile, `${'ab'.repeat(32)}\n`);
  const read = readPublicKey({ keyFile });
  assert.equal(read.keyFile, keyFile);
  assert.equal(read.isTest, false);
});

test('the publisher key is the default, and SPROUT_INDEX_PUBLIC_KEY names another', () => {
  assert.equal(publicKeyFile({}), PUBLISHER_PUBLIC_KEY);
  assert.equal(publicKeyFile({ SPROUT_INDEX_PUBLIC_KEY: '' }), PUBLISHER_PUBLIC_KEY);
  assert.equal(publicKeyFile({ SPROUT_INDEX_PUBLIC_KEY: TEST_PUBLIC_KEY }), TEST_PUBLIC_KEY);
});

test('the publisher key is a key and not the test key; the test key is said to be one', () => {
  assert.equal(readPublicKey({ keyFile: PUBLISHER_PUBLIC_KEY }).isTest, false);
  assert.notEqual(
    readFileSync(PUBLISHER_PUBLIC_KEY, 'utf8').trim(),
    readFileSync(TEST_PUBLIC_KEY, 'utf8').trim(),
  );
  assert.equal(readPublicKey({ keyFile: TEST_PUBLIC_KEY }).isTest, true);
});

test('a public key file that is not a key is refused', () => {
  for (const text of ['', 'ab', `${'AB'.repeat(32)}`, `${'zz'.repeat(32)}`, `${'ab'.repeat(33)}`]) {
    const keyFile = join(scratch(), 'bad.pub');
    writeFileSync(keyFile, text);
    assert.throws(
      () => readPublicKey({ keyFile }),
      /should hold the public key as 64 lowercase hexadecimal digits/,
    );
  }
});

test("a play's expectations are held to the lines sproutc's trace says each step told, as `sprout test` holds them", () => {
  const trace = [
    { step: 0, says: [{ reader: 'Ines', kind: 'described', words: 'A cave.' }] },
    {
      step: 2,
      says: [
        { reader: 'Ines', kind: 'said', words: 'You take the lamp.' },
        { reader: 'Marta', kind: 'told', words: 'Ines takes the lamp.' },
      ],
    },
    { step: 3, says: [] },
  ]
    .map((one) => JSON.stringify(one))
    .join('\n');
  const script = (expects) => ({
    steps: [
      { arrive: 'Ines', expect: expects[0] },
      { comment: 'then' },
      { as: 'Ines', type: 'take lamp', expect: expects[1] },
      { tick: true, expect: expects[2] },
    ],
  });
  const met = script([
    [{ words: 'A cave.' }],
    [
      { words: 'You take the lamp.' },
      { reader: 'Marta', kind: 'told', words: 'Ines takes the lamp.' },
      { level: 'info', text: 'a host line, which sproutc does not write' },
    ],
    [],
  ]);
  assert.equal(unmetExpectation(met, trace), null);
  const outOfOrder = script([
    undefined,
    [{ words: 'Ines takes the lamp.' }, { words: 'You take the lamp.' }],
    undefined,
  ]);
  assert.match(
    unmetExpectation(outOfOrder, trace),
    /^step 3 expects You take the lamp\., and said\n/,
  );
  const wrongReader = script([
    [{ reader: 'Marta', kind: 'described', words: 'A cave.' }],
    undefined,
    undefined,
  ]);
  assert.match(
    unmetExpectation(wrongReader, trace),
    /^step 1 expects Marta \(described\): A cave\./,
  );
  const silence = script([undefined, [], undefined]);
  assert.match(
    unmetExpectation(silence, trace),
    /^step 3 expects silence and said\nInes \(said\): You take the lamp\./,
  );
  assert.match(
    unmetExpectation(script([undefined, undefined, [{ words: 'x' }]]), ''),
    /^step 4 did not play$/,
  );
});
