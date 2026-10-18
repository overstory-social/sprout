import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  canonicalText,
  privateKeyOf,
  publicKeyHex,
  readKeyFile,
  signWorlds,
  worldsAreSigned,
  writeKeyPair,
} from './signing.js';

// The C tests' fixtures and the test key pair, whose private half is in the
// repository so that anyone can sign for it; never a real key.
const player = join(fileURLToPath(import.meta.url), '../../../sprout-player');
const TEST_KEY = join(player, 'test/index-test.key');
const TEST_PUBLIC = readFileSync(join(player, 'test/index-test.pub'), 'utf8').trim();
const fixture = (name: string) => readFileSync(join(player, 'test/fixtures', name), 'utf8');

const scratch = () => mkdtempSync(join(tmpdir(), 'sprout-keys-'));

describe('canonicalText', () => {
  it('has sorted keys, no spaces, JSON strings and integers in decimal', () => {
    expect(canonicalText({ b: 1, a: ['x', 2], c: 'q"\\\n\u0001é' })).toBe(
      '{"a":["x",2],"b":1,"c":"q\\"\\\\\\n\\u0001é"}',
    );
  });

  it('refuses a value it has no text for', () => {
    expect(() => canonicalText({ n: 1.5 })).toThrow(/not an integer/);
    expect(() => canonicalText({ n: null })).toThrow(/no canonical text/);
    expect(() => canonicalText([true])).toThrow(/no canonical text/);
  });

  it('is the text the C tests verify the fixture index over', () => {
    const index = JSON.parse(fixture('index.json')) as { worlds: unknown; signed: string };
    expect(canonicalText(index.worlds)).toBe(fixture('index.canonical.txt'));
  });
});

describe('signing', () => {
  it('the test key signs the fixture index as the C tests hold it', () => {
    const index = JSON.parse(fixture('index.json')) as { worlds: unknown; signed: string };
    expect(`${index.signed}\n`).toBe(fixture('index.signature.txt'));
    expect(signWorlds(index.worlds, privateKeyOf(readKeyFile(TEST_KEY)))).toBe(index.signed);
    expect(worldsAreSigned(index.worlds, index.signed, TEST_PUBLIC)).toBe(true);
  });

  it('the test key pair is a pair', () => {
    expect(publicKeyHex(privateKeyOf(readKeyFile(TEST_KEY)))).toBe(TEST_PUBLIC);
  });

  it('a changed list, another key or a signature that is not one does not verify', () => {
    const key = privateKeyOf(readKeyFile(TEST_KEY));
    const worlds = [{ title: 'T', bytes: 1 }];
    const signed = signWorlds(worlds, key);
    expect(worldsAreSigned(worlds, signed, TEST_PUBLIC)).toBe(true);
    expect(worldsAreSigned([{ title: 'T', bytes: 2 }], signed, TEST_PUBLIC)).toBe(false);
    expect(worldsAreSigned(worlds, signed, '00'.repeat(32))).toBe(false);
    expect(worldsAreSigned(worlds, 'zz', TEST_PUBLIC)).toBe(false);
  });
});

describe('readKeyFile', () => {
  it('reads 64 lowercase hexadecimal digits and refuses anything else in words', () => {
    const dir = scratch();
    const bad = join(dir, 'bad.key');
    writeFileSync(bad, 'not a key\n');
    expect(() => readKeyFile(bad)).toThrow(/should hold 64 lowercase hexadecimal digits/);
    writeFileSync(bad, `${'AB'.repeat(32)}\n`);
    expect(() => readKeyFile(bad)).toThrow(/should hold 64 lowercase hexadecimal digits/);
    expect(() => readKeyFile(join(dir, 'absent.key'))).toThrow(/cannot be read/);
    expect(readKeyFile(TEST_KEY)).toHaveLength(32);
  });
});

describe('writeKeyPair', () => {
  it('writes a private key only its owner can read, and its public half', () => {
    const prefix = join(scratch(), 'publisher');
    const pair = writeKeyPair(prefix);
    expect(pair.privateFile).toBe(`${prefix}.key`);
    expect(pair.publicFile).toBe(`${prefix}.pub`);
    expect(statSync(pair.privateFile).mode & 0o077).toBe(0);
    const seed = readKeyFile(pair.privateFile);
    expect(readFileSync(pair.publicFile, 'utf8')).toBe(`${pair.publicKey}\n`);
    expect(publicKeyHex(privateKeyOf(seed))).toBe(pair.publicKey);
    const worlds = [{ title: 'T' }];
    expect(worldsAreSigned(worlds, signWorlds(worlds, privateKeyOf(seed)), pair.publicKey)).toBe(
      true,
    );
  });

  it('never replaces either file, and writes neither when one is there', () => {
    const dir = scratch();
    const first = writeKeyPair(join(dir, 'publisher'));
    const seed = readFileSync(first.privateFile, 'utf8');
    expect(() => writeKeyPair(join(dir, 'publisher'))).toThrow(
      /publisher\.key already exists, and a key is never replaced/,
    );
    expect(readFileSync(first.privateFile, 'utf8')).toBe(seed);
    writeFileSync(join(dir, 'other.pub'), 'mine\n');
    expect(() => writeKeyPair(join(dir, 'other'))).toThrow(/other\.pub already exists/);
    expect(() => readFileSync(join(dir, 'other.key'))).toThrow();
    expect(readFileSync(join(dir, 'other.pub'), 'utf8')).toBe('mine\n');
  });

  it('says so in words where the folder is not there', () => {
    expect(() => writeKeyPair(join(scratch(), 'absent', 'publisher'))).toThrow(
      /cannot be written: name a folder that exists/,
    );
  });
});
