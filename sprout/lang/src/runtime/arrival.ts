// A visitor's arrival (the spec's The host contract › Admission and
// identity; The world model › Actors and visitors; The compiler › What
// absent means). A new visitor is an instance of the visitor kind, made
// as they arrive; a returning one comes back where they last stood if
// that place still exists and accepts them, and otherwise where the world
// says visitors arrive, told through the world's `displaced` when the
// place they stood in is gone. Entry is a move from outside the tree: the
// place's `accept` is asked, with the world as `from`, and then the place
// is sent `:entered`, the visitor `:moved`, the place's range `arrives`
// and `:arrived`, and the visitor reads the place's description once the
// queue is empty. What it says is one sequence of effects: `displaced`,
// where it is told, the place's `arrives`, what the queue said, then the
// description.
//
// Two invariants. An arrival is a write turn, so a fault abandons all of
// it; a visitor the place refuses, or a world that admits no one, writes
// nothing either, and each is told in words. Catch-up is not this turn's:
// the host runs the maintenance turn first (core's `runArrival`).

import { runGuard } from './guards.js';
import { drain, type Drained } from './bus.js';
import type { Catalogue } from './catalogue.js';
import { noticeLines, saidLines, type Effect, type Speaking, type Unrendered } from './effects.js';
import { arrivalsRead } from './engine-verbs.js';
import { engineLine } from './engine-lines.js';
import type { Speech } from './body.js';
import type { InstanceId, VisitKey } from './ids.js';
import type { EngineSend } from './lifecycle.js';
import { isPlace, liveTree } from './live.js';
import { placeEntered, type Notice, type PlaceSend } from './move.js';
import { keptNickname, nicknameRefusal } from './nickname.js';
import { turnState, type Said } from './reading.js';
import { newInstance, readerOf, type StateReader, type WorldState } from './state.js';
import {
  writeTurn,
  type Committed,
  type Faulted,
  type TurnHost,
  type WriteInputs,
  type WriteTurn,
} from './turn.js';

/** One visitor arriving, as the host hands it over and the log records it. */
export interface Arrival extends WriteInputs {
  readonly visit: VisitKey;
  /** The nickname the host admitted for this visit (`nicknameRefusal`), kept as its words single-spaced. */
  readonly nickname: string;
}

/** Why a world admits no one, each a row of the spec's What absent means. */
export type ClosedReason =
  /** The bundle has no world declaration to admit anyone through. */
  | 'no-world'
  /** Nothing for a visitor to be made of. */
  | 'no-visitor-kind'
  /** The place visitors arrive at is absent from source. */
  | 'no-arrival-place'
  /** It is declared, and destroyed, of an absent kind, inside something absent, or no longer a place. */
  | 'arrival-place-gone';

/** Entry refused as a host matter: the host says so outside the world, in these words or its own. */
export interface Closed {
  readonly reason: ClosedReason;
  readonly words: string;
}

/** What a host tells a person a world admits no one, outside the world. */
export const NOT_ADMITTING = 'This world is not letting anyone in just now.';

/** What a host tells a person whose arrival faulted, outside the world, as for a crash. */
export const ENTRY_FAILED = 'Something went wrong as you arrived, and you have not come in.';

/** The stock line for a world whose standard library leaves `displaced` out. */
const DISPLACED_STOCK = 'The place you were standing is gone.';

/** Where a visitor came in, and what the engine sends and says of it. */
export interface Entered {
  readonly place: InstanceId;
  /** `:entered` to the place, `:moved` to the visitor, then every `:arrived`, nearest first. */
  readonly sends: readonly (EngineSend | PlaceSend)[];
  /** The place's `arrives` to the visitors in its range, then its description to the one who came in. */
  readonly notices: readonly Notice[];
  /** The place's `arrives`, as a line to the visitors in its range. */
  readonly said: readonly Said[];
}

/** An entry: made, or refused by the place's `accept`, whose words the visitor reads. */
export type Entry = Entered | { readonly refused: Said };

/** What a committed arrival did. */
export interface Admitted {
  readonly visit: VisitKey;
  /** The instance that is the visitor. */
  readonly instance: InstanceId;
  /** Whether the visit was one the world had seen. */
  readonly returning: boolean;
  /** The world's `displaced`, told first, where the place the visitor stood in is gone. */
  readonly displaced: Said | null;
  readonly entered: Entered;
  /** What the queue did from the entry on. */
  readonly drained: Drained;
  /** The place the visitor came in to, as they read it, and any other a move of the queue's carried them to. */
  readonly answers: readonly Unrendered[];
}

