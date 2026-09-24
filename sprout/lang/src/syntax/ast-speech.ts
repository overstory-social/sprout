// What the compiler builds from the statements that put words in front of
// a reader: `say`, `tell` and `text` (the spec's Prose; Other people ›
// Who hears it). Every node keeps the rule `ast.ts` states: a `kind` and
// an `at`.

import type { Node } from '../source/nodes.js';
import type { Ident, ObjectPath } from './ast.js';
import type { ProseLiteral } from './ast-prose.js';

/**
 * `say "The bolt slides back."` or `say taken` — words for the actor, in
 * quotes or in a passage of the kind that writes it, named (the spec's
 * Prose). Where one may stand is the checker's.
 */
export interface SayStatement extends Node {
  readonly kind: 'say';
  readonly said: ProseLiteral | Ident;
}

/**
 * `tell "{actor} pulls the lever."`, `tell self greeting` — words for
 * everyone else in the teller's place, or, with a binding after `tell`,
 * for that one actor (the spec's Other people › Who hears it).
 */
export interface TellStatement extends Node {
  readonly kind: 'tell';
  /** Who is told, where one is named; null where it is the place. */
  readonly to: ObjectPath | null;
  readonly said: ProseLiteral | Ident;
}

/** `text greeting` — the words a `describe` gives whoever is looking (the spec's Prose). */
export interface TextStatement extends Node {
  readonly kind: 'text';
  readonly said: ProseLiteral | Ident;
}
