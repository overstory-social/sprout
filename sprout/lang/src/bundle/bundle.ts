// What a microworld is made of, and what compiling it produces (the
// spec's Kinds › Libraries and namespaces, The compiler › What compiling
// produces).
//
// Libraries are STATICALLY LINKED. A published microworld carries the
// full source of every library it uses, and nothing is resolved, fetched
// or versioned at run time. A world's behaviour is therefore a function
// of its own bundle: replay stays exact, a library author cannot change
// worlds that have already shipped, and a withdrawn library cannot take
// live worlds with it. It is also what makes whole-bundle checking exact
// rather than a guess — the bundle is CLOSED, so there is nothing the
// compiler cannot see.
//
// The bundle is not a build artifact to keep. Source is the truth, and a
// definition is rebuilt from source every time a world loads, so there
// is nothing to drift from what an author wrote or a moderator reads.
// What outlives a compile is the bundle's HASH, which the log records
// beside every publish so that a segment of the log is read against the
// bundle that produced it.

import type { Absent } from './absent.js';
import type { Declaration } from '../syntax/ast.js';
import type { KindRef } from '../declare/kinds.js';
import type { ResolvedObject } from '../declare/objects.js';
import type { ObjectTree } from '../declare/tree.js';
import type { SourceFile } from '../source/source.js';
import type { StaticCaps } from './limits.js';
import { hashOfNamed } from '../source/sha256.js';

/**
 * The language level: an integer raised only when syntax is ADDED. A
 * microworld's manifest records the level it was written for, a runtime
 * refuses text newer than its compiler, and a policy the language
 * tightens after a text was accepted becomes a warning at load rather
 * than a refusal. The language starts at 1, and nothing in it is shaped
 * by compatibility with anything built before it.
 */
export const LANGUAGE_LEVEL = 1;

/** An extension a world pins, by name and major version. The host supplies it, or it is absent. */
export interface ExtensionPin {
  readonly name: string;
  readonly major: number;
}

/**
 * A library the world uses, as the manifest records it: which one, which
 * version of it, and the hash of the source that was vendored. The sha
 * is the load-bearing field — the name and version are labels, and the
 * hash is what says the source that travelled is the source that was
 * meant to.
 */
export interface LibraryPin {
  readonly name: string;
  readonly version: string;
  /** The content hash of the vendored source, as `libraryHash` computes it. */
  readonly sha: string;
}

/**
 * What a microworld says about itself, before anything of it is read:
 * who made it, under what terms, which version of it this is, exactly
 * which libraries it vendored, and exactly which of its own files there
 * are. Everything here is checkable without a parser, which is the
 * point — closedness and completeness are settled before a line of the
 * language is read.
 */
export interface Manifest {
  /** The world's own name, which its `world` declaration repeats. */
  readonly name: string;
  /** The namespace its declarations are unqualified in: the name unless the manifest says otherwise. */
  readonly namespace: string;
  /** Which version of this world this is. */
  readonly version: string;
  /** Who made it. */
  readonly author: string;
  /** The terms it is offered under, as an SPDX identifier by convention: `MIT`. */
  readonly license: string;
  /** The language level the world was written for. */
  readonly level: number;
  /** The extensions it pins. */
  readonly extensions: readonly ExtensionPin[];
  /** Every library it uses, with the version and the hash of the source that travelled. */
  readonly libraries: readonly LibraryPin[];
  /**
   * Its own `.sprout` and `.prose` files, by name. At publish, what
   * travelled must be exactly this. At load the equality is only
   * flagged: a file the manifest does not name still runs, because
   * refusing to load a world over a bookkeeping difference would darken
   * a room that was accepted once. A file named here that did NOT
   * travel is absent either way.
   */
  readonly files: readonly string[];
}

/** A library as it travels: what it is, the level its source needs, and that source. */
export interface LibrarySource {
  readonly name: string;
  readonly version: string;
  readonly level: number;
  readonly files: readonly SourceFile[];
}

/** A microworld as it arrives: a manifest, its own files, and the vendored source of every library. */
export interface MicroworldSource {
  /** `sprout.json` — where a problem with the manifest names a line and column. */
  readonly manifestFile: SourceFile;
  readonly manifest: Manifest;
  /** The world's own `.sprout` files and the `.prose` files they point at. */
  readonly files: readonly SourceFile[];
  readonly libraries: readonly LibrarySource[];
  /**
   * Files the host is withholding, by name — a moderator's act, and a
   * reversible one. They read as absent at load; a world is not
   * published with a piece held back.
   */
  readonly withheld?: readonly string[];
}

/** A library in a bundle: its source, the hash of it, and whether the host blessed that hash. */
export interface VendoredLibrary extends LibrarySource {
  /** The content hash of its files. A modified copy hashes differently and is the author's own source. */
  readonly hash: string;
  /**
   * Whether the host blessed this hash at publish. Blessing is a quota
   * decision, not a safety one: it changes only whether these bytes
   * count against the author's caps. It is recorded here so that a
   * library later un-blessed does not retroactively push a published
   * world over its limits.
   */
  readonly blessed: boolean;
  /** What its source weighs in UTF-8 bytes. */
  readonly bytes: number;
}

