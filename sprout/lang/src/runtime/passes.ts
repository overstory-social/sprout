// The pass rule a world's containers answer with while it runs (the
// spec's Events, messages and the bus › Containers route; The world model
// › Range). A container asked about a message answers with its kind's
// `pass :m` for that message where one is written, else its `pass any`;
// asked about no message, as `get`, `each` and a command's nouns ask, with
// its `pass any`. Where it writes neither it relays, except the world,
// whose unwritten rule is `pass any (false)`. A rule is a condition read
// with `self` the container, charged to the turn's steps as any
// expression is; it only reads, so asking it changes nothing.

import type { StaticCaps } from '../bundle/limits.js';
import { libraryOf, qualifiedName } from '../declare/enums.js';
import type { KindLookup } from '../declare/kinds.js';
import type { ResolvedPass } from '../declare/passes.js';
import { WORLD_PASSES_ANYTHING } from '../declare/world.js';
import type { Budget } from './budget.js';
import { evaluateCondition } from './evaluate.js';
import type { InstanceId } from './ids.js';
import type { NameTable } from '../check/names.js';
import type { Asking, PassRule } from './range.js';
import type { StateReader } from './state.js';

/** What asking a rule reads: the turn's state, every kind by name, the host's caps, and the meter. */
export interface PassContext {
  readonly state: StateReader;
  readonly kinds: KindLookup;
  readonly caps: StaticCaps;
  readonly budget: Budget;
  /** The names the bundle's bodies resolved, which a rule may read through. */
  readonly names: NameTable;
}

/** The pass rule the containers in `context.state` answer with, as their kinds write it. */
export function passRules(context: PassContext): PassRule<InstanceId> {
  const rules: PassRule<InstanceId> = (container, asking) => {
    const instance = context.state.instance(container);
    const written = instance === undefined ? null : ruleFor(instance.kind.passes, asking);
    if (written === null) return container === context.state.world ? WORLD_PASSES_ANYTHING : true;
    return evaluateCondition(written.declaration.rule, {
      state: context.state,
      kinds: context.kinds,
      library: libraryOf(written.origin),
      self: container,
      bindings: new Map(),
      budget: context.budget,
      caps: context.caps,
      names: context.names,
      passes: rules,
    });
  };
  return rules;
}

/** The rule a kind answers `asking` with, or null where it writes none that applies. */
function ruleFor(
  passes: {
    readonly any: ResolvedPass | null;
    readonly messages: ReadonlyMap<string, ResolvedPass>;
  },
  asking: Asking,
): ResolvedPass | null {
  if (asking !== 'any') {
    const own = passes.messages.get(qualifiedName(asking.library, asking.name));
    if (own !== undefined) return own;
  }
  return passes.any;
}
