// Specs for the shipping half of scripts/playdate-player.mjs: the list of graduated worlds, packing
// them with their assets, and the public key baked into the app. Run by `node --test`
// (`shippingSpecs`); they need `npm run build` for the CLI and no Playdate SDK.

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  TEST_PUBLIC_KEY,
  WORLDS_FILE,
  readGraduated,
  stageWorlds,
  writePublicKey,
} from './playdate-player.mjs';

const root = join(fileURLToPath(import.meta.url), '../..');
const scratch = () => mkdtempSync(join(tmpdir(), 'sprout-shipping-'));

function listFile(value) {
  const file = join(scratch(), 'worlds.json');
  writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  return file;
}

test("the graduated list in the repository ships the worked microworld and the studio's finished world, once each", () => {
  const list = readGraduated(WORLDS_FILE);
  for (const name of ['printers_shop', 'underground_caverns']) {
    assert.ok(
      list.some((entry) => entry.file === `${name}.sproutworld`),
      `${name} ships`,
    );
  }
  assert.equal(new Set(list.map((entry) => entry.file)).size, list.length);
  for (const entry of list) assert.ok(existsSync(join(entry.dir, 'sprout.json')), entry.world);
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

test('each listed world is packed with its assets into the folder the app carries', async () => {
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
  for (const file of [
    'chip_tree.sproutworld',
    'media_room.sproutworld',
    'media_room.sproutworld.assets/cellar.png',
    'media_room.sproutworld.assets/pictures/cabinet.png',
  ]) {
    assert.ok(existsSync(join(out, file)), file);
  }
  assert.equal(existsSync(join(out, 'teashop.sproutworld')), false, 'only what is listed');
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

test('the public key the app trusts is written as a Lua module from the file named', () => {
  const into = scratch();
  const keyFile = join(scratch(), 'publisher.pub');
  writeFileSync(keyFile, `${'ab'.repeat(32)}\n`);
  const made = writePublicKey({ keyFile, into });
  assert.equal(made.isTest, false);
  const lua = readFileSync(join(into, 'publickey.lua'), 'utf8');
  assert.match(lua, new RegExp(`return "${'ab'.repeat(32)}"\\n$`));
  assert.match(lua, /publisher\.pub/);
});

test('the test key is the default, and is said to be the test key', () => {
  const into = scratch();
  const made = writePublicKey({ keyFile: TEST_PUBLIC_KEY, into });
  assert.equal(made.isTest, true);
  const key = readFileSync(TEST_PUBLIC_KEY, 'utf8').trim();
  assert.match(readFileSync(join(into, 'publickey.lua'), 'utf8'), new RegExp(`return "${key}"`));
});

test('a public key file that is not a key is refused', () => {
  for (const text of ['', 'ab', `${'AB'.repeat(32)}`, `${'zz'.repeat(32)}`, `${'ab'.repeat(33)}`]) {
    const keyFile = join(scratch(), 'bad.pub');
    writeFileSync(keyFile, text);
    assert.throws(
      () => writePublicKey({ keyFile, into: scratch() }),
      /should hold the public key as 64 lowercase hexadecimal digits/,
    );
  }
});
