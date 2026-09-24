// A visitor going away (the spec's The world model › Actors and
// visitors: a visitor who leaves keeps their state for a later visit and
// has no container while away; Places: leaving is the mirror of
// arriving). The visitor's instance leaves the tree with everything it
// carries, and where they stood is kept for their next arrival. No guard
// is asked, since a person is never held in a world; the place they left
// is sent `:left`, its range reads `leaves` and is sent `:departed`, with
// the world as `to`, and the one leaving is told so in the engine's words.
//
// A departure that faults is abandoned like every write turn, and the
// visitor then goes away in a turn of its own with nothing sent, as a
// faulted wake is consumed, so nobody is kept in by a world's fault.

import { drain, type Drained } from './bus.js';
import { engineLine } from './engine-lines.js';
import type { InstanceId, VisitKey } from './ids.js';
import type { EngineSend } from './lifecycle.js';
import { isPlace, liveTree } from './live.js';
import { placeLeft, type Notice, type PlaceSend } from './move.js';
import type { Said } from './reading.js';
import { readerOf, type WorldState } from './state.js';
import {
  writeTurn,
  type Committed,
  type Faulted,
  type TurnHost,
  type WriteInputs,
  type WriteTurn,
} from './turn.js';

/** One visitor going away, as the host hands it over and the log records it. */
export interface Departure extends WriteInputs {
  readonly visit: VisitKey;
}

/** The engine's words to the one who leaves: the spec gives the world no line for it. */
const GONE_AWAY = engineLine('You leave, and take what you carry with you.');

/** What a committed departure did. */
export interface Departed {
  readonly visit: VisitKey;
  /** The instance that is the visitor, now away. */
  readonly instance: InstanceId;
  /** Where they stood, kept as where they last stood. */
  readonly from: InstanceId;
  /** The engine's words to the one who left, from the world. */
  readonly told: Said;
  /** `:left` to the place, then every `:departed`, nearest first; nothing where the place is gone. */
  readonly sends: readonly (EngineSend | PlaceSend)[];
  /** The place's `leaves`, to the visitors in its range. */
  readonly notices: readonly Notice[];
  /** What the queue did from the departure on; null from a place that is gone, or made quietly after a fault. */
  readonly drained: Drained | null;
}

/** A departure turn: committed, or faulted and then made quietly in a turn of its own. */
export type DepartureTurn =
  | Committed<Departed>
  | (Faulted & {
      /** The visitor gone away with nothing sent, which the store writes. */
      readonly quietly: Committed<Departed>;
    });

/**
 * Run `departure` as one departure turn over the committed `state`. A
 * visit the world has never seen, or one already away, is the host's
 * defect, thrown before the turn opens.
 */
export function departureTurn(
  state: WorldState,
  host: TurnHost,
  departure: Departure,
): DepartureTurn {
  const committed = readerOf(state);
  const record = committed.visitor(departure.visit);
  if (record === undefined) {
    throw new Error(`\`${departure.visit}\` has never visited this world.`);
  }
  const from = committed.instance(record.instance)?.container ?? null;
  if (from === null) throw new Error(`\`${departure.visit}\` is not in this world to leave it.`);

  const left = writeTurn<Departed>(state, 'departure', host, departure, (turn) => {
    const away = goAway(turn, departure.visit, from);
    // A place that is gone has nobody in range to tell.
    if (!isPlace(readerOf(state), from)) return { ...away, drained: null };
    const { draft, passes, budget } = turn;
    const spoke = placeLeft(
      draft,
      { tree: liveTree(draft), passes, budget },
      from,
      record.instance,
      draft.world,
    );
    const sends = [
      { message: 'left', recipient: from, item: record.instance, to: draft.world } as const,
      ...spoke.sends,
    ];
    return {
      ...away,
      sends,
      notices: spoke.notices,
      drained: drain({ sends, destroyed: [], marked: [] }, turn),
    };
  });
  if (left.committed) return left;
  const quietly = writeTurn<Departed>(state, 'departure', host, departure, (turn) => ({
    ...goAway(turn, departure.visit, from),
    drained: null,
  }));
  if (!quietly.committed) {
    throw new Error(`\`${departure.visit}\` could not go away: ${quietly.fault.detail}`);
  }
  return { ...left, quietly };
}

/** Take `visit`'s visitor out of the tree, keeping `from` as where they last stood. */
function goAway(turn: WriteTurn, visit: VisitKey, from: InstanceId): Omit<Departed, 'drained'> {
  const { draft } = turn;
  const record = draft.visitor(visit)!;
  draft.place(record.instance, null);
  draft.putVisitor({ ...record, lastPlace: from });
  return {
    visit,
    instance: record.instance,
    from,
    told: {
      effect: 'notice',
      to: [record.instance],
      by: draft.world,
      speaker: null,
      said: GONE_AWAY,
      bindings: new Map(),
    },
    sends: [],
    notices: [],
  };
}