/**
 * The world's complete word set: every word its grammar can match,
 * sorted and without repeats. A nickname is admitted against this, so it
 * travels in the bundle rather than being re-derived. B27 fills it from
 * nouns, tokens, directions, articles, connectors and phrase words.
 */
export type WordSet = readonly string[];

/** What the world's source weighed against the caps, and what was exempt. */
export interface BundleSize {
  /** Files counted against the file cap: the world's own, and any library the host has not blessed. */
  readonly files: number;
  /** UTF-8 bytes counted against the source cap, on the same footing. */
  readonly sourceBytes: number;
  /** UTF-8 bytes of blessed library source, which cost the author nothing. */
  readonly exemptBytes: number;
  /** Kinds counted against the kind cap: the world's own, and any library's the host has not blessed. */
  readonly kinds: number;
  /** The world's own `object` declarations, counted against the object cap. */
  readonly objects: number;
  /** The world's objects that hold actors, counted against the place cap. */
  readonly places: number;
}

/** What compiling a closed bundle produces. */
export interface Bundle {
  /** What the world says about itself: its name, version, author, terms, parts. */
  readonly manifest: Manifest;
  /**
   * The definitions, rebuilt from source at every load and never
   * persisted. The union grows as the syntax items land; what holds from
   * the start is that every one of them carries a span. Which library a
   * declaration belongs to is recoverable from the file its span names.
   */
  readonly definitions: readonly Declaration[];
  /** Every kind the bundle declares, composed, the world's and its libraries' alike. */
  readonly kinds: readonly KindRef[];
  /**
   * The world's objects, each with its anonymous kind composed and its
   * place in the tree. One whose kind or container is absent is absent
   * too, and is not here.
   */
  readonly objects: readonly ResolvedObject[];
  /**
   * The containment tree as declared: the world at its root and every
   * object that was placed, one whose kind is absent included, so that
   * what it holds keeps its place for when the kind returns.
   */
  readonly tree: ObjectTree;
  readonly words: WordSet;
  /** The highest level of any part, library source included. */
  readonly level: number;
  readonly extensions: readonly ExtensionPin[];
  readonly libraries: readonly VendoredLibrary[];
  /**
   * The static caps it was checked against, recorded at publish. A host
   * loading a bundle checked against larger caps than its own decides
   * for itself whether to run it.
   */
  readonly caps: StaticCaps;
  readonly size: BundleSize;
  /**
   * The gaps this world is running with: what is missing, withheld,
   * mismatched or broken, and what the world does without it. Empty for
   * anything that published, since publishing is strict; a loaded world
   * with an entry here runs, visibly, around it.
   */
  readonly absent: readonly Absent[];
  /** The hash of the closed bundle: what the log records beside a publish. */
  readonly hash: string;
}

/** What a text weighs in UTF-8 bytes, which is what a source cap counts. */
export function bytesOf(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** What a set of files weighs in UTF-8 bytes. */
export function sourceBytesOf(files: readonly SourceFile[]): number {
  return files.reduce((bytes, file) => bytes + bytesOf(file.text), 0);
}

/**
 * A library's content hash: its files by name and text, and nothing
 * else. Not its level, not its version and not the name it was vendored
 * under, so that two copies of one library hash alike wherever they were
 * vendored from and a host's blessed set is about source and nothing
 * else. This is what a manifest's `sha` is checked against.
 */
export function libraryHash(library: LibrarySource): string {
  return hashOfNamed(library.files.map((file) => [file.name, file.text] as const));
}

/** The manifest as the compiler read it, written down one way so that it hashes one way. */
function canonicalManifest(manifest: Manifest): string {
  const by = <T>(key: (item: T) => string) => {
    return (a: T, b: T): number => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
  };
  return JSON.stringify({
    name: manifest.name,
    namespace: manifest.namespace,
    version: manifest.version,
    author: manifest.author,
    license: manifest.license,
    level: manifest.level,
    extensions: [...manifest.extensions]
      .sort(by((pin: ExtensionPin) => pin.name))
      .map((pin) => [pin.name, pin.major]),
    libraries: [...manifest.libraries]
      .sort(by((pin: LibraryPin) => pin.name))
      .map((pin) => [pin.name, pin.version, pin.sha]),
    files: [...manifest.files].sort(),
  });
}

/**
 * The hash of a closed bundle: the manifest as the compiler read it, the
 * world's own files, and each library by name, level and hash. Two
 * bundles hash alike exactly when they would run alike.
 */
export function bundleHashOf(
  manifest: Manifest,
  files: readonly SourceFile[],
  libraries: readonly VendoredLibrary[],
): string {
  const parts: [string, string][] = [
    ['manifest', canonicalManifest(manifest)],
    ...libraries.map(
      (library) =>
        [`library:${library.name}`, `${library.level}:${library.hash}`] as [string, string],
    ),
    ...files.map((file) => [`file:${file.name}`, file.text] as [string, string]),
  ];
  return hashOfNamed(parts);
}
