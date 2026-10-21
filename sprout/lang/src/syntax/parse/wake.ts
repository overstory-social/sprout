// `wake in 3 hours` and `cancel wakes`, read (the spec's Time › Wakes).
// The object whose body runs either asks or takes back for itself, so
// there is no target to write: `wake` takes `in`, how long to wait, and
// `seconds`, `minutes` or `hours`; `cancel` takes `wakes` alone. How long
// is a whole number written out or an expression in brackets,
// `wake in (self.get(:delay)) minutes`, so the unit after it is never
// read as part of it. Neither `cancel` nor `wakes` is reserved, so
// `cancel` starts a statement unless punctuation follows it on its line.
// The count's type, whether the wait fits what `elapsed` can carry, and
// where each may stand, are the checker's.
//
// A refused one costs only itself: a word the next statement or the
// body's next member starts with, or anything starting a line of its
// own, is never taken for any part of it. How a count and its unit are
// read is `timeCount`, which `pass` reads its own with.

import type { CancelWakesStatement, Expr, WakeStatement, TimeUnit } from '../ast.js';
import type { Token } from '../lexer.js';
import { spanning, textOf, type Span } from '../../source/source.js';
import { expression } from './expressions.js';
import { punct, type Parser } from './parser.js';
import { skipBracketed } from './recovery.js';
import {
  firstOnItsLine,
  notAStatement,
  onItsOwn,
  startsNext,
  type Enclosing,
} from './statements.js';

const UNITS: readonly TimeUnit[] = ['seconds', 'minutes', 'hours'];

/** The singular a unit is sometimes written as, for the remedy that asks for the plural. */
const SINGULAR: ReadonlyMap<string, TimeUnit> = new Map([
  ['second', 'seconds'],
  ['minute', 'minutes'],
  ['hour', 'hours'],
]);

/** The words a statement that counts time is refused in, `wake in` and `pass` each its own. */
export interface Counting {
  /** The statement's words before its count, as a refusal quotes them: `wake in`. */
  readonly head: string;
  /** Said where nothing follows the head. */
  readonly nothing: string;
  /** Said where the count is neither a whole number nor in brackets. */
  readonly notACount: string;
  /** Said where the brackets hold nothing. */
  readonly empty: string;
  /** Said where the brackets are never closed. */
  readonly unclosed: string;
  /** What counts, as a sentence starts it: `A wake`. */
  readonly counter: string;
  readonly example: string;
  readonly workedOut: string;
}

const WAKE: Counting = {
  head: 'wake in',
  nothing: '`wake in` does not say how long to wait.',
  notACount: 'How long a wake waits is a whole number written out, or worked out in brackets.',
  empty: 'These brackets hold nothing, and a wake needs to know how long to wait.',
  unclosed: 'How long the wake waits ends here, and its bracket is never closed.',
  counter: 'A wake',
  example:
    'Write how long to wait, as in `wake in 3 hours`, `wake in 10 minutes` or `wake in 90 seconds`.',
  workedOut:
    'Write a whole number, as in `wake in 3 hours`, or put what it is worked out from in brackets, as in `wake in (self.get(:delay)) minutes`.',
};

/** `wake in 3 hours`, `wake in (self.get(:delay)) minutes`. Null having said why. */
export function wakeStatement(p: Parser, within: Enclosing = onItsOwn()): WakeStatement | null {
  const keyword = p.take('name', 'wake');
  if (keyword === null) {
    notAStatement(p, p.peek());
    return null;
  }
  const word = p.take('name', 'in');
  if (word === null) {
    p.diagnostics.refuse(p.source.span(keyword.at.end), '`wake` does not say when.', WAKE.example);
    return null;
  }
  const counted = timeCount(p, within, word, WAKE);
  if (counted === null) return null;
  return { kind: 'wake', at: spanning(keyword.at, counted.end), ...counted.read };
}

/**
 * A count of time and its unit, after `after`: a whole number written
 * out or an expression in brackets, then `seconds`, `minutes` or `hours`,
 * with where the unit ends. Null having said why, in `counting`'s words.
 */
export function timeCount(
  p: Parser,
  within: Enclosing,
  after: Token,
  counting: Counting,
): { readonly read: { readonly count: Expr; readonly unit: TimeUnit }; readonly end: Span } | null {
  const count = countOf(p, within, after, counting);
  if (count === null) return null;
  const written = textOf(count.written);
  const { head } = counting;

  const unit = p.peek();
  const plural = unit.kind === 'name' ? UNITS.find((u) => u === unit.text) : undefined;
  if (plural !== undefined) {
    p.next();
    return { read: { count: count.count, unit: plural }, end: unit.at };
  }
  const singular = unit.kind === 'name' ? SINGULAR.get(unit.text) : undefined;
  const taken = partOf(p, within, unit) && unit.kind !== 'punct';
  if (taken) p.next();
  p.diagnostics.refuse(
    taken ? unit.at : p.source.span(count.written.end),
    singular === undefined
      ? `\`${head} ${written}\` does not say seconds, minutes or hours.`
      : `${counting.counter} counts in \`${singular}\`, always written that way.`,
    singular === undefined
      ? `Write \`${head} ${written} hours\`, \`${head} ${written} minutes\` or \`${head} ${written} seconds\`.`
      : `Write \`${head} ${written} ${singular}\`.`,
  );
  return null;
}

