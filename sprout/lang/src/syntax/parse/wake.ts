// `wake in 3 hours`, read (the spec's Time › Wakes). The object whose
// body runs it asks to be woken, so there is no target to write: `in`, a
// whole number written out, and `seconds`, `minutes` or `hours`. Whether
// the wait fits what `elapsed` can carry, and where the statement may
// stand, are the checker's.
//
// A refused one costs only itself: a word the next statement or the
// body's next member starts with, or anything starting a line of its
// own, is never taken for any part of it.

import type { WakeStatement, WakeUnit } from '../ast.js';
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
 * Whether `token` is written as part of this statement: on its line,
 * and not the next statement's, the next member's or the end of a block.
 */
function partOf(p: Parser, within: Enclosing, token: Token): boolean {
  if (token.kind === 'end' || punct(token, '}') || p.atDeclarationStart()) return false;
  if (firstOnItsLine(p, token)) return false;
  return !startsNext(p, within, token);
}
