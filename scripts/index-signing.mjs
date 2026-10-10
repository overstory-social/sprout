// The index of published worlds that the Playdate app's download screen reads
// (sprout-player/index.schema.json), and the keys that sign it: building the index from a
// folder of cartridges, its canonical text, Ed25519 signing and verifying. scripts/publish-index.mjs
// is the command line over this; the specs and the app's Lua (Source/canonical.lua) agree with
// `canonicalText` byte for byte.
//
// A private key is a file holding the 32-byte Ed25519 seed as 64 hexadecimal digits; a public key
// is a file holding the 32-byte key the same way. Private keys never enter the repository.

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { CARTRIDGE_EXTENSION, readCartridge } from '@overstory/sprout/lang';

const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/**
 * The canonical text of a value: no spaces, object keys in order, strings as JSON.stringify
 * writes them, integers in decimal. Only strings, integers, arrays and objects have one, and an
 * empty object is not told from an empty array (an index holds neither where it matters).
 */
export function canonicalText(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new Error(`${value} is not an integer, so it has no canonical text`);
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalText).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalText(value[key])}`).join(',')}}`;
  }
  throw new Error(`${String(value)} has no canonical text`);
}

/** A key file's 32 bytes, read from 64 hexadecimal digits. */
export function readKeyFile(path) {
  const text = readFileSync(path, 'utf8').trim();
  if (!/^[0-9a-f]{64}$/.test(text)) {
    throw new Error(`${path} should hold 64 lowercase hexadecimal digits (a 32-byte Ed25519 key) and nothing else.`);
  }
  return Buffer.from(text, 'hex');
}

/** The private key a seed makes. */
export function privateKeyOf(seed) {
  return createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' });
}

/** The 32-byte public key of a private key, as 64 hexadecimal digits. */
export function publicKeyHex(privateKey) {
  return createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(SPKI_PREFIX.length).toString('hex');
}

/** A new key pair as { seed, publicKey }, both 64 hexadecimal digits. */
export function generateKeyPair() {
  const { privateKey } = generateKeyPairSync('ed25519');
  const seed = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(PKCS8_PREFIX.length);
  return { seed: seed.toString('hex'), publicKey: publicKeyHex(privateKey) };
}

/** The signature, as 128 hexadecimal digits, over the canonical text of `worlds`. */
export function signWorlds(worlds, privateKey) {
  return sign(null, Buffer.from(canonicalText(worlds)), privateKey).toString('hex');
}

/** Whether an index's `signed` is the key's signature over the canonical text of its `worlds`. */
export function indexIsSigned(index, publicKey) {
  try {
    const key = createPublicKey({
      key: Buffer.concat([SPKI_PREFIX, Buffer.from(publicKey, 'hex')]),
      format: 'der',
      type: 'spki',
    });
    return verify(null, Buffer.from(canonicalText(index.worlds)), key, Buffer.from(index.signed, 'hex'));
  } catch {
    return false;
  }
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Every file under `dir`, as paths relative to it with `/`, in order. */
function filesUnder(dir, prefix = '') {
  const found = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) found.push(...filesUnder(full, `${prefix}${name}/`));
    else found.push(`${prefix}${name}`);
  }
  return found;
}

const encode = (relative) => relative.split('/').map(encodeURIComponent).join('/');

/**
 * The `worlds` of an index for the cartridges in `dir`: each `.sproutworld`, with the files of its
 * `.assets` folder, if it has one. Addresses are `baseUrl` followed by the file's path below `dir`.
 */
export function worldsOf(dir, baseUrl) {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const worlds = [];
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(CARTRIDGE_EXTENSION)) continue;
    const bytes = readFileSync(join(dir, file));
    const { header } = readCartridge(bytes);
    const world = {
      title: header.name,
      author: header.author,
      version: header.version,
      bytes: bytes.length,
      hash: header.hash,
      sha256: sha256(bytes),
      url: base + encode(file),
    };
    const assetsFolder = join(dir, `${file}.assets`);
    let assets = [];
    try {
      assets = filesUnder(assetsFolder).map((path) => {
        const content = readFileSync(join(assetsFolder, ...path.split('/')));
        return {
          path,
          bytes: content.length,
          sha256: sha256(content),
          url: `${base}${encode(file)}.assets/${encode(path)}`,
        };
      });
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    if (assets.length > 0) world.assets = assets;
    worlds.push(world);
  }
  if (worlds.length === 0) {
    throw new Error(`${dir} holds no ${CARTRIDGE_EXTENSION} cartridge (pack worlds with \`sprout pack\` first).`);
  }
  return worlds;
}

/** The signed index for the cartridges in `dir`. */
export function buildIndex(dir, baseUrl, privateKey) {
  const worlds = worldsOf(dir, baseUrl);
  return { worlds, signed: signWorlds(worlds, privateKey) };
}
