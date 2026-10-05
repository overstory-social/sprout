// What a place sees by, for its `lit` (the spec's Range › Sight). Sight
// walks as range does, with one difference: a person's hands are open
// to it, so a lamp someone carries lights the place they stand in though
// `sprout.Actor` passes nothing. A shut container still hides what it
// holds. It is a walk like any other, charged to the meter.

import { isActor } from '../declare/actors.js';
import type { Budget } from './budget.js';
import type { InstanceId } from './ids.js';
import { liveTree } from './live.js';
import { rangeOf, type PassRule } from './range.js';
import type { StateReader } from './state.js';

/** What a sight walk reads: the state, the turn's pass rules and its meter. */
export interface SightContext {
  readonly state: StateReader;
  readonly passes: PassRule<InstanceId>;
  readonly budget: Budget;
}

/** Everything `from` sees, nearest first, itself included. */
export function seenFrom(from: InstanceId, context: SightContext): InstanceId[] {
  const { state, passes, budget } = context;
  const open: PassRule<InstanceId> = (container, asking) => {
    const kind = state.instance(container)?.kind;
    return (kind !== undefined && isActor(kind)) || passes(container, asking);
  };
  return rangeOf({ tree: liveTree(state), passes: open, budget }, from, 'any').reached.map(
    ({ node }) => node,
  );
}
