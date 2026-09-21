// The rule every AST node keeps (B01; the spec's The compiler ›
// Diagnostics), and the walk that proves it.
//
// The spec asks for position spans on "every node", which is easy to
// agree to and easy to let slip: a node added later with no `at`, or one
// handed its parent's span because the token was not to hand, reports at
// the head of the definition again and the author is back to reading a
// hundred problems at line 1. So the rule is mechanical and checkable:
//
//   - every AST node is a plain object with a string `kind`;
//   - every AST node carries `at`, a span in the file it was written in.
//
// `unspanned` walks a tree and names every node that broke the rule, by
// the path it sits at. Each suite that builds a tree runs it, so a node
// added without a span fails the suite that added it rather than
// surfacing as a bad diagnostic a year later.

import type { Span } from './source.js';
import { SourceFile } from './source.js';

/** What every AST node carries: where it was written. */
export interface Spanned {
  readonly at: Span;
}

/**
 * An AST node: something with a `kind` that says what it is and an `at`
 * that says where it came from. The compiler's own trees narrow `kind`
 * to a union of literals; this is the shape the walk recognises.
 */
export interface Node extends Spanned {
  readonly kind: string;
}

/** A plain object or an array — the only things a tree is built from. */
function isWalkable(value: unknown): value is Record<string, unknown> | unknown[] {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return true;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Whether a value is a span: a file and two offsets inside it. */
export function isSpan(value: unknown): value is Span {
  if (value === null || typeof value !== 'object') return false;
  const span = value as Partial<Span>;
  return (
    span.source instanceof SourceFile &&
    typeof span.start === 'number' &&
    typeof span.end === 'number' &&
    Number.isInteger(span.start) &&
    Number.isInteger(span.end) &&
    span.start >= 0 &&
    span.end >= span.start &&
    span.end <= span.source.text.length
  );
}

/** Whether a value carries a usable span. */
export function isSpanned(value: unknown): value is Spanned {
  return (
    value !== null && typeof value === 'object' && isSpan((value as Partial<Spanned>).at as unknown)
  );
}

/** Whether a value is an AST node by the convention above: a plain object with a string `kind`. */
export function isNode(value: unknown): value is Node {
  return isWalkable(value) && !Array.isArray(value) && typeof value.kind === 'string';
}

/** Every node in a tree, parents before children, in the order they are written. */
export function* nodesOf(root: unknown): Generator<Node> {
  const seen = new Set<object>();
  function* walk(value: unknown): Generator<Node> {
    if (!isWalkable(value)) return;
    if (seen.has(value)) return;
    seen.add(value);
    if (isNode(value)) yield value;
    const entries: unknown[] = Array.isArray(value)
      ? value
      : Object.entries(value)
          .filter(([key]) => key !== 'at')
          .map(([, child]) => child);
    for (const child of entries) yield* walk(child);
  }
  yield* walk(root);
}

/**
 * The paths of every node in a tree that carries no usable span, empty
 * when the tree keeps the rule. A path reads the way the tree does —
 * `world.members[2].value` — so a failing suite names the node rather
 * than the count.
 */
export function unspanned(root: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<object>();
  const walk = (value: unknown, path: string): void => {
    if (!isWalkable(value)) return;
    if (seen.has(value)) return;
    seen.add(value);
    if (isNode(value) && !isSpanned(value)) out.push(path);
    if (Array.isArray(value)) {
      value.forEach((child, index) => walk(child, `${path}[${index}]`));
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === 'at') continue;
      walk(child, path === '' ? key : `${path}.${key}`);
    }
  };
  walk(root, '');
  return out;
}
