// Who reads what is told (the spec's Other people › Who hears it; Verbs ›
// Acting). `tell <x>` reaches `x` only where `x` is in the teller's range
// when the `tell` runs (The world model › Range), by the walk a `get`
// makes and charged as it is. A plain, an `inside` or an `outside` `tell`
// asks the same pass rules of the containers between the teller and its
// place, less whoever the reading it stands in already addresses: a
// thing inside a shut chest is heard by nothing outside the chest, and
// the chest itself, shut, is still heard in the room, since nothing
// stands between them. Only a person reads: a line told to an NPC, to
// anything that is not a person, or to one out of range goes nowhere,
// and nothing faults.
//
// A teller that itself holds actors, a wardrobe, has two audiences: its
// own occupants, and the place around it — its nearest container that
// also holds actors. A plain `tell` reaches both; `tell inside` reaches
// only the first, and `tell outside` only the second. A teller that does
// not hold actors has one audience, the place around it, as a plain
// `tell` always did.

import type { Budget } from './budget.js';
import type { InstanceId } from './ids.js';
import { isLive, liveTree } from './live.js';
import { reaches, type PassRule } from './range.js';
import type { StateReader } from './state.js';

/** What a plain or a directed `tell` reads to find who reaches whom: the turn's state, the pass rules, and the meter. */
export interface TellContext {
  readonly state: StateReader;
  readonly passes: PassRule<InstanceId>;
  readonly budget: Budget;
}

/** Whether a person is behind `id`, rather than nobody, as behind an NPC or a thing. */
export function isPerson(state: StateReader, id: InstanceId): boolean {
  return state.instance(id)?.made.from === 'visitor';
}

/** `teller`'s own occupants: its direct contents, where its kind declares `contains actors`; empty otherwise. */
export function occupantsOf(state: StateReader, teller: InstanceId): readonly InstanceId[] {
  const instance = state.instance(teller);
  if (instance === undefined || !instance.kind.containsActors) return [];
  return state.children(teller);
}

/**
 * The place around `teller`: its nearest container, strictly outward,
 * whose kind declares `contains actors`; null where none does.
 */
function surroundOf(state: StateReader, teller: InstanceId): InstanceId | null {
  const instance = state.instance(teller);
  if (instance === undefined) return null;
  for (let at = instance.container; at !== null;) {
    const container = state.instance(at);
    if (container === undefined) return null;
    if (container.kind.containsActors) return at;
    at = container.container;
  }
  return null;
}

/** `people`, filtered to those who are actually a person, less everyone in `leftOut`. */
function personsExcept(
  state: StateReader,
  people: readonly InstanceId[],
  leftOut: ReadonlySet<InstanceId>,
): InstanceId[] {
  return people.filter((id) => !leftOut.has(id) && isPerson(state, id));
}

/** Who reads `tell inside` from `teller`, less `leftOut`: its own occupants are always among its hearers, since a container reaches its own contents unconditionally (The world model › Range), so no pass rule is asked of them. */
export function toldInside(
  context: TellContext,
  teller: InstanceId,
  leftOut: readonly InstanceId[],
): InstanceId[] {
  return personsExcept(context.state, occupantsOf(context.state, teller), new Set(leftOut));
}

/**
 * Whether a voice from `teller` carries out to `surround`: every
 * container strictly between them, and `surround` itself, must pass,
 * since `surround`'s own rule gates what it holds from outside it (the
 * spec's Events, messages and the bus › Sending; Other people › Who
 * hears it). One step of the turn's budget per container climbed, asked
 * once for the whole of `surround`'s audience, never once per hearer, so
 * a crowded room costs the host no more to address than an empty one
 * (Prose › What this costs).
 */
function opensOutward(context: TellContext, teller: InstanceId, surround: InstanceId): boolean {
  const { state, passes, budget } = context;
  let at = teller;
  while (at !== surround) {
    const instance = state.instance(at);
    if (instance === undefined || instance.container === null) return false;
    at = instance.container;
    budget.spend();
    if (!passes(at, 'any')) return false;
  }
  return true;
}

/** Who reads `tell outside` from `teller`, less `leftOut`: the people in the place around it, where a voice from `teller` carries out to it. */
export function toldOutside(
  context: TellContext,
  teller: InstanceId,
  leftOut: readonly InstanceId[],
): InstanceId[] {
  const surround = surroundOf(context.state, teller);
  if (surround === null || !opensOutward(context, teller, surround)) return [];
  return personsExcept(context.state, context.state.children(surround), new Set(leftOut));
}

/**
 * Who reads a plain `tell` from `teller`: everyone `tell inside` and
 * `tell outside` would reach from it, its own occupants first, less
 * everyone in `leftOut`.
 */
export function toldToPlace(
  context: TellContext,
  teller: InstanceId,
  leftOut: readonly InstanceId[],
): InstanceId[] {
  return [...toldInside(context, teller, leftOut), ...toldOutside(context, teller, leftOut)];
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
