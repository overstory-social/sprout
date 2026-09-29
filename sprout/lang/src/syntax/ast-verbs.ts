// What the compiler builds from a verb declaration: its roles, their
// fillers and modifiers, and its phrases (the spec's Verbs › Declaring a
// verb). Every node keeps the rule `ast.ts` states: a `kind` and an `at`.

import type { Node } from '../source/nodes.js';
import type { Expr, Ident, KindExpr } from './ast.js';

/**
 * `symbol`, `integer` or `exit` after a role's colon: a value the visitor
 * names rather than a thing the world holds (the spec's Value roles), or
 * an exit, the engine's `go` alone (Exits).
 */
export interface ValueFiller extends Node {
  readonly kind: 'value-filler';
  readonly value: 'symbol' | 'integer' | 'exit';
}

/** `many` or `optional` after a role, its own node so a refusal of it points at the word. */
export interface RoleModifier extends Node {
  readonly kind: 'role-modifier';
  readonly word: 'many' | 'optional';
}

/**
 * `role target: Lockable`, `role tools many`, `role topic: symbol` — one
 * participant a verb names besides its actor (the spec's Declaring a
 * verb). A kind narrows what may fill it, a value filler makes it a value
 * role, and none leaves it open, filled by any object. The first role
 * is the target and every other one a tool.
 */
export interface RoleDeclaration extends Node {
  readonly kind: 'role';
  readonly name: Ident;
  readonly filler: KindExpr | ValueFiller | null;
  /** A set role (Set roles), filled by every object named in one run. */
  readonly many: RoleModifier | null;
  /** Written only on a verb with no phrases, which has nothing to infer it from (Optional tools). */
  readonly optional: RoleModifier | null;
}

/** A run of words in a phrase, as the phrase means it: trimmed, its spaces single. */
export interface PhraseWords extends Node {
  readonly kind: 'phrase-words';
  readonly text: string;
}

/** `[target]` — a slot naming the role a noun typed there fills (the spec's Slots). */
export interface PhraseSlot extends Node {
  readonly kind: 'phrase-slot';
  readonly role: Ident;
}

export type PhrasePart = PhraseWords | PhraseSlot;

/**
 * `"unlock [target] with [tool]"` — one way a visitor may type the verb.
 * `text` is what the quotes mean, after escapes; each part is spanned
 * inside the quotes, so a problem with a slot points at the slot.
 */
export interface PhraseDeclaration extends Node {
  readonly kind: 'phrase';
  readonly text: string;
  readonly parts: readonly PhrasePart[];
}

/**
 * `"prise open"` — another word for a verb, the words a visitor types in
 * place of its name (the spec's Parsing › Synonyms). `text` is what the
 * quotes mean, trimmed, its spaces single.
 */
export interface SynonymWords extends Node {
  readonly kind: 'synonym';
  readonly text: string;
}

/**
 * `synonyms open: "jimmy", "force"` — another word for a verb, written in
 * the world's body, where it holds throughout the world, or an object's,
 * where it holds only in readings that object takes part in (the spec's
 * Parsing › Synonyms). A verb's own are on its declaration.
 */
export interface SynonymsDeclaration extends Node {
  readonly kind: 'synonyms';
  readonly verb: Ident;
  readonly words: readonly SynonymWords[];
}

/**
 * `verb unlock { role target: Lockable  role tool  "unlock [target] with
 * [tool]" }` — what may be typed, declared for the world or exported by a
 * library and never by an object (the spec's Verbs › Declaring a verb).
 * Its roles and phrases may be written in any order and either list may
 * be empty: no roles is `look`, and no phrases is a verb only `act`
 * performs.
 */
export interface VerbDeclaration extends Node {
  readonly kind: 'verb';
  readonly name: Ident;
  readonly roles: readonly RoleDeclaration[];
  readonly phrases: readonly PhraseDeclaration[];
  /** Its own `synonyms`, which hold everywhere the verb does. */
  readonly synonyms: readonly SynonymWords[];
}

/** `target: y` in an intent's step: the role the step gives the slot's thing to. */
export interface IntentFiller extends Node {
  readonly kind: 'intent-filler';
  readonly role: Ident;
  readonly slot: Ident;
}

/**
 * `unlock (target: y, tool: x) when (y.get(:locked))`: one step of an
 * intent, the verb it performs, which slot fills each role, and the
 * condition, read before the line runs, under which it runs.
 */
export interface IntentStep extends Node {
  readonly kind: 'intent-step';
  readonly verb: Ident;
  readonly fillers: readonly IntentFiller[];
  readonly when: Expr | null;
}

/**
 * `intent open_with { "open [y] with [x]"  do unlock (target: y, tool: x)
 * then open (target: y) }`: a canonical phrase, the first, other phrases
 * that mean the same, and the steps it stands for (the spec's Parsing ›
 * Intents). A phrase's slots name the intent's own slots.
 */
export interface IntentDeclaration extends Node {
  readonly kind: 'intent';
  readonly name: Ident;
  readonly phrases: readonly PhraseDeclaration[];
  readonly steps: readonly IntentStep[];
  /** Whether every phrase and step written was read; where one was not, what they must agree on is not asked. */
  readonly whole: boolean;
}
