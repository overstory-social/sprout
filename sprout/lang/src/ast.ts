// What the compiler builds from source (B05 onward).
//
// Every node here keeps the rule `nodes.ts` holds: a string `kind` that
// says what it is, and an `at` span that says where it was written. The
// union grows one backlog item at a time — enums here, properties and
// messages next, kinds and objects in Phase 2 — and `unspanned()` over a
// parsed file is what stops a node arriving without a span.
//
// Names are nodes rather than bare strings for one reason: a diagnostic
// about a name has to point at the name, not at the declaration it sits
// in. `enum Ward { oak, oak }` reports at the second `oak`.

import type { Node } from './nodes.js';

/** A name as written: an identifier, an enum's option, a kind's name. */
export interface Ident extends Node {
  readonly kind: 'ident';
  readonly text: string;
}

/** One option of an enum. Its own node, so a problem with it names it. */
export interface EnumOption extends Node {
  readonly kind: 'option';
  readonly name: Ident;
}

/**
 * `enum Ward { oak, silver }` — a named set of symbols, declared beside
 * kinds and exported by the library that declared it. Symbols belong to
 * an enum: a symbol literal is checked against the option set of
 * whatever it is compared or assigned to, so `== :slver` is a compile
 * error naming the options rather than a comparison that is false for
 * ever.
 */
export interface EnumDeclaration extends Node {
  readonly kind: 'enum';
  readonly name: Ident;
  readonly options: readonly EnumOption[];
}

/** Everything that can be written at the top of a file. The union grows per item. */
export type Declaration = EnumDeclaration;
