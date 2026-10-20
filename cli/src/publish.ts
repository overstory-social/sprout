// The signed index of published worlds that the Playdate app's download
// screen fetches (sprout-player/index.schema.json; docs/design/sprout-playdate.md,
// Shipped worlds and downloads): each cartridge in a folder listed with its
// header, size, SHA-256 and address, and signed over the canonical text of
// the list (signing.ts).
//
// Each cartridge is published under the name the app gives what it downloads,
// `<stem>-<first eight digits of the bundle hash>.sproutworld`
// (`player_downloads_stem` in sprout-player/src/ui/downloads.c), so two
// builds of one world sit side by side on the server as on the shelf, and an
// index made again over published files names them as they are.

import { createHash, type KeyObject } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import {
  CARTRIDGE_EXTENSION,
  CartridgeUnreadable,
  readCartridge,
  worldTitle,
} from '@overstory/sprout/lang';

import { signWorlds } from './signing.js';

/** One world the index lists, its members as the schema names them. */
export interface IndexedWorld {
  title: string;
  author: string;
  version: string;
  bytes: number;
  hash: string;
  sha256: string;
  url: string;
}

/** The index: the worlds, and the publisher's signature over their canonical text. */
export interface WorldIndex {
  worlds: IndexedWorld[];
  signed: string;
}

/** The longest stem the app gives a downloaded file. */
const STEM_MOST = 24;

/**
 * The file-name stem the app makes of a title: its ASCII letters, lower
 * case, and digits, each run of anything else between them one hyphen, at
 * most 24 long; `world` where nothing is left.
 */
export function publishedStem(title: string): string {
  let stem = '';
  let hyphen = false;
  for (const byte of new TextEncoder().encode(title)) {
    if (stem.length >= STEM_MOST) break;
    const c = byte >= 0x41 && byte <= 0x5a ? byte + 0x20 : byte;
    if ((c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39)) {
      if (hyphen && stem.length > 0 && stem.length + 1 < STEM_MOST) stem += '-';
      hyphen = false;
      stem += String.fromCharCode(c);
    } else hyphen = true;
  }
  return stem === '' ? 'world' : stem;
}

/** The name a world is published under, and the app saves it as. */
export function publishedName(title: string, hash: string): string {
  return `${publishedStem(title)}-${hash.slice(0, 8)}${CARTRIDGE_EXTENSION}`;
}

/** A cartridge to publish: what the index says of it, and its bytes. */
interface Published {
  name: string;
  world: IndexedWorld;
  bytes: Uint8Array;
  from: string;
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/**
 * The cartridges in `folder`, in the order of their published names, each
 * listed once: two files that would be published under one name are one
 * world where their bytes agree, and refused where they do not.
 */
function cartridgesIn(folder: string, baseUrl: string): Published[] {
  let files: string[];
  try {
    files = readdirSync(folder).filter((file) => file.endsWith(CARTRIDGE_EXTENSION));
  } catch {
    throw new Error(`${folder} is not a folder that can be read: name the folder of cartridges.`);
  }
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const byName = new Map<string, Published>();
  for (const file of files.sort()) {
    const from = join(folder, file);
    const bytes = readFileSync(from);
    let header;
    try {
      ({ header } = readCartridge(bytes));
    } catch (err) {
      if (!(err instanceof CartridgeUnreadable)) throw err;
      throw new Error(`${from}: ${err.message}`);
    }
    const title = worldTitle(header);
    const name = publishedName(title, header.hash);
    const world: IndexedWorld = {
      title,
      author: header.author,
      version: header.version,
      bytes: bytes.length,
      hash: header.hash,
      sha256: sha256(bytes),
      url: base + encodeURIComponent(name),
    };
    const seen = byName.get(name);
    if (seen === undefined) byName.set(name, { name, world, bytes, from });
    else if (seen.world.sha256 !== world.sha256) {
      throw new Error(
        `${seen.from} and ${from} would both be published as ${name}, and their bytes differ: keep one.`,
      );
    }
  }
  if (byName.size === 0) {
    throw new Error(
      `${folder} holds no ${CARTRIDGE_EXTENSION} cartridge: pack each world with \`sprout pack\` first.`,
    );
  }
  return [...byName.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** What `sprout index` was asked to do. */
export interface IndexRequest {
  /** The folder of cartridges. */
  folder: string;
  /** The address the published cartridges are under; each one's is this followed by its name. */
  baseUrl: string;
  privateKey: KeyObject;
  /** The index file to write; the cartridges are written beside it. */
  out: string;
}

/** What `sprout index` wrote. */
export interface IndexWritten {
  index: WorldIndex;
  /** Each cartridge's published name, and whether it was written now rather than found in place. */
  placed: { name: string; written: boolean }[];
}

/**
 * Writes the signed index to `out` and each cartridge beside it under its
 * published name. A file already there under that name is kept where its
 * bytes are the cartridge's, and refused where they are not.
 */
export function writeIndex({ folder, baseUrl, privateKey, out }: IndexRequest): IndexWritten {
  if (!/^https?:\/\/[^/]/.test(baseUrl))
    throw new Error(
      `--base-url ${baseUrl} should be an address beginning http:// or https://, where the cartridges will be served.`,
    );
  if (existsSync(out) && statSync(out).isDirectory())
    throw new Error(`-o names the index file to write, as in \`-o site/worlds/index.json\`.`);
  const published = cartridgesIn(resolve(folder), baseUrl);
  const worlds = published.map((one) => one.world);
  const index: WorldIndex = { worlds, signed: signWorlds(worlds, privateKey) };
  const beside = dirname(resolve(out));
  mkdirSync(beside, { recursive: true });
  const placed = published.map(({ name, world }) => {
    const there = join(beside, name);
    if (!existsSync(there)) return { name, written: true };
    if (sha256(readFileSync(there)) !== world.sha256) {
      throw new Error(
        `${there} is already there with other bytes, and a published cartridge is never replaced: write the index elsewhere.`,
      );
    }
    return { name, written: false };
  });
  published.forEach(({ name, bytes }, at) => {
    if (placed[at]!.written) writeFileSync(join(beside, name), bytes);
  });
  writeFileSync(out, `${JSON.stringify(index, null, 2)}\n`);
  return { index, placed };
}
