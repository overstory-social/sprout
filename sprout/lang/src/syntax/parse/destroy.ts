// `destroy self` and `finally destroy self`, read (the spec's The world
// model › Destroying). An object removes only itself, since itself is the
// only thing it may write, so `self` is the one target; `finally` marks it
// to go once the turn's queue is empty, and only `destroy self` may follow
// it. What is written wrong is refused once, and stepped over with its dots.

import type { DestroyStatement } from '../ast.js';
import { spanning, type Span } from '../../source/source.js';
import { punct, type Parser } from './parser.js';
import { notAStatement } from './statements.js';

/**
 * `destroy self`, the only form: an object removes only itself, since
 * itself is the only thing it may write. Anything else written after
 * `destroy` is refused once, and stepped over with its dots.
 */
export function destroyStatement(p: Parser): DestroyStatement | null {
  const keyword = p.take('name', 'destroy');
  if (keyword === null) {
    notAStatement(p, p.peek());
    return null;
  }
  const target = p.peek();
  if (target.kind === 'name' && target.text === 'self' && !punct(p.peek(1), '.')) {
    p.next();
    return { kind: 'destroy', at: spanning(keyword.at, target.at), finally: false };
  }
  if (target.kind === 'end' || punct(target, '}')) {
    p.diagnostics.refuse(
      p.source.span(keyword.at.end),
      '`destroy` does not say what to remove.',
      'Write `destroy self`: an object removes only itself.',
    );
    return null;
  }
  p.diagnostics.refuse(
    stepOverTarget(p),
    '`destroy` removes only the object whose body runs it.',
    'Write `destroy self`. To be rid of something else, send it a message and let it destroy itself.',
  );
  return null;
}

/**
 * `finally destroy self`: `self` marked to be destroyed once the turn's
 * queue is empty. Only `destroy self` may follow `finally`; anything else
 * after the word is refused once, and stepped over.
 */
export function finallyStatement(p: Parser): DestroyStatement | null {
  const keyword = p.take('name', 'finally');
  if (keyword === null) {
    notAStatement(p, p.peek());
    return null;
  }
  if (!p.at('name', 'destroy')) {
    const next = p.peek();
    const nothing = next.kind === 'end' || punct(next, '}');
    p.diagnostics.refuse(
      nothing ? p.source.span(keyword.at.end) : stepOverTarget(p),
      'Only `destroy self` may follow `finally`.',
      'Write `finally destroy self`, which destroys the object once every message the turn has sent has been handled.',
    );
    return null;
  }
  const destroy = destroyStatement(p);
  if (destroy === null) return null;
  return { kind: 'destroy', at: spanning(keyword.at, destroy.at), finally: true };
}

/**
 * What an author wrote after `destroy` in place of `self`: a word and the
 * dotted steps after it, or one token that is no word. Taken whole, so
 * one wrong target is one refusal.
 */
function stepOverTarget(p: Parser): Span {
  const first = p.peek();
  if (first.kind !== 'name' && first.kind !== 'kind') {
    if (first.kind !== 'punct') p.next();
    return first.at;
  }
  let last = p.next();
  while (punct(p.peek(), '.') && (p.peek(1).kind === 'name' || p.peek(1).kind === 'kind')) {
    p.next();
    last = p.next();
  }
  return spanning(first.at, last.at);
}
