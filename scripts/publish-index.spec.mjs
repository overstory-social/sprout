// Specs for scripts/publish-index.mjs and scripts/index-signing.mjs, run by `node --test`
// (scripts/playdate-player.mjs `shippingSpecs`). They sign with the test key under
// sprout-player/test/, never a real one.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { buildIndex, canonicalText, indexIsSigned, privateKeyOf, readKeyFile, signWorlds } from './index-signing.mjs';
import { main } from './publish-index.mjs';

const root = join(fileURLToPath(import.meta.url), '../..');
const player = join(root, 'sprout-player');
const TEST_KEY = join(player, 'test/index-test.key');
const TEST_PUBLIC = readFileSync(join(player, 'test/index-test.pub'), 'utf8').trim();
const fixture = (name) => readFileSync(join(player, 'test/fixtures', name), 'utf8');

/** A folder of cartridges packed by the built CLI: chip-tree (no assets) and media-room (three asset files). */
async function packed() {
  const dir = mkdtempSync(join(tmpdir(), 'sprout-index-'));
  const { main: cli } = await import(pathToFileURL(join(root, 'cli/dist/cli.js')).href);
  const quiet = { write: () => true };
  for (const name of ['chip-tree', 'media-room']) {
    const code = await cli(['pack', join(root, 'corpus/good', name), '-o', join(dir, `${name}.sproutworld`)], {
      stdout: quiet,
      stderr: quiet,
      stdin: process.stdin,
    });
    assert.equal(code, 0, `${name} packs`);
  }
  return dir;
}

function run(args, env = {}) {
  const said = [];
  const code = main(args, env, (line) => said.push(line));
  return { code, said: said.join('\n') };
}

test('the canonical text has sorted keys, no spaces, JSON strings and integers', () => {
  assert.equal(canonicalText({ b: 1, a: ['x', 2], c: 'q"\\\n\u0001é' }), '{"a":["x",2],"b":1,"c":"q\\"\\\\\\n\\u0001é"}');
  assert.throws(() => canonicalText({ n: 1.5 }), /not an integer/);
  assert.throws(() => canonicalText({ n: null }), /no canonical text/);
});

test('the fixture the Lua and C tests read is signed by the test key over the canonical text', () => {
  const index = JSON.parse(fixture('index.json'));
  assert.equal(canonicalText(index.worlds), fixture('index.canonical.txt'));
  assert.equal(`${index.signed}\n`, fixture('index.signature.txt'));
  assert.equal(indexIsSigned(index, TEST_PUBLIC), true);
  assert.equal(signWorlds(index.worlds, privateKeyOf(readKeyFile(TEST_KEY))), index.signed);
});

test('an index lists each cartridge with its header, size, SHA-256 and address, and its assets', async () => {
  const dir = await packed();
  const index = buildIndex(dir, 'https://worlds.example/sprout', privateKeyOf(readKeyFile(TEST_KEY)));
  assert.deepEqual(
    index.worlds.map((w) => w.title),
    ['chip_tree', 'media_room'],
  );
  const [chip, media] = index.worlds;
  assert.equal(chip.url, 'https://worlds.example/sprout/chip-tree.sproutworld');
  assert.equal(chip.bytes, statSync(join(dir, 'chip-tree.sproutworld')).size);
  assert.match(chip.hash, /^[0-9a-f]{64}$/);
  assert.match(chip.sha256, /^[0-9a-f]{64}$/);
  assert.equal(chip.author, 'corpus');
  assert.equal(chip.version, '0.1.0');
  assert.equal(chip.assets, undefined);
  assert.deepEqual(
    media.assets.map((a) => a.path),
    ['cellar.png', 'pictures/cabinet-open.png', 'pictures/cabinet.png'],
  );
  assert.equal(media.assets[2].url, 'https://worlds.example/sprout/media-room.sproutworld.assets/pictures/cabinet.png');
  assert.equal(indexIsSigned(index, TEST_PUBLIC), true);
});

test('a changed index, or another key, does not verify', async () => {
  const dir = await packed();
  const index = buildIndex(dir, 'https://worlds.example/', privateKeyOf(readKeyFile(TEST_KEY)));
  const changed = structuredClone(index);
  changed.worlds[0].bytes += 1;
  assert.equal(indexIsSigned(changed, TEST_PUBLIC), false);
  assert.equal(indexIsSigned(index, '00'.repeat(32)), false);
  assert.equal(indexIsSigned({ worlds: index.worlds, signed: 'zz' }, TEST_PUBLIC), false);
});

test('the command writes index.json beside the cartridges, signed with the key file named', async () => {
  const dir = await packed();
  const { code, said } = run([dir, '--base-url', 'https://worlds.example/sprout/', '--key', TEST_KEY]);
  assert.equal(code, 0, said);
  assert.match(said, /signed 2 worlds into .*index\.json/);
  const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
  assert.equal(indexIsSigned(index, TEST_PUBLIC), true);
  assert.equal(index.worlds[0].url, 'https://worlds.example/sprout/chip-tree.sproutworld');
});