/**
 * An arrival turn: committed; refused by the place, writing nothing;
 * closed, the world admitting no one; or faulted and abandoned, the
 * visitor not admitted.
 */
export type ArrivalTurn =
  | Committed<Admitted>
  | {
      readonly committed: false;
      readonly refused: Said;
      /** The world as the refusal found the visitor, standing nowhere: what its words rendered against, never written. */
      readonly seen: WorldState;
      /** The refusal, rendered: the one effect of a refused arrival. */
      readonly effects: readonly Effect[];
    }
  | { readonly committed: false; readonly closed: Closed }
  | (Faulted & { readonly words: string });

/**
 * Why `catalogue`'s world admits no one whatever its state, or null: no
 * world, no visitor kind, or no arrival place in source. A host may ask
 * this before running catch-up for someone who cannot come in.
 */
export function closedByBundle(catalogue: Catalogue): ClosedReason | null {
  if (catalogue.worldKind === null) return 'no-world';
  if (catalogue.visitorKind === null) return 'no-visitor-kind';
  if (catalogue.arrival === null) return 'no-arrival-place';
  return null;
}

/** Why the world admits no one as `state` stands, or null; a destroyed arrival place is absent (the spec's Destroying). */
export function closedIn(state: StateReader, catalogue: Catalogue): ClosedReason | null {
  const reason = closedByBundle(catalogue);
  if (reason !== null) return reason;
  return isPlace(state, catalogue.arrival!) ? null : 'arrival-place-gone';
}

/**
 * Run `arrival` as one arrival turn over the committed `state`. A visit
 * already standing in the world, or a nickname `nicknameRefusal` refuses
 * with no cap on its length, which only the host knows, is the host's
 * defect, thrown before the turn opens.
 */
export function arrivalTurn(state: WorldState, host: TurnHost, arrival: Arrival): ArrivalTurn {
  const committed = readerOf(state);
  const { catalogue } = host;
  const unadmitted = nicknameRefusal(
    state,
    catalogue,
    { characters: null },
    arrival.visit,
    arrival.nickname,
  );
  if (unadmitted !== null) {
    throw new Error(
      `\`${arrival.visit}\` arrives with a nickname the host did not admit: ${unadmitted.words}`,
    );
  }
  const nickname = keptNickname(arrival.nickname);
  const record = committed.visitor(arrival.visit);
  if (record !== undefined) {
    const instance = committed.instance(record.instance);
    if (instance === undefined && closedByBundle(catalogue) === null) {
      throw new Error(
        `\`${arrival.visit}\`'s instance \`${record.instance}\` is not in this world.`,
      );
    }
    if ((instance?.container ?? null) !== null) {
      throw new Error(`\`${arrival.visit}\` is already in this world.`);
    }
  }
  const reason = closedIn(committed, catalogue);
  if (reason !== null) return { committed: false, closed: { reason, words: NOT_ADMITTING } };

  const written = writeTurn<Admitted | { readonly refused: Said }>(
    state,
    'arrival',
    host,
    arrival,
    (turn) => {
      const { draft } = turn;
      let id: InstanceId;
      if (record === undefined) {
        id = draft.mint();
        draft.add(
          newInstance(id, { from: 'visitor' }, catalogue.visitorKind!, null, null, catalogue.caps),
        );
      } else id = record.instance;
      const lastPlace = record?.lastPlace ?? null;
      draft.putVisitor({ visit: arrival.visit, nickname, instance: id, lastPlace });

      const gone = lastPlace !== null && !isPlace(draft, lastPlace);
      let entry: Entry | null = lastPlace === null || gone ? null : enter(turn, id, lastPlace);
      // A last place that refuses is passed over for the arrival place, as one gone is.
      if (entry === null || 'refused' in entry) entry = enter(turn, id, catalogue.arrival!);
      if ('refused' in entry) return entry;
      draft.putVisitor({ visit: arrival.visit, nickname, instance: id, lastPlace: entry.place });
      const drained = drain({ sends: entry.sends, destroyed: [], marked: [] }, turn);
      return {
        visit: arrival.visit,
        instance: id,
        returning: record !== undefined,
        displaced: gone ? displacedLine(draft, id) : null,
        entered: entry,
        drained,
        answers: answersAfter(turn, [...entry.notices, ...drained.notices]),
      };
    },
    arrivalSpeaking,
  );
  if (!written.committed) return { ...written, words: ENTRY_FAILED };
  // Refused, the turn writes nothing: the place only decided.
  if ('refused' in written.value) {
    const { refused } = written.value;
    return { committed: false, refused, seen: written.state, effects: written.effects };
  }
  return { ...written, value: written.value };
}

