// What the compiler builds from what an object does when something reaches
// it: a handler for a message, a hook on a changed property, and a
// container's pass rule for what it lets through (the spec's Events ›
// Receiving, Containers route). Every node keeps the rule `ast.ts` states:
// a `kind` and an `at`.

import type { Node } from '../source/nodes.js';
import type { Block, Expr, Ident } from './ast.js';

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
