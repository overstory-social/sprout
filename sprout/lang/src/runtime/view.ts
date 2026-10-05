// A visitor's view, derived (the spec's The runtime › The view, Faults).
// What a poll gives a visitor standing in a place: that place's
// description with them as `actor`; each way out that applies, an exit by
// direction and a link by its label; every other actor in their range
// under the pass rules, so someone inside an open wardrobe is listed and
// someone inside a shut one is not; what they carry; and every reading
// the parser could build from what is in range, with its consent pass's
// answer and the options of each value role. In the dark the description
// is the world's `dark`, nobody else is listed, and only what they carry
// is offered, beside the ways out (the spec's Range › Sight). Each part
// is derived in the order the spec lists it and charged to the poll's
// steps; `viewOf` fills `parts` as it goes, so a caller whose poll then
// runs out of budget still holds every part derived before the fault,
// per the spec's Faults row for a poll. Nothing here is rendered, which is `prose/view.ts`'s.

import { isActor } from '../declare/actors.js';
import { inTheDark } from './darkness.js';
import { describeFor, type Description } from './describe.js';
import { exitsFrom } from './exits.js';
import type { InstanceId } from './ids.js';
import { liveTree } from './live.js';
import { offersTo, type Offer, type OfferContext } from './offers.js';
import { valueOptions, type RoleOptions } from './options.js';
import type { CommandExit } from './parser/exits.js';
import { rangeOf } from './range.js';
import type { StateReader } from './state.js';

/** One reading a visitor could make now, with the options each of its value roles offers. */
export interface ViewReading extends Offer {
  /** Each value role's options, in the order the verb declares its roles. */
  readonly options: readonly RoleOptions[];
}

/** What a poll derives for one visitor standing in a place, unrendered. */
export interface View {
  readonly actor: InstanceId;
  readonly place: InstanceId;
  readonly description: Description;
  /**
   * Each way out that applies: an exit by direction, a link by its label;
   * one for each direction that has one and each link set, in the order
   * the place's kind answers them.
   */
  readonly exits: readonly CommandExit[];
  /** Every other actor in the visitor's range under the pass rules, visitor or not, nearest first. */
  readonly occupants: readonly InstanceId[];
  /** What the visitor holds, in contents order. */
  readonly carried: readonly InstanceId[];
  readonly readings: readonly ViewReading[];
}

/**
 * What a poll has derived of a view so far: filled one field at a time,
 * so a fault partway through (the spec's Faults) leaves in the caller's
 * hands whatever was assigned before it, since an exception unwinds past
 * `viewOf` without touching what it already wrote here.
 */
export interface ViewParts {
  exits: readonly CommandExit[];
  occupants: readonly InstanceId[];
  carried: readonly InstanceId[];
  readings: readonly ViewReading[];
}

/** A `ViewParts` with nothing derived yet. */
export function emptyViewParts(): ViewParts {
  return { exits: [], occupants: [], carried: [], readings: [] };
}

/**
 * The view `actor` has where they stand. They must stand in something:
 * an actor who is away has no view, which is the caller's defect. `parts`
 * is filled in the order the spec's The view lists them, so a caller that
 * catches a fault from this still holds every part derived first.
 */
export function viewOf(
  actor: InstanceId,
  context: OfferContext,
  parts: ViewParts = emptyViewParts(),
): View {
  const { state, budget, passes } = context;
  const place = state.instance(actor)?.container ?? null;
  if (place === null) throw new Error(`\`${actor}\` is away, and an away visitor has no view.`);
  const description = describeFor(place, actor, 'poll', context);
  parts.exits = exitsFrom(place, context);
  const range = rangeOf({ tree: liveTree(state), passes, budget }, actor, 'any');
  // In the dark nobody else is seen (the spec's Range › Sight).
  parts.occupants = inTheDark(actor, context)
    ? []
    : range.reached
        .filter(({ via, node }) => via !== 'self' && actorIn(state, node))
        .map(({ node }) => node);
  parts.carried = state.children(actor);
  parts.readings = offersTo(actor, context, parts.exits, range).map((offer): ViewReading => ({
    ...offer,
    options: valueOptions(offer.reading, context),
  }));
  return {
    actor,
    place,
    description,
    exits: parts.exits,
    occupants: parts.occupants,
    carried: parts.carried,
    readings: parts.readings,
  };
}

function actorIn(state: StateReader, id: InstanceId): boolean {
  const instance = state.instance(id);
  return instance !== undefined && isActor(instance.kind);
}