/** What an arrival says, in order, and whose turn it is: the visitor's. */
function arrivalSpeaking(done: Admitted | { readonly refused: Said }): Speaking {
  if ('refused' in done)
    return { actor: done.refused.to[0] ?? null, lines: [{ said: done.refused }] };
  return {
    actor: done.instance,
    lines: [
      ...(done.displaced === null ? [] : [{ said: done.displaced }]),
      ...saidLines(done.entered.said),
      ...saidLines(done.drained.said),
      ...done.answers,
    ],
  };
}

/** What the engine answers once an entry's queue is empty: the place each person moved arrived in. */
function answersAfter(turn: WriteTurn, notices: readonly Notice[]): Unrendered[] {
  const { draft, catalogue, budget, passes } = turn;
  return arrivalsRead(notices, { state: turnState(draft), catalogue, budget, passes });
}

/**
 * Bring `visitor`, who stands nowhere live, into `place`: its `accept`
 * asked with the world as `from`, the first refusal deciding, then the one
 * write and what the engine sends and says of it.
 */
export function enter(turn: WriteTurn, visitor: InstanceId, place: InstanceId): Entry {
  const { draft, catalogue, budget, passes } = turn;
  const from = draft.world;
  for (const written of draft.instance(place)?.kind.guards.accept ?? []) {
    const outcome = runGuard(written, {
      state: draft,
      kinds: catalogue.lookup,
      budget,
      caps: catalogue.caps,
      names: catalogue.names,
      passes,
      self: place,
      mover: visitor,
      parameters: [visitor, from],
    });
    if (outcome === 'allow') continue;
    return {
      refused: {
        effect: 'refused',
        to: [visitor],
        by: outcome.by,
        speaker: null,
        said: outcome.said,
        bindings: outcome.bindings,
      },
    };
  }
  draft.place(visitor, place);
  const spoke = placeEntered(
    draft,
    { tree: liveTree(draft), passes, budget },
    place,
    visitor,
    from,
  );
  return {
    place,
    sends: [
      { message: 'entered', recipient: place, item: visitor, from },
      { message: 'moved', recipient: visitor, from, to: place },
      ...spoke.sends,
    ],
    notices: spoke.notices,
    said: noticeLines(spoke.notices),
  };
}

/** A visitor found standing in a place that is gone, on their next turn (the spec's What absent means). */
export interface Displaced {
  /** The world's `displaced`, told to them first. */
  readonly told: Said;
  /** Their entry at the arrival place; refused, or the world admitting no one, they stay where they were. */
  readonly entry: Entry | { readonly closed: Closed };
  /** What the queue did from the entry on, where they came in. */
  readonly drained: Drained | null;
  /** The place they came in to, as they read it, where they came in. */
  readonly answers: readonly Unrendered[];
}

/** Move `visit`'s visitor, whose place is gone, to the world's arrival place, as their turn's whole outcome. */
export function displace(turn: WriteTurn, visit: VisitKey): Displaced {
  const { draft, catalogue } = turn;
  const record = draft.visitor(visit);
  if (record === undefined) throw new Error(`\`${visit}\` has never visited this world.`);
  const visitor = record.instance;
  const told = displacedLine(draft, visitor);
  const reason = closedIn(draft, catalogue);
  if (reason !== null) {
    return {
      told,
      entry: { closed: { reason, words: NOT_ADMITTING } },
      drained: null,
      answers: [],
    };
  }
  const entry = enter(turn, visitor, catalogue.arrival!);
  if ('refused' in entry) return { told, entry, drained: null, answers: [] };
  draft.putVisitor({ ...record, lastPlace: entry.place });
  const drained = drain({ sends: entry.sends, destroyed: [], marked: [] }, turn);
  return {
    told,
    entry,
    drained,
    answers: answersAfter(turn, [...entry.notices, ...drained.notices]),
  };
}

/** The world's `displaced`, from the world, to `visitor`, rendered with nothing bound (the spec's bindings table). */
export function displacedLine(state: StateReader, visitor: InstanceId): Said {
  const passage = state.instance(state.world)?.kind.passages.get('displaced');
  const said: Speech = passage === undefined ? engineLine(DISPLACED_STOCK) : { passage };
  return {
    effect: 'notice',
    to: [visitor],
    by: state.world,
    speaker: null,
    said,
    bindings: new Map(),
  };
}
