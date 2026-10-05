// Whether a place is lit, and what someone standing in a dark one can
// see (the spec's Range › Sight). A place's `lit` is polled as an exit's
// `when` is: a place that writes none is lit, and a condition that reads
// through a name out of the place's range, or a declared object
// destroyed, does not hold, so the place is dark rather than the poll
// faulting. In the dark a visitor sees only themselves and what they
// carry; messages, range and every body's reads are as they were.

import { libraryOf } from '../declare/enums.js';
import type { Budget } from './budget.js';
import type { Catalogue } from './catalogue.js';
import { evaluateCondition } from './evaluate.js';
import type { InstanceId } from './ids.js';
import { DestroyedReference, NameOutOfRange } from './named.js';
import type { PassRule } from './range.js';
import type { StateReader } from './state.js';

/** What asking a place's `lit` reads: the state, the bundle, the meter and the pass rules. */
export interface LitContext {
  readonly state: StateReader;
  readonly catalogue: Catalogue;
  readonly budget: Budget;
  readonly passes: PassRule<InstanceId>;
}

/** Whether `place` is lit now: its `lit` holds, or it writes none. */
export function isLit(place: InstanceId, context: LitContext): boolean {
  const instance = context.state.instance(place);
  const lit = instance?.kind.grammar.lit ?? null;
  if (instance === undefined || lit === null) return true;
  try {
    return evaluateCondition(lit.value.condition, {
      state: context.state,
      kinds: context.catalogue.lookup,
      library: libraryOf(lit.origin),
      self: place,
      bindings: new Map(),
      budget: context.budget,
      caps: context.catalogue.caps,
      names: context.catalogue.names,
      passes: context.passes,
    });
  } catch (thrown) {
    if (thrown instanceof NameOutOfRange || thrown instanceof DestroyedReference) return false;
    throw thrown;
  }
}

/** Whether `actor` stands in the dark: their place is not lit. One away stands nowhere, and is not. */
export function inTheDark(actor: InstanceId, context: LitContext): boolean {
  const place = context.state.instance(actor)?.container ?? null;
  return place !== null && !isLit(place, context);
}
