// What the compiler builds from a verb declaration: its roles, their
// fillers and modifiers, and its phrases (the spec's Verbs › Declaring a
// verb). Every node keeps the rule `ast.ts` states: a `kind` and an `at`.

import type { Node } from '../source/nodes.js';
import type { Ident, KindExpr } from './ast.js';

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
}
