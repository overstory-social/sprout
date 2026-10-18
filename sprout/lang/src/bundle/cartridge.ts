// The cartridge: a compiled, versioned, self-contained file that a runtime
// loads in place of the source (the spec's The compiler › What compiling
// produces; Language levels; Kinds › Libraries and namespaces).
//
// Twenty-four bytes, a gzip-compressed body, then the assets: the magic
// `SPRT`, the format version and the language level as little-endian
// 16-bit numbers, then as 32-bit numbers the body's inflated size, the
// offset of its table, and where the assets section begins in the file and
// its size. The body is a small JSON preamble (what a shelf and the
// catalogue read) and then, eight-aligned, the table of
// `cartridge-table.ts`, which a runtime reads in place; the assets section
// (`cartridge-assets.ts`) holds every file the world's extensions name, so
// a world is one file. Libraries are statically linked, so the cartridge is
// closed: it holds the world's declarations resolved, its bodies and prose
// as trees with every name bound (`cartridge-names.ts`), and the caps it was checked against, and
// neither source text nor diagnostics. A runtime refuses a format or a
// level newer than it reads, naming the number.

import { typedWords } from '../declare/addressing.js';
import { synonymPhrases } from '../declare/synonyms.js';
import type { ResolvedVerb } from '../declare/verbs.js';
import { gunzip, gzip } from '../source/gzip.js';
import { LANGUAGE_LEVEL, type Bundle } from './bundle.js';
import { PreambleSchema, type Cartridge, type Preamble } from './cartridge-schema.js';
import { writeGraph, type Entry, type GraphTables, type Rewrite } from './cartridge-graph.js';
import { namesWritten } from './cartridge-names.js';
import { readTable, TableUnreadable, writeTable } from './cartridge-table.js';
import {
  assetDirectory,
  AssetsUnreadable,
  readAssets,
  writeAssets,
  type CartridgeAsset,
} from './cartridge-assets.js';

/** The four bytes every cartridge begins with. */
export const CARTRIDGE_MAGIC = 'SPRT';

/** The layout of the file this code writes and reads; raised only when the layout changes, and only the current one is read. */
export const CARTRIDGE_FORMAT = 5;

/** The bytes before the compressed body. */
export const CARTRIDGE_HEADER_BYTES = 24;

/** The file extension a cartridge is kept under. */
export const CARTRIDGE_EXTENSION = '.sproutworld';

/** What the header's bytes say. */
export interface CartridgeHeader {
  readonly format: number;
  readonly level: number;
  /** The body's size once inflated, and where its table begins in it. */
  readonly bodyBytes: number;
  readonly tableAt: number;
  /** Where the assets section begins in the file, which is where the compressed body ends, and its size. */
  readonly assetsAt: number;
  readonly assetsBytes: number;
}

/** A file that cannot be read as a cartridge, said in words for whoever ran it. */
export class CartridgeUnreadable extends Error {
  override readonly name = 'CartridgeUnreadable';
}

/** The header that begins a cartridge of this `level`, as `CartridgeHeader` names its fields. */
function headerBytes(
  level: number,
  bodyBytes: number,
  tableAt: number,
  assetsAt: number,
  assetsBytes: number,
): Uint8Array {
  const bytes = new Uint8Array(CARTRIDGE_HEADER_BYTES);
  bytes.set(new TextEncoder().encode(CARTRIDGE_MAGIC));
  const view = new DataView(bytes.buffer);
  view.setUint16(4, CARTRIDGE_FORMAT, true);
  view.setUint16(6, level, true);
  view.setUint32(8, bodyBytes, true);
  view.setUint32(12, tableAt, true);
  view.setUint32(16, assetsAt, true);
  view.setUint32(20, assetsBytes, true);
  return bytes;
}

/**
 * What the header of `bytes` says, refusing a file that is not
 * a cartridge, one of a format other than the one this reads, and one
 * written for a language level newer than this compiler's.
 */