/**
 * The count after `after`: a whole number written out, or an expression
 * in brackets, with the span written. Null having said why.
 */
function countOf(
  p: Parser,
  within: Enclosing,
  after: Token,
  counting: Counting,
): { readonly count: Expr; readonly written: Span } | null {
  const count = p.peek();
  if (count.kind === 'integer') {
    p.next();
    return {
      count: { kind: 'integer', at: count.at, value: Number(count.text) },
      written: count.at,
    };
  }
  if (punct(count, '(')) return bracketedCount(p, counting);
  const nothing = !partOf(p, within, count);
  if (!nothing && count.kind !== 'punct') p.next();
  p.diagnostics.refuse(
    nothing ? p.source.span(after.at.end) : count.at,
    nothing ? counting.nothing : counting.notACount,
    nothing ? counting.example : counting.workedOut,
  );
  return null;
}

/** `(self.get(:delay))` as a count: one expression in brackets. Null having said why. */
function bracketedCount(
  p: Parser,
  counting: Counting,
): { readonly count: Expr; readonly written: Span } | null {
  const open = p.next();
  if (p.at('punct', ')')) {
    const close = p.next();
    p.diagnostics.refuse(spanning(open.at, close.at), counting.empty, counting.workedOut);
    return null;
  }
  if (!p.deeper(open.at)) {
    skipBracketed(p, ')');
    return null;
  }
  try {
    const count = expression(p);
    if (count === null) {
      skipBracketed(p, ')');
      return null;
    }
    const close = p.take('punct', ')');
    if (close === null) {
      p.diagnostics.refuse(
        p.done ? p.source.endSpan : p.peek().at,
        counting.unclosed,
        'Add a ) after it, before `seconds`, `minutes` or `hours`.',
      );
      skipBracketed(p, ')');
      return null;
    }
    return { count, written: spanning(open.at, close.at) };
  } finally {
    p.depth -= 1;
  }
}

/**
 * Whether `cancel` here starts `cancel wakes`: anything but punctuation
 * follows it on its line, or nothing does. Where `.`, `(` or an operator
 * follows, `cancel` is a name an author gave, read as one.
 */
export function atCancel(p: Parser): boolean {
  if (!p.at('name', 'cancel')) return false;
  const next = p.peek(1);
  return next.kind !== 'punct' || punct(next, '}') || firstOnItsLine(p, next);
}

const CANCEL = 'Write `cancel wakes`, which takes back every wake this object has asked for.';

/**
 * `cancel wakes`. Null having said why. A word the next statement or the
 * body's next member starts with is never taken for what it cancels,
 * but for `wake` written alone where `wakes` was meant.
 */
export function cancelStatement(
  p: Parser,
  within: Enclosing = onItsOwn(),
): CancelWakesStatement | null {
  const keyword = p.take('name', 'cancel');
  if (keyword === null) {
    notAStatement(p, p.peek());
    return null;
  }
  const word = p.peek();
  if (word.kind === 'name' && word.text === 'wakes' && !firstOnItsLine(p, word)) {
    p.next();
    return { kind: 'cancel-wakes', at: spanning(keyword.at, word.at) };
  }
  if (singularWake(p, word)) {
    p.next();
    p.diagnostics.refuse(word.at, '`cancel` takes back `wakes`, always written that way.', CANCEL);
    return null;
  }
  if (!partOf(p, within, word)) {
    p.diagnostics.refuse(
      p.source.span(keyword.at.end),
      '`cancel` does not say what it cancels.',
      CANCEL,
    );
    return null;
  }
  if (word.kind !== 'punct') p.next();
  p.diagnostics.refuse(
    word.at,
    `\`cancel\` takes back wakes, and ${p.subject(word, false)} is not something it cancels.`,
    CANCEL,
  );
  return null;
}

/** Whether `word`, after `cancel` on its line, is `wake` meant as `wakes` rather than a `wake` statement. */
function singularWake(p: Parser, word: Token): boolean {
  if (word.kind !== 'name' || word.text !== 'wake' || firstOnItsLine(p, word)) return false;
  const after = p.peek(1);
  return !(after.kind === 'name' && after.text === 'in');
}

/**
 * Whether `token` is written as part of this statement: on its line,
 * and not the next statement's, the next member's or the end of a block.
 */
function partOf(p: Parser, within: Enclosing, token: Token): boolean {
  if (token.kind === 'end' || punct(token, '}') || p.atDeclarationStart()) return false;
  if (firstOnItsLine(p, token)) return false;
  return !startsNext(p, within, token);
}
