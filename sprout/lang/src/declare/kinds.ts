// A kind, as typing and declaration resolution ask about it. B19 composes
// kinds and B21 namespaces them; both produce something that satisfies
// `KindRef`, and nothing here needs the rest.

import type { ResolvedProperty } from './properties.js';
import { qualifiedName } from './enums.js';

export interface KindRef {
  readonly library: string;
  readonly name: string;
  /**
   * Every kind this one composes, itself included, by qualified name.
   * The closure is computed once so that "does this compose that" is
   * one lookup.
   */
  readonly composes: ReadonlySet<string>;
  /** What it declares, by name, the remembered ones included. */
  readonly properties: ReadonlyMap<string, ResolvedProperty>;
  /** Whether it declares `contains`. */
  readonly contains: boolean;
}

/** `sprout.Container` — a kind's full identity is its library and its name. */
export function kindName(kind: KindRef): string {
  return qualifiedName(kind.library, kind.name);
}

/** Matching is nominal and by composition: a kind composes itself. */
export function composesKind(kind: KindRef, target: KindRef): boolean {
  return kind.composes.has(kindName(target));
}

/** Every kind the bundle declares, asked the same two ways an enum is. */
export interface KindLookup {
  qualified(library: string, name: string): KindRef | null;
  unqualified(name: string, from: string): KindRef | null;
}