test('the key may come from the environment, and --out gathers the cartridges, assets and index in one folder', async () => {
  const dir = await packed();
  const out = join(mkdtempSync(join(tmpdir(), 'sprout-out-')), 'site');
  const { code, said } = run([dir, '--base-url', 'http://localhost:8000', '--out', out], { SPROUT_INDEX_KEY: TEST_KEY });
  assert.equal(code, 0, said);
  for (const file of [
    'index.json',
    'chip-tree.sproutworld',
    'media-room.sproutworld',
    'media-room.sproutworld.assets/pictures/cabinet.png',
  ]) {
    assert.equal(existsSync(join(out, file)), true, file);
  }
  assert.equal(existsSync(join(dir, 'index.json')), false, 'the source folder is left alone');
});

test('a command that cannot proceed says what to do and exits non-zero', async () => {
  const dir = await packed();
  const empty = mkdtempSync(join(tmpdir(), 'sprout-empty-'));
  const cases = [
    [[dir, '--key', TEST_KEY], {}, /Give a folder of cartridges and --base-url/],
    [[dir, '--base-url', 'https://x.example/'], {}, /Give the private key file with --key/],
    [[dir, '--base-url', 'ftp://x.example/', '--key', TEST_KEY], {}, /should begin with http/],
    [[dir, '--base-url', 'https://x.example/', '--key', join(dir, 'absent.key')], {}, /ENOENT/],
    [[empty, '--base-url', 'https://x.example/', '--key', TEST_KEY], {}, /holds no \.sproutworld cartridge/],
  ];
  for (const [args, env, pattern] of cases) {
    const { code, said } = run(args, env);
    assert.equal(code, 1, said);
    assert.match(said, pattern);
    assert.match(said, /Usage:/);
  }
  const bad = join(empty, 'bad.key');
  writeFileSync(bad, 'not a key\n');
  const { code, said } = run([dir, '--base-url', 'https://x.example/', '--key', bad]);
  assert.equal(code, 1);
  assert.match(said, /should hold 64 lowercase hexadecimal digits/);
});

test('--generate-key writes a private key only its owner can read and the public half, and never replaces them', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sprout-keys-'));
  const prefix = join(dir, 'publisher');
  const first = run(['--generate-key', prefix]);
  assert.equal(first.code, 0, first.said);
  assert.equal(statSync(`${prefix}.key`).mode & 0o077, 0, 'private to its owner');
  const seed = readKeyFile(`${prefix}.key`);
  const publicKey = readFileSync(`${prefix}.pub`, 'utf8').trim();
  assert.match(publicKey, /^[0-9a-f]{64}$/);
  const worlds = [{ title: 'T' }];
  assert.equal(indexIsSigned({ worlds, signed: signWorlds(worlds, privateKeyOf(seed)) }, publicKey), true);
  const again = run(['--generate-key', prefix]);
  assert.equal(again.code, 1);
  assert.match(again.said, /already exists; it is not replaced/);
  assert.equal(readKeyFile(`${prefix}.key`).equals(seed), true);
});

test('the index the script writes has exactly the members index.schema.json requires and allows', async () => {
  const schema = JSON.parse(readFileSync(join(player, 'index.schema.json'), 'utf8'));
  const world = schema.$defs.world;
  const dir = await packed();
  const index = buildIndex(dir, 'https://worlds.example/', privateKeyOf(readKeyFile(TEST_KEY)));
  assert.deepEqual(Object.keys(index).sort(), [...schema.required].sort());
  for (const entry of index.worlds) {
    for (const key of world.required) assert.ok(key in entry, `${key} is listed`);
    for (const key of Object.keys(entry)) assert.ok(key in world.properties, `${key} is in the schema`);
    for (const asset of entry.assets ?? []) {
      assert.deepEqual(Object.keys(asset).sort(), [...world.properties.assets.items.required].sort());
    }
  }
  assert.match(index.signed, new RegExp(schema.properties.signed.pattern));
});

test('the test key pair under sprout-player/test is a pair', () => {
  const sign = signWorlds([{ a: 1 }], privateKeyOf(readKeyFile(TEST_KEY)));
  assert.equal(indexIsSigned({ worlds: [{ a: 1 }], signed: sign }, TEST_PUBLIC), true);
});

test('the command runs from the shell as the README says', async () => {
  const dir = await packed();
  const out = execFileSync(
    process.execPath,
    [join(root, 'scripts/publish-index.mjs'), dir, '--base-url', 'https://worlds.example/', '--key', TEST_KEY],
    { encoding: 'utf8' },
  );
  assert.match(out, /signed 2 worlds/);
});
