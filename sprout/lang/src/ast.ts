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

// --- types, as they are written ------------------------------------------

/**
 * A type named in source: `boolean`, `integer`, `string`, an enum's
 * name, or an enum qualified by its library. Which of those it is takes
 * the enum table to decide, so the parser records what was written and
 * `types.ts` resolves it.
 */
export interface NamedType extends Node {
  readonly kind: 'named-type';
  /** `sprout` in `sprout.Ward`, where one was written. */
  readonly library: Ident | null;
  readonly name: Ident;
}

/** `[Ward]` — a list of one element type. */
export interface ListType extends Node {
  readonly kind: 'list-type';
  readonly element: TypeExpr;
}

export type TypeExpr = NamedType | ListType;

// --- literals -------------------------------------------------------------

export interface BooleanLiteral extends Node {
  readonly kind: 'boolean';
  readonly value: boolean;
}

export interface IntegerLiteral extends Node {
  readonly kind: 'integer';
  readonly value: number;
}

export interface StringLiteral extends Node {
  readonly kind: 'string';
  readonly value: string;
}

/**
 * An enum's option as a declaration writes it: `default wet`, bare,
 * where an expression would write `:wet`. Which enum it belongs to is
 * decided by the type it is being given to.
 */
export interface OptionLiteral extends Node {
  readonly kind: 'option-literal';
  readonly name: Ident;
}

/** `[oak, silver]` — a list's elements, in the order written. */
export interface ListLiteral extends Node {
  readonly kind: 'list-literal';
  readonly elements: readonly Literal[];
}

export type Literal = BooleanLiteral | IntegerLiteral | StringLiteral | OptionLiteral | ListLiteral;

// --- properties -----------------------------------------------------------

/**
 * `:wear 0 min 0 max 99` — a name, a type and a default, where the type
 * may be written or taken from the literal. Every instance of the kind
 * starts at the default.
 */
export interface PropertyDeclaration extends Node {
  readonly kind: 'property';
  /** The name without its colon: `:wear` is `wear`. */
  readonly name: Ident;
  /** Written, or null when it is to be taken from the default. */
  readonly type: TypeExpr | null;
  readonly default: Literal | null;
  /** An integer's declared range. Absent means the whole of the integer range. */
  readonly min: IntegerLiteral | null;
  readonly max: IntegerLiteral | null;
}

/**
 * `:remembers [handled: false, visits: 0 min 0 max 99]` — properties
 * held per actor rather than per object, typed by the same rules and
 * written in the same syntax.
 */
export interface RemembersDeclaration extends Node {
  readonly kind: 'remembers';
  readonly properties: readonly PropertyDeclaration[];
}

// --- messages -------------------------------------------------------------

/**
 * `message :stir`, `message :illuminating with boolean` — declared
 * beside verbs and enums, by a world or a library, with the type of the
 * value it carries if it carries one. Sending an undeclared message is a
 * compile error, which is what makes a misspelt `:illumnating` an error
 * rather than a handler that never fires.
 */
export interface MessageDeclaration extends Node {
  readonly kind: 'message';
  readonly name: Ident;
  readonly carries: TypeExpr | null;
}

/** Everything that can be written at the top of a file. The union grows per item. */
export type Declaration = EnumDeclaration | MessageDeclaration;
