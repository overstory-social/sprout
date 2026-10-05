// What a body sees a container hold (the spec's The world model › Range;
// Properties › Walking contents). `each`, `{for … in}`, `count`,
// `count(K)` and `holds` all read a container's direct contents through
// this one door, so they agree: only what is in range of the frame's
// `self` is seen, and a shut chest asked about from outside holds
// nothing. An object always reaches itself and its own contents, so a
// container asking about itself sees all it holds. Every range question
// is charged as any other is.

import type { KindExpr } from '../syntax/ast.js';
import { kindName } from '../declare/kinds.js';
import type { Frame } from './evaluate.js';
import type { InstanceId } from './ids.js';
import { isLive, liveTree } from './live.js';
import { reaches } from './range.js';

/** What the frame reads a range question with. */
type Asker = Pick<Frame, 'state' | 'passes' | 'budget' | 'self'>;

/** Whether `id` is live and in range of the frame's `self`. */
export function seenBy(frame: Asker, id: InstanceId): boolean {
  const range = { tree: liveTree(frame.state), passes: frame.passes, budget: frame.budget };
  return isLive(frame.state, id) && reaches(range, frame.self, id, 'any');
}

/** What `container` directly holds that the frame's `self` can see, in the container's order. */
export function contentsSeen(frame: Asker, container: InstanceId): InstanceId[] {
  return frame.state.children(container).filter((id) => seenBy(frame, id));
}

/**
 * What `container` holds that the frame's `self` can see, kept to those
 * composing the kind `filter` names, where it names one.
 */
export function contentsSeenOfKind(
  frame: Asker & Pick<Frame, 'kinds' | 'library'>,
  container: InstanceId,
  filter: KindExpr | null,
): InstanceId[] {
  const contents = contentsSeen(frame, container);
  if (filter === null) return contents;
  const kind =
    filter.library === null
      ? frame.kinds.unqualified(filter.name.text, frame.library)
      : frame.kinds.qualified(filter.library.text, filter.name.text);
  if (kind === null) {
    throw new Error(`\`${filter.name.text}\` is not a kind, which the checker refuses.`);
  }
  const identity = kindName(kind);
  return contents.filter((id) => frame.state.instance(id)?.kind.composes.has(identity) === true);
}