export function readCartridgeHeader(bytes: Uint8Array): CartridgeHeader {
  if (
    bytes.length < CARTRIDGE_HEADER_BYTES ||
    new TextDecoder().decode(bytes.subarray(0, 4)) !== CARTRIDGE_MAGIC
  ) {
    throw new CartridgeUnreadable(
      'This is not a Sprout cartridge: it does not begin with `SPRT`. Pack a world with `sprout pack`.',
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const format = view.getUint16(4, true);
  const level = view.getUint16(6, true);
  if (format > CARTRIDGE_FORMAT) {
    throw new CartridgeUnreadable(
      `This cartridge is format version ${format}, and this runtime reads up to version ${CARTRIDGE_FORMAT}. Update the runtime, or pack the world again with this one.`,
    );
  }
  if (format < 1) {
    throw new CartridgeUnreadable(
      `This cartridge says it is format version ${format}, and versions begin at 1. It is damaged.`,
    );
  }
  if (format < CARTRIDGE_FORMAT) {
    throw new CartridgeUnreadable(
      `This cartridge is format version ${format}, and this runtime reads version ${CARTRIDGE_FORMAT}. Pack the world again with \`sprout pack\`.`,
    );
  }
  if (level > LANGUAGE_LEVEL) {
    throw new CartridgeUnreadable(
      `This cartridge was made for language level ${level}, and this runtime reads up to level ${LANGUAGE_LEVEL}. Update the runtime, or pack the world again with this one.`,
    );
  }
  return {
    format,
    level,
    bodyBytes: view.getUint32(8, true),
    tableAt: view.getUint32(12, true),
    assetsAt: view.getUint32(16, true),
    assetsBytes: view.getUint32(20, true),
  };
}

/**
 * A cartridge's bytes, read: the header checked, the body inflated and held
 * to the schema. Refuses, in words, whatever is wrong with the file.
 */
export function readCartridge(bytes: Uint8Array): Cartridge {
  const header = readCartridgeHeader(bytes);
  const directory = assetsOf(bytes, header);
  let body: Uint8Array;
  try {
    body = gunzip(bytes.subarray(CARTRIDGE_HEADER_BYTES, header.assetsAt));
  } catch (thrown) {
    throw new CartridgeUnreadable(
      `This cartridge cannot be read: ${thrown instanceof Error ? thrown.message : String(thrown)}.`,
    );
  }
  if (
    body.length !== header.bodyBytes ||
    header.tableAt > body.length ||
    header.tableAt % 8 !== 0
  ) {
    throw new CartridgeUnreadable(
      'This cartridge cannot be read: its body is not the size its header says.',
    );
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(body.subarray(0, header.tableAt));
  } catch {
    throw new CartridgeUnreadable('This cartridge cannot be read: its preamble is not UTF-8.');
  }
  let json: unknown;
  try {
    json = JSON.parse(text.replace(/\0+$/, ''));
  } catch {
    throw new CartridgeUnreadable('This cartridge cannot be read: its preamble is not JSON.');
  }
  const parsed = PreambleSchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first === undefined ? '' : ` at \`${first.path.join('.')}\``;
    throw new CartridgeUnreadable(
      `This cartridge is not shaped as a cartridge is${where}: ${first?.message ?? 'it is damaged'}.`,
    );
  }
  let tables: GraphTables;
  try {
    tables = readTable(body.subarray(header.tableAt));
  } catch (thrown) {
    if (!(thrown instanceof TableUnreadable)) throw thrown;
    throw new CartridgeUnreadable(
      `This cartridge is not shaped as a cartridge is at \`table\`: ${thrown.message}.`,
    );
  }
  const listed = parsed.data.extensions.flatMap((extension) =>
    (extension.assets ?? []).map((asset) => asset.path),
  );
  const held = [...directory.keys()];
  if (listed.length !== held.length || listed.some((path) => !directory.has(path))) {
    throw new CartridgeUnreadable(
      'This cartridge cannot be read: its assets are not the files its extensions list.',
    );
  }
  return withEntries(parsed.data, tables);
}

/** The assets section's directory, refusing a section that is not where the header says or is damaged. */
function assetsOf(bytes: Uint8Array, header: CartridgeHeader): Map<string, Uint8Array> {
  if (
    header.assetsAt < CARTRIDGE_HEADER_BYTES ||
    header.assetsAt + header.assetsBytes !== bytes.length
  ) {
    throw new CartridgeUnreadable(
      'This cartridge cannot be read: it is not the size its header says.',
    );
  }
  try {
    return assetDirectory(bytes.subarray(header.assetsAt));
  } catch (thrown) {
    if (!(thrown instanceof AssetsUnreadable)) throw thrown;
    throw new CartridgeUnreadable(`This cartridge's assets cannot be read: ${thrown.message}.`);
  }
}

/** Every file a cartridge's extensions name, as their extensions packed them, read and inflated. */
export function readCartridgeAssets(bytes: Uint8Array): CartridgeAsset[] {
  const header = readCartridgeHeader(bytes);
  assetsOf(bytes, header);
  try {
    return readAssets(bytes.subarray(header.assetsAt));
  } catch (thrown) {
    if (!(thrown instanceof AssetsUnreadable)) throw thrown;
    throw new CartridgeUnreadable(`This cartridge's assets cannot be read: ${thrown.message}.`);
  }
}

/** The cartridge a preamble and its table make together. */
function withEntries(preamble: Preamble, tables: GraphTables): Cartridge {
  return {
    ...preamble,
    prose: { entries: tables.prose as Entry[] },
    bodies: { ...preamble.bodies, entries: tables.bodies as Entry[] },
    table: { ...preamble.table, entries: tables.rest as Entry[] },
  };
}

/** The preamble of a cartridge: everything but the entries, which the table holds. */
export function preambleOf(cartridge: Cartridge): Preamble {
  const { prose: _prose, bodies, table, ...rest } = cartridge;
  const { entries: _bodyEntries, ...bodyRest } = bodies;
  const { entries: _tableEntries, ...tableRest } = table;
  return { ...rest, bodies: bodyRest, table: tableRest };
}

/** Whether `value` is a resolved verb or the declaration it was resolved from: the two things that carry a verb's own synonyms. */
function carriesSynonyms(value: object): boolean {
  return 'phrases' in value && 'synonyms' in value && ('roles' in value || 'name' in value);
}

/** Whether `value` is a synonym of the world's or of one object's, which holds the phrases it gives. */
function isScopedSynonym(value: object): boolean {
  return 'verb' in value && 'words' in value && 'phrases' in value && 'object' in value;
}

/**
 * Synonyms do not travel (the spec's Parsing › Synonyms): a verb's own are
 * written as the phrases they give, appended to its phrases, and a scoped
 * one as the phrases it gives; the words themselves are left out. The same array is written wherever it is read.
 */
function withoutSynonyms(): Rewrite {
  const expanded = new WeakMap<object, unknown>();
  return (owner, key, value) => {
    if (isScopedSynonym(owner)) return key === 'words' ? undefined : value;
    if (!carriesSynonyms(owner)) return value;
    if (key === 'synonyms') return undefined;
    const verb = owner as ResolvedVerb;
    if (key !== 'phrases' || !('declaration' in owner)) return value;
    let phrases = expanded.get(owner);
    if (phrases === undefined) {
      phrases = [...verb.phrases, ...verb.synonyms.flatMap((words) => synonymPhrases(verb, words))];
      expanded.set(owner, phrases);
    }
    return phrases;
  };
}

/**
 * The typed words travel final (the spec's Parsing): a phrase's words are written as the
 * tokeniser reads a typed line, lower case, split on white space with each comma a word of its
 * own, joined by single spaces; and an exit's or a link's label carries the same beside its text.
 * A reader of another language compares bytes and folds nothing.
 */
function withTypedWords(): Rewrite {
  const labels = new WeakMap<object, unknown>();
  return (owner, key, value) => {
    if (key === 'text' && (owner as { part?: unknown }).part === 'words') {
      return typedWords(value as string).join(' ');
    }
    if (key !== 'label' || (value as { kind?: unknown }).kind !== 'grammar-label') return value;
    let written = labels.get(value as object);
    if (written === undefined) {
      const label = value as { text: string };
      written = { ...label, typed: typedWords(label.text).join(' ') };
      labels.set(value as object, written);
    }
    return written;
  };
}

/** The rewrites composed, each seeing what the one before wrote. */
function composed(...rewrites: Rewrite[]): Rewrite {
  return (owner, key, value) =>
    rewrites.reduce<unknown>(
      (written, rewrite) => (written === undefined ? undefined : rewrite(owner, key, written)),
      value,
    );
}

/**
 * The cartridge a published bundle compiles to. A bundle running with a
 * gap in `absent` is a loaded world and not one that published, and is
 * refused: a cartridge is closed, and a gap is the one thing it cannot hold.
 */
export function cartridgeOf(bundle: Bundle): Cartridge {
  if (bundle.absent.length > 0) {
    throw new Error(
      `${bundle.manifest.name} has ${bundle.absent.length} gap(s) in what it needs, and a cartridge holds a world whole. Compile it strictly, and fix what \`sprout check\` says.`,
    );
  }
  const names = namesWritten(new Set(bundle.names.keys()));
  const { roots, tables } = writeGraph(
    {
      kinds: bundle.kinds,
      world: bundle.world,
      visitor: bundle.visitor,
      contents: bundle.contents,
      verbs: bundle.verbs.all(),
      messages: bundle.messages.all(),
      holds: bundle.tree.holds,
      scoped: bundle.synonyms,
      intents: bundle.intents,
      names: new Map([...bundle.names].map(([node, named]) => [names.key(node), named])),
      optionSlots: bundle.optionSlots,
    },
    composed(withoutSynonyms(), withTypedWords(), names.rewrite),
  );
  const manifest = bundle.manifest;
  return {
    header: {
      name: manifest.name,
      namespace: manifest.namespace,
      version: manifest.version,
      author: manifest.author,
      license: manifest.license,
      level: bundle.level,
      hash: bundle.hash,
      files: [...manifest.files],
      libraries: manifest.libraries.map(({ name, version, sha }) => ({ name, version, sha })),
    },
    // The caps and the extensions come before the big sections, so a reader that wants only
    // what a shelf shows can stop once it has them.
    caps: { ...bundle.caps },
    extensions: bundle.extensions.map(({ name, major }) => {
      const assets = bundle.assets
        .filter((asset) => asset.extension === name)
        .map(({ path, bytes, sha }) => ({ path, bytes, sha }));
      return assets.length === 0 ? { name, major } : { name, major, assets };
    }),
    kinds: {
      all: roots['kinds']!,
      world: roots['world']!,
      visitor: roots['visitor']!,
      contents: roots['contents']!,
    },
    tree: {
      world: bundle.tree.world,
      holds: roots['holds']!,
      arrival: bundle.arrival === null ? null : [...bundle.arrival],
    },
    verbs: roots['verbs']!,
    grammar: {
      scoped: roots['scoped']!,
      intents: roots['intents']!,
      words: [...bundle.words],
    },
    messages: roots['messages']!,
    prose: { entries: tables.prose as Entry[] },
    bodies: {
      entries: tables.bodies as Entry[],
      names: roots['names']!,
      optionSlots: roots['optionSlots']!,
    },
    table: { files: [...tables.files], entries: tables.rest as Entry[] },
  } as Cartridge;
}

/** `bundle` as the bytes of a cartridge: the header, the preamble and the table gzip-compressed together, then the assets. */
export function emitCartridge(bundle: Bundle): Uint8Array {
  const cartridge = cartridgeOf(bundle);
  const preamble = new TextEncoder().encode(JSON.stringify(preambleOf(cartridge)));
  const tableAt = (preamble.length + 7) & ~7;
  const table = writeTable({
    files: cartridge.table.files,
    prose: cartridge.prose.entries,
    bodies: cartridge.bodies.entries,
    rest: cartridge.table.entries,
  });
  const body = new Uint8Array(tableAt + table.length);
  body.set(preamble);
  body.set(table, tableAt);
  const compressed = gzip(body);
  const assets = writeAssets(bundle.assets);
  const assetsAt = CARTRIDGE_HEADER_BYTES + compressed.length;
  const out = new Uint8Array(assetsAt + assets.length);
  out.set(headerBytes(bundle.level, body.length, tableAt, assetsAt, assets.length));
  out.set(compressed, CARTRIDGE_HEADER_BYTES);
  out.set(assets, assetsAt);
  return out;
}
