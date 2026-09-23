// The host's blessed libraries (the spec's Host › Two decisions; Kinds ›
// Libraries and namespaces). Blessing is a quota decision, not a safety
// one: a library whose content hash the host has blessed costs an author
// nothing toward the source, kind and file caps, and a modified copy
// hashes differently and is the author's own source.
//
// The set is the host's, as its limits are. What is here is the one
// entry a host starts from, the standard library as it travels with the
// CLI, so that using it costs an author nothing (the spec's Limits ›
// Static caps). The exemption is granted at publish and recorded in the
// bundle, beside each library; a load honours what was recorded.

import { libraryHash, type Bundle } from './bundle.js';
import { STANDARD_LIBRARY } from './standard-library.js';

/** A library content hash as `libraryHash` writes it: SHA-256, in lower-case hex. */
const HASH = /^[0-9a-f]{64}$/;

/** The blessed set a host starts from: the standard library's hash, and nothing else. */
export const DEFAULT_BLESSED: ReadonlySet<string> = new Set([libraryHash(STANDARD_LIBRARY)]);

/** The host's blessing configuration: hashes it blesses beyond the default, and default ones it does not. */
export interface BlessedOverrides {
  readonly bless?: readonly string[];
  readonly unbless?: readonly string[];
}

/**
 * A host misconfiguring its blessed set is a mistake in the host, not a
 * problem with a world, so it is thrown at the boot that made it, as a
 * bad limit is.
 */
export class BlessedError extends Error {
  constructor(
    readonly hash: string,
    detail: string,
  ) {
    super(`${hash}: ${detail}`);
    this.name = 'BlessedError';
  }
}

/**
 * The hashes a host blesses: the default set, with what it blesses added
 * and what it unblesses taken out. Every hash is checked here, so that a
 * mistyped one is caught at boot rather than charged to an author.
 */
export function blessedFrom(overrides: BlessedOverrides = {}): ReadonlySet<string> {
  const blessed = new Set(DEFAULT_BLESSED);
  for (const hash of overrides.bless ?? []) blessed.add(checked(hash));
  for (const hash of overrides.unbless ?? []) {
    if (!blessed.delete(checked(hash))) throw new BlessedError(hash, 'is not blessed.');
  }
  return blessed;
}

function checked(hash: string): string {
  if (!HASH.test(hash)) {
    throw new BlessedError(hash, 'is not a library hash: 64 lower-case hexadecimal digits.');
  }
  return hash;
}

/**
 * The library hashes a bundle records the host as having blessed, in
 * order and without repeats: what a host keeps of a publish, to honour at
 * the next load.
 */
export function blessedIn(bundle: Bundle): string[] {
  return [
    ...new Set(bundle.libraries.filter((library) => library.blessed).map((l) => l.hash)),
  ].sort();
}
