// Who reads what is told (the spec's Other people › Who hears it; Verbs ›
// Acting). A plain `tell` reaches the people in the teller's place, less
// whoever the reading it stands in already addresses; `tell <x>` reaches
// `x` only where `x` is in the teller's range when the `tell` runs (The
// world model › Range), by the walk a `get` makes and charged as it is.
// Only a person reads: a line told to an NPC, to anything that is not a
// person, or to a person out of range goes nowhere, and nothing faults.
//
// The teller's place is the teller where it holds actors, as a place
// ticking is, and otherwise its nearest container that does, so a place
// inside a place keeps what is told in it to its own occupants.

import type { Budget } from './budget.js';
import type { InstanceId } from './ids.js';
import { isLive, liveTree } from './live.js';
import { reaches, type PassRule } from './range.js';
import type { StateReader } from './state.js';

/** What `tell <x>` reads to find whether `x` is in range: the turn's state, the pass rules, and the meter. */
export interface TellContext {
  readonly state: StateReader;
  readonly passes: PassRule<InstanceId>;
  readonly budget: Budget;
}

/** Whether a person is behind `id`, rather than nobody, as behind an NPC or a thing. */
export function isPerson(state: StateReader, id: InstanceId): boolean {
  return state.instance(id)?.made.from === 'visitor';
}

/**
 * Where what `teller` tells is heard: itself, where it holds actors, else
 * its nearest container that does; null where nothing around it does.
 */
export function placeOfTeller(state: StateReader, teller: InstanceId): InstanceId | null {
  for (let at: InstanceId | null = teller; at !== null;) {
    const instance = state.instance(at);
    if (instance === undefined) return null;
    if (instance.kind.containsActors) return at;
    at = instance.container;
  }
  return null;
}

/**
 * Who reads a plain `tell` from `teller`: the people directly in its
 * place, in contents order, less everyone in `leftOut`.
 */
export function toldToPlace(
  state: StateReader,
  teller: InstanceId,
  leftOut: readonly InstanceId[],
): InstanceId[] {
  const place = placeOfTeller(state, teller);
  if (place === null) return [];
  const left = new Set(leftOut);
  return state.children(place).filter((id) => !left.has(id) && isPerson(state, id));
}

/**
 * Who reads `tell x` from `teller`: `x`, where it is a person live in the
 * world and in the teller's range now; else nobody.
 */
export function toldToOne(context: TellContext, teller: InstanceId, x: InstanceId): InstanceId[] {
  const { state, passes, budget } = context;
  if (!isPerson(state, x) || !isLive(state, x)) return [];
  return reaches({ tree: liveTree(state), passes, budget }, teller, x, 'any') ? [x] : [];
}
