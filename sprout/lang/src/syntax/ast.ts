// What the compiler builds from source.
//
// Every node here keeps the rule `nodes.ts` holds: a string `kind` that
// says what it is, and an `at` span that says where it was written. The
// union grows as the syntax lands, and `unspanned()` over a parsed file
// is what stops a node arriving without a span.
//
// Names are nodes rather than bare strings for one reason: a diagnostic
// about a name has to point at the name, not at the declaration it sits
// in. `enum Ward { oak, oak }` reports at the second `oak`.

import type { Node } from '../source/nodes.js';
import type { VerbDeclaration } from './ast-verbs.js';
import type { Prose, ProseLiteral } from './ast-prose.js';

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
 * may be written or taken from the literal. An enum and the option to
 * start at may be written as one, `:ward Ward.iron` or
 * `:ward sprout.Ward.iron`, which fills both fields from that one form.
 * Every instance of the kind starts at the default.
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
 * `remembers { :handled false :visits 0 min 0 max 99 }` — properties
 * held per actor rather than per object, typed by the same rules and
 * written in the same syntax (the spec's Properties › Per-actor memory).
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

/**
 * `bound tool` — whether an optional tool was given, the test that lets a
 * body read it (the spec's Optional tools). It asks about a name, and
 * nothing else stands after the word.
 */
export interface BoundExpr extends Node {
  readonly kind: 'bound';
  readonly name: Ident;
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
  | FreeCallExpr
  | BoundExpr;

// --- statements -----------------------------------------------------------

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
  /** An expression, or `spawn`, the one statement that yields a binding. */
  readonly value: Expr | SpawnStatement;
}

/** `spawn Cup in actor` — a new instance of a kind at its defaults, in a container (the spec's Spawning). */
export interface SpawnStatement extends Node {
  readonly kind: 'spawn';
  readonly spawned: KindExpr;
  /** A binding or an identifier, or a dotted path to one: what the new instance goes into. */
  readonly container: ObjectPath;
}

/**
 * `destroy self`, the only form, or `finally destroy self`, which waits
 * until every message the turn has queued has been handled (the spec's
 * Destroying).
 */
export interface DestroyStatement extends Node {
  readonly kind: 'destroy';
  /** Whether it was written `finally destroy self`. */
  readonly finally: boolean;
}

/**
 * `move target to self` — a proposal that the engine move a thing into a
 * container, through consent, with the object whose body runs it as the
 * mover (the spec's Verbs › Moving something).
 */
export interface MoveStatement extends Node {
  readonly kind: 'move';
  /** A binding or an identifier, or a dotted path to one: what moves. */
  readonly thing: ObjectPath;
  /** The same: what it goes into. */
  readonly destination: ObjectPath;
}

/** `target: p` inside an `act`'s brackets: a role of the verb, and what fills it. */
export interface ActRole extends Node {
  readonly kind: 'act-role';
  readonly role: Ident;
  /** A binding or an identifier, or a dotted path to one. */
  readonly filler: ObjectPath;
}

/**
 * `act nuzzle (target: p)` — a reading with `self` as the actor and each
 * named role filled, run where the statement stands (the spec's Verbs ›
 * Acting). Roles are named, so no phrase is needed.
 */
export interface ActStatement extends Node {
  readonly kind: 'act';
  readonly verb: Ident;
  /** In the order written. */
  readonly roles: readonly ActRole[];
}

/**
 * `send oak_door :unlock_attempt`, `send from :unlock_failed with 2` — a
 * message queued to one object, which is not sent to where that object is
 * out of range when the statement runs (the spec's Events › Sending).
 */
export interface SendStatement extends Node {
  readonly kind: 'send';
  /** A binding or an identifier, or a dotted path to one: who is sent to. */
  readonly target: ObjectPath;
  /** The message without its colon. */
  readonly message: Ident;
  /** What it carries, after `with`, where it carries anything. */
  readonly value: Expr | null;
}

/**
 * `broadcast :illuminating with true` — a message queued to everything the
 * sender's range walk reaches, outward and inward through containment
 * (the spec's Events › Sending).
 */
export interface BroadcastStatement extends Node {
  readonly kind: 'broadcast';
  readonly message: Ident;
  readonly value: Expr | null;
}

/**
 * `{ … }` — statements in the order written, which run in that order and
 * are a scope of their own: a `let` in a block lives to its `}`.
 */
export interface Block extends Node {
  readonly kind: 'block';
  readonly statements: readonly Statement[];
}

/**
 * `if (self.count >= 8) { … } else if (…) { … } else { … }` — the
 * condition is a boolean, with no truthiness behind it (the spec's
 * Properties › What the compiler checks). An `else if` is the `if` in
 * `otherwise`, so a chain is a list read from its head.
 */
export interface IfStatement extends Node {
  readonly kind: 'if';
  readonly condition: Expr;
  readonly then: Block;
  readonly otherwise: Block | IfStatement | null;
}

/**
 * `refuse "No room on the shelf."` or `refuse full` — a guard's or a
 * `permit`'s refusal, in a one-line passage in quotes or in a passage of
 * the kind that writes it, named (the spec's Movement and consent, Prose).
 */
export interface RefuseStatement extends Node {
  readonly kind: 'refuse';
  readonly said: ProseLiteral | Ident;
}

/**
 * `say "The bolt slides back."` or `say taken` — words for the actor, in
 * quotes or in a passage of the kind that writes it, named (the spec's
 * Prose). Where one may stand is the checker's.
 */
export interface SayStatement extends Node {
  readonly kind: 'say';
  readonly said: ProseLiteral | Ident;
}

/** `allow` — a guard's consent, said before its end (the spec's Movement and consent). */
export interface AllowStatement extends Node {
  readonly kind: 'allow';
}

/**
 * `self.set(:open, true)` — an expression written as a statement. Only a
 * call that writes or remembers does anything there, and where one may
 * stand is the checker's to say.
 */
export interface ExpressionStatement extends Node {
  readonly kind: 'expression-statement';
  readonly expression: Expr;
}

export type Statement =
  | LetStatement
  | SpawnStatement
  | DestroyStatement
  | MoveStatement
  | ActStatement
  | SendStatement
  | BroadcastStatement
  | IfStatement
  | RefuseStatement
  | AllowStatement
  | SayStatement
  | ExpressionStatement;

// --- the world ------------------------------------------------------------

/**
 * `composing_room`, `kiln.shelf` — an object named by where it sits: a
 * name, then the name of something inside it after each dot, written
 * without spaces (the spec's Places inside places: `-> bedroom.wardrobe`).
 * The span covers the whole path, and each part keeps its own, so a
 * problem with one step points at that step.
 */
export interface ObjectPath extends Node {
  readonly kind: 'path';
  /** At least one, outermost first. */
  readonly parts: readonly Ident[];
}

/** A path as the author wrote it: `kiln.shelf`. */
export function writtenPath(path: ObjectPath): string {
  return path.parts.map((part) => part.text).join('.');
}

/**
 * `visitors are Person` — what a person is made of in this world.
 * The visitor kind is an ordinary kind, and `item.is(sprout.Actor)` is
 * an ordinary nominal test rather than a name the engine knows.
 */
export interface VisitorsAre extends Node {
  readonly kind: 'visitors-are';
  readonly visitor: KindExpr;
}

/**
 * `visitors arrive at composing_room` — where a person begins: a path
 * read from the world's body, where it is written, naming a place.
 */
export interface VisitorsArriveAt extends Node {
  readonly kind: 'visitors-arrive-at';
  readonly place: ObjectPath;
}

/**
 * `contains`, or `contains actors` — whether a thing may hold others,
 * and whether the others may be people (the spec's Containment is
 * a declaration, Places).
 *
 * There are no rooms: a PLACE is any object that declares `contains
 * actors`, so a wardrobe that declares it can be entered, and
 * everything that follows from being somewhere follows from that one
 * line. Neither is a kind the engine knows by name, which is what makes
 * a library's container and the standard library's equally real.
 *
 * Structural rather than policy, and that is why it is a declaration
 * and not a guard: the engine must know whether a thing holds others in
 * order to build the tree at all, and no guard can answer that.
 */
export interface ContainsDeclaration extends Node {
  readonly kind: 'contains';
  /** Whether `actors` was written after it — what makes a place a place. */
  readonly actors: boolean;
}

/** `on :stir` — a handler, named by the message it answers. */
export interface HandlerRef extends Node {
  readonly kind: 'handler-ref';
  readonly message: Ident;
}

/** `changed :lit` — a hook, named by the property it watches. */
export interface HookRef extends Node {
  readonly kind: 'hook-ref';
  readonly property: Ident;
}

/**
 * The three consent guards, one for each party to a move, in the order
 * the engine asks them: the thing, the container it leaves, the one it
 * enters (the spec's Movement and consent › The three roles).
 */
export const GUARD_NAMES = ['depart', 'release', 'accept'] as const;
export type GuardName = (typeof GUARD_NAMES)[number];

/** `depart`, `release`, `accept` — a consent guard, named by its role in a move. */
export interface GuardRef extends Node {
  readonly kind: 'guard-ref';
  readonly guard: GuardName;
}

/**
 * `as target for unlock` — a role member, named by the role and the verb:
 * the head of one as written, and what `without` names to leave one out.
 */
export interface RoleRef extends Node {
  readonly kind: 'role-ref';
  readonly role: Ident;
  readonly verb: Ident;
}

/**
 * A member named rather than declared, as `without` names one. Only the
 * members whose several sources all run are here (the spec's How members
 * combine): an exclusive member is replaced by writing one's own, so it
 * is never left out.
 */
export type MemberRef = HandlerRef | HookRef | GuardRef | RoleRef;

/** A member as the author wrote it: `on :stir`, `changed :lit`, `depart`, `as target for unlock`. */
export function writtenMember(member: MemberRef): string {
  switch (member.kind) {
    case 'handler-ref':
      return `on :${member.message.text}`;
    case 'hook-ref':
      return `changed :${member.property.text}`;
    case 'guard-ref':
      return member.guard;
    case 'role-ref':
      return `as ${member.role.text} for ${member.verb.text}`;
  }
}

/**
 * `without changed :lit from sprout.LightSource` — one contribution a
 * composed kind makes, left out, naming both the member and the kind
 * that declares it (the spec's Suppressing a contribution).
 */
export interface WithoutDeclaration extends Node {
  readonly kind: 'without';
  readonly member: MemberRef;
  readonly source: KindExpr;
}

// --- passages -------------------------------------------------------------

/**
 * A passage's words, between its braces: the text exactly as written, and
 * the prose it reads as. Its span covers the braces.
 */
export interface PassageBody extends Node {
  readonly kind: 'passage-body';
  readonly text: string;
  readonly prose: Prose;
}

/**
 * `passage greeting { … }`, `passage taken default { You take {target}. }`
 * — a named block of words belonging to the kind, object or world that
 * writes it (the spec's Prose › Passages). A `default` passage yields to
 * one of the same name from any other source (Kinds › How members
 * combine).
 */
export interface PassageDeclaration extends Node {
  readonly kind: 'passage';
  readonly name: Ident;
  /** Whether it was written `default`. */
  readonly yields: boolean;
  readonly body: PassageBody;
}

/**
 * `prose "mirror.prose"` — the file a kind's longer passages live in,
 * named so a reader of the kind can see it has words and where they are
 * (the spec's Prose › Passages).
 */
export interface ProseFileDeclaration extends Node {
  readonly kind: 'prose-file';
  readonly file: StringLiteral;
}

// --- consent guards -------------------------------------------------------

/**
 * `depart (to) { … }`, `release (item, to) { … }`, `accept (item, from)
 * { … }` — what one party to a move says about it (the spec's Movement
 * and consent). The parameters are positional, one for `depart` and two
 * for the others, each named as the author chose. The body reads and
 * decides: it ends in `allow`, in `refuse`, or by reaching its end,
 * which allows.
 */
export interface GuardDeclaration extends Node {
  readonly kind: 'guard';
  readonly guard: GuardName;
  readonly parameters: readonly Ident[];
  readonly body: Block;
}

// --- handlers, hooks and pass rules ---------------------------------------

/**
 * A handler's or a hook's parameters in brackets, positional and named as
 * the author chose; `null` is `_`, a parameter left unnamed (the spec's
 * Events › Receiving).
 */
export type Parameters = readonly (Ident | null)[];

/**
 * `on :illuminating (from, value) { … }`, `on :gust { … }` — what an
 * object does when a message reaches it (the spec's Events › Receiving).
 * The body runs after the sending body has ended, when the queue reaches
 * it, and decides by writing or not writing: there is no refusal.
 */
export interface HandlerDeclaration extends Node {
  readonly kind: 'handler';
  /** The message without its colon: `:stir` is `stir`. */
  readonly message: Ident;
  readonly parameters: Parameters;
  readonly body: Block;
}

/**
 * `changed :lit (was) { … }` — what an object does when a write of its
 * own changed one of its properties, queued once per change with the
 * value it had before (the spec's Events › Receiving).
 */
export interface HookDeclaration extends Node {
  readonly kind: 'hook';
  /** The property without its colon. */
  readonly property: Ident;
  readonly parameters: Parameters;
  readonly body: Block;
}

/**
 * `pass :illuminating (true)`, `pass any (self.get(:open))` — whether a
 * container lets a message through to what it holds (the spec's Events ›
 * Containers route). `pass :m` answers for one message and `pass any` for
 * every other; the rule is a condition that only reads.
 */
export interface PassDeclaration extends Node {
  readonly kind: 'pass';
  /** The message without its colon, or null for `pass any`. */
  readonly message: Ident | null;
  readonly rule: Expr;
}

/** A pass rule as the author wrote its head: `pass :illuminating`, `pass any`. */
export function writtenPass(pass: PassDeclaration): string {
  return pass.message === null ? 'pass any' : `pass :${pass.message.text}`;
}

// --- playing a role -------------------------------------------------------

/** `1 to 12` after a `from` — a range of numbers written out, the lower first. */
export interface IntegerRange extends Node {
  readonly kind: 'integer-range';
  readonly min: IntegerLiteral;
  readonly max: IntegerLiteral;
}

/**
 * `topic from :knows`, `dial from 1 to 12` — the options a value role
 * binds for this role-player: a property it holds, or a range written
 * out (the spec's A role-player narrows its own options).
 */
export interface FromDeclaration extends Node {
  readonly kind: 'from';
  readonly role: Ident;
  readonly by: SymbolExpr | IntegerRange;
}

/**
 * `as target for unlock { permit { … } do { … } }`, `as actor for take
 * { … }` — the claim that this thing can play a role in a verb, and the
 * code for playing it (the spec's Verbs › Playing a role, The actor's own
 * part). `permit` decides and `do` acts; either may be left out, and
 * both are read by the statement reader.
 */
export interface PlayDeclaration extends Node {
  readonly kind: 'play';
  readonly head: RoleRef;
  readonly narrows: readonly FromDeclaration[];
  readonly permit: Block | null;
  readonly do: Block | null;
}

/**
 * What a kind's body, or an object's, may declare (the spec's Kinds ›
 * Declaring and composing). The union grows one item at a time.
 */
export type KindMember =
  | PropertyDeclaration
  | RemembersDeclaration
  | ContainsDeclaration
  | WithoutDeclaration
  | PassageDeclaration
  | ProseFileDeclaration
  | GuardDeclaration
  | PlayDeclaration
  | HandlerDeclaration
  | HookDeclaration
  | PassDeclaration;

/** What may be written inside a world: what a kind may, and what it says about visitors. */
export type WorldMember = KindMember | VisitorsAre | VisitorsArriveAt;

/**
 * `world printers_shop is sprout.World { … }` — the root of the one tree.
 * The only object with no container, the only one that cannot move, and
 * the only one that can be neither spawned nor destroyed.
 *
 * Every world writes `sprout.World`, which carries the words the engine
 * speaks for itself, and it may compose more beside it:
 * `world printers_shop is sprout.World, victorian.Voice { … }` is how a
 * library of stock lines in another register is installed. `composes`
 * is what was WRITTEN, library and all, so a diagnostic about a
 * composed kind can point at the words the author typed. `objects` are
 * what sits directly in the world, each holding its own.
 */
export interface WorldDeclaration extends Node {
  readonly kind: 'world';
  readonly name: Ident;
  readonly composes: readonly KindExpr[];
  readonly members: readonly WorldMember[];
  readonly objects: readonly ObjectDeclaration[];
}

// --- kinds and objects ----------------------------------------------------

/**
 * `kind Crate is sprout.Container { … }` — a named bundle of properties
 * and behaviour with no place in the world (the spec's Kinds, composition
 * and libraries › Declaring and composing). Everything after `is` is
 * composed, and a kind may compose any number of kinds, including none.
 * `composes` is what was WRITTEN, library and all, as for a world;
 * `objects` are the objects its body writes.
 */
export interface KindDeclaration extends Node {
  readonly kind: 'kind';
  readonly name: Ident;
  readonly composes: readonly KindExpr[];
  readonly members: readonly KindMember[];
  readonly objects: readonly ObjectDeclaration[];
}

/**
 * `object bench is Bench { … }` — one thing in the tree, written in the
 * body of what holds it, the world's or another object's (the spec's The
 * world model › Objects). The parse tree is the containment tree, so it
 * never names its container. A body may follow, which declares an
 * anonymous kind for that object alone and holds `objects`, what sits
 * inside it; one that writes none has neither.
 */
export interface ObjectDeclaration extends Node {
  readonly kind: 'object';
  readonly name: Ident;
  readonly composes: readonly KindExpr[];
  readonly members: readonly KindMember[];
  readonly objects: readonly ObjectDeclaration[];
}

/**
 * Everything a file holds at its top level. An object is not among them:
 * it is written in the body of what holds it. The union grows per item.
 */
export type Declaration =
  EnumDeclaration | MessageDeclaration | WorldDeclaration | KindDeclaration | VerbDeclaration;
