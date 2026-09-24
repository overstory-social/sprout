// A visitor's view, derived (the spec's The runtime › The view). What a
// poll gives a visitor standing in a place: that place's description with
// them as `actor`; the exits that apply, with their labels; the other
// actors standing there; what they carry; and every reading the parser
// could build from what is in range, with its consent pass's answer and
// the options of each value role. It only reads, and is charged to the
// poll's steps, the description first; nothing here is rendered, which
// is `prose/view.ts`'s.

import { isActor } from '../declare/actors.js';
import { describeFor, type Description } from './describe.js';
import { exitsFrom } from './exits.js';
import type { InstanceId } from './ids.js';
import { offersTo, type Offer, type OfferContext } from './offers.js';
import { valueOptions, type RoleOptions } from './options.js';
import type { CommandExit } from './parser/exits.js';
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
  /** The exits that apply, one for each direction that has one, in the order the place's kind answers them. */
  readonly exits: readonly CommandExit[];
  /** Every other actor standing in the place, visitor or not, in contents order. */
  readonly occupants: readonly InstanceId[];
  /** What the visitor holds, in contents order. */
  readonly carried: readonly InstanceId[];
  readonly readings: readonly ViewReading[];
}

/**
 * The view `actor` has where they stand. They must stand in something:
 * an actor who is away has no view, which is the caller's defect.
 */
export function viewOf(actor: InstanceId, context: OfferContext): View {
  const { state } = context;
  const place = state.instance(actor)?.container ?? null;
  if (place === null) throw new Error(`\`${actor}\` is away, and an away visitor has no view.`);
  const description = describeFor(place, actor, context);
  const exits = exitsFrom(place, context);
  const readings = offersTo(actor, context, exits).map((offer): ViewReading => ({
    ...offer,
    options: valueOptions(offer.reading, context),
  }));
  return {
    actor,
    place,
    description,
    exits,
    occupants: state.children(place).filter((id) => id !== actor && actorIn(state, id)),
    carried: state.children(actor),
    readings,
  };
}

function actorIn(state: StateReader, id: InstanceId): boolean {
  const instance = state.instance(id);
  return instance !== undefined && isActor(instance.kind);
}
