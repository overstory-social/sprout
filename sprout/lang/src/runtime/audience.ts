// Who reads what is told (the spec's Other people › Who hears it; Verbs ›
// Acting). A plain `tell` reaches the people in the teller's place, less
// whoever the reading it stands in already addresses; `tell <x>` reaches
// `x`, where `x` is a person in the world. Only a person reads: a line
// told to an NPC, or to anything that is not a person, goes nowhere.
//
// The teller's place is the teller where it holds actors, as a place
// ticking is, and otherwise its nearest container that does, so a place
// inside a place keeps what is told in it to its own occupants.

import type { InstanceId } from './ids.js';
import type { StateReader } from './state.js';

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

/** Who reads `tell x`: `x`, where it is a person standing in the world; else nobody. */
export function toldToOne(state: StateReader, x: InstanceId): InstanceId[] {
  const container = state.instance(x)?.container ?? null;
  return container !== null && isPerson(state, x) ? [x] : [];
}
