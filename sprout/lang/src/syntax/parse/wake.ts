// `wake in 3 hours` and `cancel wakes`, read (the spec's Time › Wakes).
// The object whose body runs either asks or takes back for itself, so
// there is no target to write: `wake` takes `in`, a whole number written
// out, and `seconds`, `minutes` or `hours`; `cancel` takes `wakes` alone.
// Neither `cancel` nor `wakes` is reserved, so `cancel` starts a
// statement unless punctuation follows it on its line. Whether the wait
// fits what `elapsed` can carry, and where each may stand, are the
// checker's.
//
// A refused one costs only itself: a word the next statement or the
// body's next member starts with, or anything starting a line of its
// own, is never taken for any part of it.

import type { CancelWakesStatement, WakeStatement, WakeUnit } from '../ast.js';
import type { Token } from '../lexer.js';
import { spanning } from '../../source/source.js';
import { punct, type Parser } from './parser.js';
import {
  firstOnItsLine,
  notAStatement,
  onItsOwn,
  startsNext,
  type Enclosing,
} from './statements.js';

const UNITS: readonly WakeUnit[] = ['seconds', 'minutes', 'hours'];

/** The singular a unit is sometimes written as, for the remedy that asks for the plural. */
const SINGULAR: ReadonlyMap<string, WakeUnit> = new Map([
  ['second', 'seconds'],
  ['minute', 'minutes'],
  ['hour', 'hours'],
]);

const EXAMPLE =
  'Write how long to wait, as in `wake in 3 hours`, `wake in 10 minutes` or `wake in 90 seconds`.';

/** `wake in 3 hours`. Null having said why. */
export function wakeStatement(p: Parser, within: Enclosing = onItsOwn()): WakeStatement | null {
  const keyword = p.take('name', 'wake');
  if (keyword === null) {
    notAStatement(p, p.peek());
    return null;
  }
  const word = p.take('name', 'in');
  if (word === null) {
    p.diagnostics.refuse(p.source.span(keyword.at.end), '`wake` does not say when.', EXAMPLE);
    return null;
  }

  const count = p.peek();
  if (count.kind !== 'integer') {
    const nothing = !partOf(p, within, count);
    if (!nothing && count.kind !== 'punct') p.next();
    p.diagnostics.refuse(
      nothing ? p.source.span(word.at.end) : count.at,
      nothing
        ? '`wake in` does not say how long to wait.'
        : 'How long a wake waits is a whole number, written out.',
      EXAMPLE,
    );
    return null;
  }
  p.next();

  const unit = p.peek();
  const plural = unit.kind === 'name' ? UNITS.find((u) => u === unit.text) : undefined;
  if (plural !== undefined) {
    p.next();
    return {
      kind: 'wake',
      at: spanning(keyword.at, unit.at),
      count: { kind: 'integer', at: count.at, value: Number(count.text) },
      unit: plural,
    };
  }
  const singular = unit.kind === 'name' ? SINGULAR.get(unit.text) : undefined;
  const taken = partOf(p, within, unit) && unit.kind !== 'punct';
  if (taken) p.next();
  p.diagnostics.refuse(
    taken ? unit.at : p.source.span(count.at.end),
    singular === undefined
      ? `\`wake in ${count.text}\` does not say seconds, minutes or hours.`
      : `A wake counts in \`${singular}\`, always written that way.`,
    singular === undefined
      ? `Write \`wake in ${count.text} hours\`, \`wake in ${count.text} minutes\` or \`wake in ${count.text} seconds\`.`
      : `Write \`wake in ${count.text} ${singular}\`.`,
  );
  return null;
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
