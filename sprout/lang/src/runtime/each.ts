// What an `each` walks (the spec's Properties › Walking contents; The
// world model › Range). `each x in c` visits what `c` directly holds, in
// its order, leaving out whatever is out of range of the body's `self`,
// so a shut chest seen from outside is walked as holding nothing; a kind
// filter keeps only the contents composing it (`contents.ts`). `each x
// of s` visits the members of a set role, in the order the reading bound
// them.

import type { EachStatement } from '../syntax/ast.js';
import { contentsSeenOfKind } from './contents.js';
import { boundObject, evaluate, type Evaluated, type Frame } from './evaluate.js';

/** What `statement` visits, in order, as its variable is bound to each. */
export function eachWalked(statement: EachStatement, frame: Frame): Evaluated[] {
  const over = evaluate(statement.over, frame);
  if (statement.walks === 'of') {
    if (over.binds !== 'set') {
      throw new Error('`each … of` walked what is not a set role, which the checker refuses.');
    }
    return over.ids.map(boundObject);
  }
  if (over.binds !== 'object') {
    throw new Error('`each … in` walked what is not a thing, which the checker refuses.');
  }
  return contentsSeenOfKind(frame, over.id, statement.filter).map(boundObject);
}
