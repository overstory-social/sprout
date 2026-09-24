// What the compiler builds from prose: a passage's words, and a line in
// quotes given to `say` or `refuse` (the spec's Prose › Passages, Slots,
// Conditionals and loops). Every node keeps the rule `ast.ts` states: a
// `kind` and an `at`.
//
// Words are kept as written, escapes resolved and line breaks still in
// them, since reflow is the renderer's; a blank line is its own node,
// taken out of the words at the place it was written, so a block that
// renders nothing between two blank lines leaves no paragraph behind.

import type { Node } from '../source/nodes.js';
import type { Expr, Ident, KindExpr } from './ast.js';

/** Words, as written: escapes resolved, spaces and single line breaks kept for the renderer to reflow. */
export interface ProseWords extends Node {
  readonly kind: 'prose-words';
  readonly text: string;
}

/** A blank line: a paragraph break. */
export interface ProseParagraph extends Node {
  readonly kind: 'prose-paragraph';
}

/** `\n`: a line break reflow keeps. */
export interface ProseNewline extends Node {
  readonly kind: 'prose-newline';
}

/**
 * `{thing}`, `{self.get(:mood)}`, `{pot.greeting}` — one thing rendered:
 * an object, an option, a number, a string, or another object's passage.
 */
export interface ProseSlot extends Node {
  readonly kind: 'prose-slot';
  readonly expr: Expr;
}

/**
 * `{if c}…{else if d}…{else}…{/if}` — a condition written without
 * parentheses, since the braces already delimit. An `{else if}` is the
 * `{if}` in `otherwise`, as a statement's is.
 */
export interface ProseIf extends Node {
  readonly kind: 'prose-if';
  readonly condition: Expr;
  readonly then: Prose;
  readonly otherwise: Prose | ProseIf | null;
}

/**
 * `{for x in c}`, `{for x: Kind in c}`, `{for x of list}` — a walk of a
 * container's contents, of those composing a kind, or of a list or a set
 * role, binding `$first`, `$last`, `$index` and `$count` inside.
 */
export interface ProseFor extends Node {
  readonly kind: 'prose-for';
  readonly variable: Ident;
  /** The kind a walk of contents is filtered by, where one is written; never on `of`. */
  readonly filter: KindExpr | null;
  readonly walks: 'in' | 'of';
  readonly over: Expr;
  readonly body: Prose;
}

export type ProsePiece =
  ProseWords | ProseParagraph | ProseNewline | ProseSlot | ProseIf | ProseFor;

/** A run of prose: a passage's whole body, a line in quotes, or a block's inside. */
export interface Prose extends Node {
  readonly kind: 'prose';
  readonly pieces: readonly ProsePiece[];
}

/**
 * `"You take {target}."` given to `say` or `refuse` — a one-line passage:
 * the words as the quotes mean them, and the prose they read as.
 */
export interface ProseLiteral extends Node {
  readonly kind: 'prose-literal';
  /** The text after escapes, as a string literal holds it. */
  readonly value: string;
  readonly prose: Prose;
}

/** The loop variables a `{for}` binds, and what each is (the spec's Where types come from). */
export const LOOP_VARIABLES = {
  $first: 'boolean',
  $last: 'boolean',
  $index: 'integer',
  $count: 'integer',
} as const;

export type LoopVariable = keyof typeof LOOP_VARIABLES;

export function isLoopVariable(name: string): name is LoopVariable {
  return Object.hasOwn(LOOP_VARIABLES, name);
}
