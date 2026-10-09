// The cartridge: a compiled, versioned, self-contained file that a runtime
// loads in place of the source (the spec's The compiler › What compiling
// produces; Language levels; Kinds › Libraries and namespaces).
//
// Sixteen bytes, then gzip-compressed JSON: the magic `SPRT`, the format
// version and the language level as little-endian 16-bit numbers, and eight
// reserved zeros. Libraries are statically linked, so the cartridge is
// closed: it holds the world's declarations resolved, its bodies and prose
// as trees with every name bound, and the caps it was checked against, and
// neither source text nor diagnostics. A runtime refuses a format or a
// level newer than it reads, naming the number.

import { synonymPhrases } from '../declare/synonyms.js';
import type { ResolvedVerb } from '../declare/verbs.js';
import { gunzip, gzip } from '../source/gzip.js';
import { LANGUAGE_LEVEL, type Bundle } from './bundle.js';
import { CartridgeSchema, type Cartridge } from './cartridge-schema.js';
import { writeGraph, type Entry, type Rewrite } from './cartridge-graph.js';

/** The four bytes every cartridge begins with. */
export const CARTRIDGE_MAGIC = 'SPRT';

/** The layout of the file this code writes and reads; raised only when the layout changes. */
export const CARTRIDGE_FORMAT = 1;

/** The bytes before the compressed JSON. */
export const CARTRIDGE_HEADER_BYTES = 16;

/** The file extension a cartridge is kept under. */
export const CARTRIDGE_EXTENSION = '.sproutworld';

/** What the sixteen bytes say. */
export interface CartridgeHeader {
  readonly format: number;
  readonly level: number;
}

/** A file that cannot be read as a cartridge, said in words for whoever ran it. */
export class CartridgeUnreadable extends Error {
  override readonly name = 'CartridgeUnreadable';
}

/** The sixteen bytes that begin a cartridge of this `level`. */
function headerBytes(level: number): Uint8Array {
  const bytes = new Uint8Array(CARTRIDGE_HEADER_BYTES);
  bytes.set(new TextEncoder().encode(CARTRIDGE_MAGIC));
  const view = new DataView(bytes.buffer);
  view.setUint16(4, CARTRIDGE_FORMAT, true);
  view.setUint16(6, level, true);
  return bytes;
}

/**
 * What the first sixteen bytes of `bytes` say, refusing a file that is not
 * a cartridge, one of a format newer than this reads, and one written for
 * a language level newer than this compiler's.
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
  if (level > LANGUAGE_LEVEL) {
    throw new CartridgeUnreadable(
      `This cartridge was made for language level ${level}, and this runtime reads up to level ${LANGUAGE_LEVEL}. Update the runtime, or pack the world again with this one.`,
    );
  }
  return { format, level };
}

/**
 * A cartridge's bytes, read: the header checked, the body inflated and held
 * to the schema. Refuses, in words, whatever is wrong with the file.
 */
export function readCartridge(bytes: Uint8Array): Cartridge {
  readCartridgeHeader(bytes);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(
      gunzip(bytes.subarray(CARTRIDGE_HEADER_BYTES)),
    );
  } catch (thrown) {
    throw new CartridgeUnreadable(
      `This cartridge cannot be read: ${thrown instanceof Error ? thrown.message : String(thrown)}.`,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new CartridgeUnreadable('This cartridge cannot be read: its body is not JSON.');
  }
  const parsed = CartridgeSchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first === undefined ? '' : ` at \`${first.path.join('.')}\``;
    throw new CartridgeUnreadable(
      `This cartridge is not shaped as a cartridge is${where}: ${first?.message ?? 'it is damaged'}.`,
    );
  }
  return parsed.data;
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
      names: bundle.names,
      optionSlots: bundle.optionSlots,
    },
    withoutSynonyms(),
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
    caps: { ...bundle.caps },
    extensions: bundle.extensions.map(({ name, major }) => ({ name, major })),
  } as Cartridge;
}

/** `bundle` as the bytes of a cartridge: the header, then its JSON, gzip-compressed. */
export function emitCartridge(bundle: Bundle): Uint8Array {
  const body = gzip(new TextEncoder().encode(JSON.stringify(cartridgeOf(bundle))));
  const out = new Uint8Array(CARTRIDGE_HEADER_BYTES + body.length);
  out.set(headerBytes(bundle.level));
  out.set(body, CARTRIDGE_HEADER_BYTES);
  return out;
}
