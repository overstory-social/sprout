// What the compiler builds from the statements that put words in front of
// a reader, `say`, `tell` and `text`, and from the `describe` whose words
// `text` gives (the spec's Prose; Other people › Who hears it; Kinds ›
// Prose does not compose). Every node keeps the rule `ast.ts` states: a
// `kind` and an `at`.

import type { Node } from '../source/nodes.js';
import type { Span } from '../source/source.js';
import type { Block, Ident, ObjectPath } from './ast.js';
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
 * `inside` or `outside` after `tell`, directing it to a teller's own
 * occupants or to the place around it rather than to the place as a
 * whole (the spec's Other people › Who hears it).
 */
export interface TellDirection extends Node {
  readonly kind: 'direction';
  readonly word: 'inside' | 'outside';
}

/**
 * `tell "{actor} pulls the lever."`, `tell self greeting`, `tell inside
 * "…"` — words for everyone else in the teller's place, for one actor
 * named after `tell`, or, directed with `inside` or `outside`, for only
 * the teller's own occupants or only the place around it (the spec's
 * Other people › Who hears it).
 */
export interface TellStatement extends Node {
  readonly kind: 'tell';
  /** Who is told, where one is named; null where it is the place, directed or not. */
  readonly to: ObjectPath | null;
  /** `inside` or `outside`, where the statement is directed; null where it is not. */
  readonly direction: TellDirection | null;
  readonly said: ProseLiteral | Ident;
}

/** `text greeting` — the words a `describe` gives whoever is looking (the spec's Prose). */
export interface TextStatement extends Node {
  readonly kind: 'text';
  readonly said: ProseLiteral | Ident;
}

/**
 * `describe { text greeting }` — what whoever looks at the thing reads: a
 * block of statements that only read, and give their words with `text`
 * (the spec's Prose; Engine verbs). A thing has one.
 */
export interface DescribeDeclaration extends Node {
  readonly kind: 'describe';
  readonly body: Block;
}

/** The span of a describe's own word, where a diagnostic about the whole of one points. */
export function describeWord(declaration: DescribeDeclaration): Span {
  const at = declaration.at;
  return at.source.span(at.start, at.start + 'describe'.length);
}
