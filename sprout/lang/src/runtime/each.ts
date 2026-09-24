// What an `each` walks (the spec's Properties › Walking contents; The
// world model › Range). `each x in c` visits what `c` directly holds, in
// its order, leaving out whatever is out of range of the body's `self`,
// so a shut chest seen from outside is walked as holding nothing; a kind
// filter keeps only the contents composing it. `each x of s` visits the
// members of a set role, in the order the reading bound them. Asking
// whether each thing is in range is charged as every range question is.

import type { EachStatement } from '../syntax/ast.js';
import { kindName } from '../declare/kinds.js';
import { boundObject, evaluate, type Evaluated, type Frame } from './evaluate.js';
import type { InstanceId } from './ids.js';
import { isLive, liveTree } from './live.js';
import { reaches } from './range.js';

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
  const range = { tree: liveTree(frame.state), passes: frame.passes, budget: frame.budget };
  const inRange = (id: InstanceId): boolean =>
    isLive(frame.state, id) && reaches(range, frame.self, id, 'any');
  const contents = frame.state.children(over.id).filter(inRange);
  const { filter } = statement;
  if (filter === null) return contents.map(boundObject);
  const kind =
    filter.library === null
      ? frame.kinds.unqualified(filter.name.text, frame.library)
      : frame.kinds.qualified(filter.library.text, filter.name.text);
  if (kind === null) {
    throw new Error(`\`${filter.name.text}\` is not a kind, which the checker refuses.`);
  }
  const identity = kindName(kind);
  return contents
    .filter((id) => frame.state.instance(id)?.kind.composes.has(identity) === true)
    .map(boundObject);
}
