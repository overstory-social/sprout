// `pass 90 seconds`, read (the spec's Time › Passing time). A visitor's
// command asks the host to let that much time pass, so there is nothing to
// name but how long: a count and its unit, written as a `wake`'s are and
// read by the same `timeCount`. `pass` is reserved, and starts a pass rule
// where a body's member is read; a statement reads it here. The count's
// type and where it may stand are the checker's.

import type { PassTimeStatement } from '../ast.js';
import { spanning } from '../../source/source.js';
import type { Parser } from './parser.js';
import { notAStatement, onItsOwn, type Enclosing } from './statements.js';
import { timeCount, type Counting } from './wake.js';

const PASS: Counting = {
  head: 'pass',
  nothing: '`pass` does not say how much time passes.',
  notACount: 'How much time passes is a whole number written out, or worked out in brackets.',
  empty: 'These brackets hold nothing, and a pass needs to know how much time passes.',
  unclosed: 'How much time passes ends here, and its bracket is never closed.',
  counter: 'A pass',
  example:
    'Write how much time passes, as in `pass 90 seconds`, `pass 10 minutes` or `pass 1 hours`.',
  workedOut:
    'Write a whole number, as in `pass 10 minutes`, or put what it is worked out from in brackets, as in `pass (self.get(:wait)) minutes`.',
};

/** `pass 90 seconds`, `pass (self.get(:wait)) minutes`. Null having said why. */
export function passStatement(p: Parser, within: Enclosing = onItsOwn()): PassTimeStatement | null {
  const keyword = p.take('name', 'pass');
  if (keyword === null) {
    notAStatement(p, p.peek());
    return null;
  }
  const counted = timeCount(p, within, keyword, PASS);
  if (counted === null) return null;
  return { kind: 'pass-time', at: spanning(keyword.at, counted.end), ...counted.read };
}
