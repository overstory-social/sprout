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

// --- expressions ----------------------------------------------------------
//
// An expression is read WITHOUT deciding what its parts mean. `:opens`
// is a symbol wherever it appears, and whether it names a property or
// an option of an enum is decided by the call it sits in; `Key` is a
// kind wherever it appears, and only `is()` and `count()` accept one.
// That is the same split `NamedType` already makes — the parser records
// what was written, and the checker resolves it — and it keeps the
// parser from having to know the method table.

/** A value written down. A list is not one: see the notes on lists in expressions. */
export type LiteralExpr = BooleanLiteral | IntegerLiteral | StringLiteral;

/** `self`, `actor`, `topic`, `tools` — a name something in scope answers to. */
export interface BindingExpr extends Node {
  readonly kind: 'binding';
  readonly name: Ident;
}

/**
 * `:wet`, `:opens` — written WITH its colon, where a declaration writes
 * an option bare. Whether it names a property or an option is the
 * checker's to say from where it sits.
 */
export interface SymbolExpr extends Node {
  readonly kind: 'symbol-expr';
  readonly name: Ident;
}

/**
 * `Key`, `sprout.Container` — a kind as written, wherever one is
 * written: what `is()` and `count()` take, and what a world or an
 * object composes. One node rather than one per place, because three
 * spellings of a library and a name is three things to keep in step.
 */
export interface KindExpr extends Node {
  readonly kind: 'kind-expr';
  readonly library: Ident | null;
  readonly name: Ident;
}

export type UnaryOperator = '!' | '-';

export interface UnaryExpr extends Node {
  readonly kind: 'unary';
  readonly operator: UnaryOperator;
  readonly operand: Expr;
}

export type BinaryOperator = '==' | '!=' | '<' | '<=' | '>' | '>=' | '+' | '-' | '&&' | '||';

export interface BinaryExpr extends Node {
  readonly kind: 'binary';
  readonly operator: BinaryOperator;
  readonly left: Expr;
  readonly right: Expr;
}

/** `self.count` — a member read with no arguments and no parentheses. */
export interface MemberExpr extends Node {
  readonly kind: 'member';
  readonly receiver: Expr;
  readonly member: Ident;
}

/** `self.get(:wear)`, `tools.count(Rib)`, `x.remember(:p, e)`. */
export interface CallExpr extends Node {
  readonly kind: 'call';
  readonly receiver: Expr;
  readonly method: Ident;
  readonly arguments: readonly Expr[];
}

/**
 * `chance(30)`, `random(6)` — a call with no receiver. The parser reads
 * the shape so that a diagnostic can be about the name rather than
 * about a bracket; which names are readable is the checker's table, and
 * it is empty until B33 adds chance to it.
 */
export interface FreeCallExpr extends Node {
  readonly kind: 'free-call';
  readonly name: Ident;
  readonly arguments: readonly Expr[];
}

export type Expr =
  | LiteralExpr
  | BindingExpr
  | SymbolExpr
  | KindExpr
  | UnaryExpr
  | BinaryExpr
  | MemberExpr
  | CallExpr
  | FreeCallExpr;

/**
 * `let ribs = tools.count(Rib)` — a name for the result of an
 * expression, for the rest of its block. Written once and never again;
 * there is no reassignment, so a name means one thing everywhere it is
 * in scope. Its type is the expression's, exactly, so nothing is
 * annotated and the node carries no type.
 */
export interface LetStatement extends Node {
  readonly kind: 'let';
  readonly name: Ident;
  readonly value: Expr;
}

// --- the world ------------------------------------------------------------

/**
 * `visitors are Creature` — what a person is made of in this world.
 * The visitor kind is an ordinary kind, and `item.is(sprout.Actor)` is
 * an ordinary nominal test rather than a name the engine knows.
 */
export interface VisitorsAre extends Node {
  readonly kind: 'visitors-are';
  readonly visitor: KindExpr;
}

/** `visitors arrive at composing_room` — where a person begins. */
export interface VisitorsArriveAt extends Node {
  readonly kind: 'visitors-arrive-at';
  readonly place: Ident;
}

/** What may be written inside a world. The union grows one item at a time. */
export type WorldMember =
  PropertyDeclaration | RemembersDeclaration | VisitorsAre | VisitorsArriveAt;

/**
 * `world printers_shop { … }` — the root of the one tree. The only
 * object with no container, the only one that cannot move, and the only
 * one that can be neither spawned nor destroyed.
 *
 * Every world composes `sprout.World`, which carries the words the
 * engine speaks for itself, and it may compose more:
 * `world printers_shop: victorian.Voice { … }` is how a library of
 * stock lines in another register is installed. The implicit one is not
 * in `composes` — that is what was WRITTEN, and `world.ts` adds the
 * rest, so a diagnostic about a written kind can point at it.
 */
export interface WorldDeclaration extends Node {
  readonly kind: 'world';
  readonly name: Ident;
  readonly composes: readonly KindExpr[];
  readonly members: readonly WorldMember[];
}

/** Everything that can be written at the top of a file. The union grows per item. */
export type Declaration = EnumDeclaration | MessageDeclaration | WorldDeclaration;
