// The publisher's keys and signature over the index of published worlds
// (sprout-player/index.schema.json; docs/design/sprout-playdate.md, Shipped
// worlds and downloads). The Playdate app verifies the signature in C over
// the same canonical text (sprout-player/src/canonical.c), byte for byte.
//
// A private key file holds the 32-byte Ed25519 seed as 64 lowercase
// hexadecimal digits, and a public key file the 32-byte key the same way.

import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/**
 * The canonical text of a value: no spaces, object keys in order, strings as
 * JSON.stringify writes them, integers in decimal. Only strings, integers,
 * arrays and objects have one.
 */
export function canonicalText(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isInteger(value))
      throw new Error(`${value} is not an integer, so it has no canonical text.`);
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalText).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalText(record[key])}`).join(',')}}`;
  }
  throw new Error(`${String(value)} has no canonical text.`);
}

/** A key file's 32 bytes, read from its 64 hexadecimal digits. */
export function readKeyFile(path: string): Buffer {
  let text: string;
  try {
    text = readFileSync(path, 'utf8').trim();
  } catch {
    throw new Error(`${path} cannot be read: name the key file \`sprout keygen\` wrote.`);
  }
  if (!/^[0-9a-f]{64}$/.test(text)) {
    throw new Error(
      `${path} should hold 64 lowercase hexadecimal digits (a 32-byte Ed25519 key) and nothing else.`,
    );
  }
  return Buffer.from(text, 'hex');
}

/** The private key a 32-byte seed makes. */
export function privateKeyOf(seed: Buffer): KeyObject {
  return createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
}

/** The 32-byte public key of a private key, as 64 hexadecimal digits. */
export function publicKeyHex(privateKey: KeyObject): string {
  return createPublicKey(privateKey)
    .export({ format: 'der', type: 'spki' })
    .subarray(SPKI_PREFIX.length)
    .toString('hex');
}

/** The signature, as 128 hexadecimal digits, over the canonical text of `worlds`. */
export function signWorlds(worlds: unknown, privateKey: KeyObject): string {
  return sign(null, Buffer.from(canonicalText(worlds)), privateKey).toString('hex');
}

/** Whether `signed` is the signature of the key `publicKey` (64 hexadecimal digits) over the canonical text of `worlds`. */
export function worldsAreSigned(worlds: unknown, signed: string, publicKey: string): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.concat([SPKI_PREFIX, Buffer.from(publicKey, 'hex')]),
      format: 'der',
      type: 'spki',
    });
    return verify(null, Buffer.from(canonicalText(worlds)), key, Buffer.from(signed, 'hex'));
  } catch {
    return false;
  }
}

/** The files a key pair is written to, and the public key as 64 hexadecimal digits. */
export interface KeyPairFiles {
  privateFile: string;
  publicFile: string;
  publicKey: string;
}

/**
 * Writes a new key pair to `<prefix>.key`, readable by its owner only, and
 * `<prefix>.pub`. Refuses, writing neither, where either file exists.
 */
export function writeKeyPair(prefix: string): KeyPairFiles {
  const privateFile = `${prefix}.key`;
  const publicFile = `${prefix}.pub`;
  for (const file of [privateFile, publicFile]) {
    if (existsSync(file))
      throw new Error(`${file} already exists, and a key is never replaced: give another name.`);
  }
  const { privateKey } = generateKeyPairSync('ed25519');
  const seed = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(PKCS8_PREFIX.length);
  const publicKey = publicKeyHex(privateKey);
  writeNew(privateFile, `${seed.toString('hex')}\n`, 0o600);
  try {
    writeNew(publicFile, `${publicKey}\n`, 0o644);
  } catch (err) {
    rmSync(privateFile);
    throw err;
  }
  return { privateFile, publicFile, publicKey };
}

/** Writes `text` to `file`, which must not exist yet. */
function writeNew(file: string, text: string, mode: number): void {
  try {
    writeFileSync(file, text, { mode, flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST')
      throw new Error(`${file} already exists, and a key is never replaced: give another name.`);
    throw new Error(`${file} cannot be written: name a folder that exists and you may write to.`);
  }
}
