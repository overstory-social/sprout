// Moving a thing through consent (the spec's Movement and consent;
// Consent under composition; The world model › Places; Limits › Runtime
// budgets). The containment tree is the engine's, so a move is the engine
// polling everyone with standing: the thing's `depart`, then the source's
// `release`, then the destination's `accept`, each list in its kind's run
// order, and the first refusal decides: nothing after it is asked.
//
// Two invariants. Nothing is written until every party has allowed, so a
// fault or a refusal leaves the draft as it was, and the one write is
// `Draft.place`, which puts the thing last in its new container. And what
// the engine then tells the world is returned rather than queued or said:
// the messages for the queue (`bus.ts`), and the notices a place speaks,
// for `prose/` to render (B31 describes the place to the one who moved). A move is
// charged for what it runs, its range walks and its guards' bodies, and
// nothing for itself: the statement that proposed it is its body's step.

import { isActor } from '../declare/actors.js';
import type { GuardName } from '../syntax/ast.js';
import type { ResolvedPassage } from '../declare/passages.js';
import type { Speech } from './body.js';
import type { Budget } from './budget.js';
import type { Catalogue } from './catalogue.js';
import type { Draft } from './draft.js';
import { boundObject, type Evaluated } from './evaluate.js';
import { runGuard, type Refusal } from './guards.js';
import type { InstanceId } from './ids.js';
import { engineLine } from './engine-lines.js';
import type { EngineSend } from './lifecycle.js';
import { isLive, liveTree } from './live.js';
import { rangeOf, reaches, type PassRule, type RangeContext } from './range.js';

/** Why a move could not even be asked about. */
export type MoveFaultReason = 'out-of-range' | 'holds-nothing' | 'world' | 'away';

/**
 * A move the world cannot make, as a spawn's `LifecycleFault` is: thrown,
 * because the turn cannot do what it was asked and is about to be rolled
 * back, and faulting the turn (`faults.ts`). The detail
 * names the object by its id, for the log and the host, never for a visitor.
 */
export class MoveFault extends Error {
  constructor(
    readonly reason: MoveFaultReason,
    /** The instance the fault is about: the thing moved, or where it was to go. */
    readonly object: InstanceId,
    detail: string,
  ) {
    super(detail);
    this.name = 'MoveFault';
  }
}

/** What a move reads and writes. */
export interface MoveContext {
  readonly draft: Draft;
  /** Every kind by name, which a guard's `is(K)` reads, and the host's caps now. */
  readonly catalogue: Catalogue;
  readonly passes: PassRule<InstanceId>;
  readonly budget: Budget;
}

/**
 * The engine's own refusals, asked before any guard: a thing going
 * inside itself (Movement and consent › After the move), and an actor
 * going into something that does not hold actors.
 */
export type EngineRefusal = 'inside-itself' | 'not-a-place';

/** The engine's refusal of a move, with the words the actor reads and the bindings they render with. */
export interface EngineRefused {
  readonly engine: EngineRefusal;
  /** For a thing inside itself, the world's `inside_itself` as it applies on the world's kind. */
  readonly said: Speech;
  /** `item` for `inside_itself`; `item` and `to` for the fixed words. */
  readonly bindings: ReadonlyMap<string, Evaluated>;
}

/** A move refused: by a party's guard, or by the engine. */
export type Refused = { readonly refusal: Refusal } | EngineRefused;

/** The world's line for a move that would make a container hold itself (the spec's After the move). */
const INSIDE_ITSELF = 'inside_itself';

/** The engine's fixed words for an actor moved into what holds no actors, a one-line passage of `item` and `to`. */
const NOT_A_PLACE = engineLine('{item} cannot stand in {to}.');

/**
 * What the engine sends everything in range of a place an actor left or
 * entered that does not read the place's notice (the spec's Places; After
 * the move): `:departed (actor, to)` across the old place's range and
 * `:arrived (actor, from)` across the new one's, the engine the sender.
 */
export type PlaceSend =
  | {
      readonly message: 'departed';
      readonly recipient: InstanceId;
      readonly actor: InstanceId;
      readonly to: InstanceId;
    }
  | {
      readonly message: 'arrived';
      readonly recipient: InstanceId;
      readonly actor: InstanceId;
      readonly from: InstanceId;
    };

/**
 * What the engine speaks for a place when an actor moves between two:
 * the old place's `leaves` to the visitors in its range, the new place's
 * `arrives` to the visitors in its, each with the passage as it applies
 * on the place's kind and the binding it renders with; and the new
 * place's description to the one who moved, which B31 writes.
 */
export type Notice =
  | {
      readonly notice: 'leaves' | 'arrives';
      readonly place: InstanceId;
      readonly passage: ResolvedPassage;
      readonly bindings: { readonly item: InstanceId };
      /** Every visitor in range of the place, nearest first, the one who moved left out. */
      readonly audience: readonly InstanceId[];
    }
  | {
      readonly notice: 'described';
      readonly place: InstanceId;
      readonly audience: readonly [InstanceId];
    };

/** A move made. */
export interface Moved {
  readonly item: InstanceId;
  readonly from: InstanceId;
  readonly to: InstanceId;
  /**
   * `:left` to `from`, `:entered` to `to`, `:moved` to the item, then,
   * where an actor moved, every `:departed` and every `:arrived`, each
   * nearest first; the engine the sender.
   */
  readonly sends: readonly (EngineSend | PlaceSend)[];
  /** `leaves`, `arrives`, then `described`, where an actor moved between places. */
  readonly notices: readonly Notice[];
}

/**
 * How a move reaches its destination: through the mover's range, as a
 * `move` does, or through an exit, which joins one place to another
 * however far apart they sit (the spec's Places inside places), so the
 * destination's range is not asked.
 */
export type Reach = 'range' | 'exit';

/**
 * Move `item` into `to`, as `mover` proposes: the faults, then the
 * engine's refusals, then the three parties' guards, then the one write.
 * Faults, writing nothing, when the item is the world or an away visitor,
 * the item is out of `mover`'s range, `to` is not live or, reached
 * through range, out of it, or `to` holds nothing.
 */
export function moveInstance(
  context: MoveContext,
  mover: InstanceId,
  item: InstanceId,
  to: InstanceId,
  reach: Reach = 'range',
): Moved | Refused {
  const { draft, catalogue, passes, budget } = context;

  if (item === draft.world) {
    throw new MoveFault('world', item, 'the world is the root of the tree, and goes nowhere.');
  }
  const moving = draft.instance(item);
  if (moving !== undefined && moving.made.from === 'visitor' && moving.container === null) {
    throw new MoveFault(
      'away',
      item,
      `\`${item}\` is a visitor who is away, and is nowhere to be moved from.`,
    );
  }
  const range = { tree: liveTree(draft), passes, budget };
  if (moving === undefined || !isLive(draft, item) || !reaches(range, mover, item, 'any')) {
    throw new MoveFault(
      'out-of-range',
      item,
      `\`${item}\` is out of range of \`${mover}\`, so it could not be moved.`,
    );
  }
  if (!isLive(draft, to) || (reach === 'range' && !reaches(range, mover, to, 'any'))) {
    throw new MoveFault(
      'out-of-range',
      to,
      `\`${to}\` is out of range of \`${mover}\`, so nothing could be moved into it.`,
    );
  }
  if (to !== draft.world && draft.instance(to)?.kind.contains !== true) {
    throw new MoveFault(
      'holds-nothing',
      to,
      `\`${to}\` holds nothing, so \`${item}\` could not be moved into it.`,
    );
  }
  // Live and not the world, so it is somewhere.
  const from = moving.container!;

  if (within(draft, to, item)) {
    return {
      engine: 'inside-itself',
      said: { passage: worldPassage(draft, INSIDE_ITSELF) },
      bindings: new Map([['item', boundObject(item)]]),
    };
  }
  const actor = isActor(moving.kind);
  if (actor && !holdsActors(draft, to)) {
    return {
      engine: 'not-a-place',
      said: NOT_A_PLACE,
      bindings: new Map([
        ['item', boundObject(item)],
        ['to', boundObject(to)],
      ]),
    };
  }

  const ask = (
    party: InstanceId,
    guard: GuardName,
    parameters: readonly InstanceId[],
  ): Refusal | null => {
    for (const written of draft.instance(party)?.kind.guards[guard] ?? []) {
      const outcome = runGuard(written, {
        state: draft,
        kinds: catalogue.lookup,
        budget,
        caps: catalogue.caps,
        names: catalogue.names,
        passes,
        self: party,
        mover,
        parameters,
      });
      if (outcome !== 'allow') return outcome;
    }
    return null;
  };
  const refusal =
    ask(item, 'depart', [to]) ??
    ask(from, 'release', [item, to]) ??
    ask(to, 'accept', [item, from]);
  if (refusal !== null) return { refusal };

  draft.place(item, to);

  const sends: (EngineSend | PlaceSend)[] = [
    { message: 'left', recipient: from, item, to },
    { message: 'entered', recipient: to, item, from },
    { message: 'moved', recipient: item, from, to },
  ];
  const notices: Notice[] = [];
  // An actor is only ever in a place, so it has moved between two.
  if (actor) {
    const notice = (name: 'leaves' | 'arrives', place: InstanceId) =>
      draft.instance(place)?.kind.passages.get(name);
    const leaves = notice('leaves', from);
    const arrives = notice('arrives', to);
    const left = told(draft, range, from, item, leaves !== undefined);
    const entered = told(draft, range, to, item, arrives !== undefined);
    for (const recipient of left.sent)
      sends.push({ message: 'departed', recipient, actor: item, to });
    for (const recipient of entered.sent)
      sends.push({ message: 'arrived', recipient, actor: item, from });
    if (leaves !== undefined)
      notices.push({
        notice: 'leaves',
        place: from,
        passage: leaves,
        bindings: { item },
        audience: left.read,
      });
    if (arrives !== undefined)
      notices.push({
        notice: 'arrives',
        place: to,
        passage: arrives,
        bindings: { item },
        audience: entered.read,
      });
    notices.push({ notice: 'described', place: to, audience: [item] });
  }
  return { item, from, to, sends, notices };
}

/**
 * Who is told that `actor` left or entered `place`, walking the place's
 * range as it stands after the move, nearest first, the actor left out:
 * the visitors, who read the place's notice where it writes one, and
 * everything else, the place itself, NPCs and a surface included, which is
 * sent the message; where the place writes no notice its visitors are sent
 * the message too, so nobody in range is told nothing.
 */
function told(
  draft: Draft,
  range: RangeContext<InstanceId>,
  place: InstanceId,
  actor: InstanceId,
  hasText: boolean,
): { readonly read: InstanceId[]; readonly sent: InstanceId[] } {
  const read: InstanceId[] = [];
  const sent: InstanceId[] = [];
  for (const { node } of rangeOf(range, place, 'any').reached) {
    if (node === actor) continue;
    if (hasText && draft.instance(node)?.made.from === 'visitor') read.push(node);
    else sent.push(node);
  }
  return { read, sent };
}

/** One of the engine's lines, as it applies on the world's composed kinds. */
function worldPassage(draft: Draft, name: string): ResolvedPassage {
  const passage = draft.instance(draft.world)?.kind.passages.get(name);
  if (passage === undefined)
    throw new Error(`the world composes no \`${name}\` passage, which \`sprout.World\` writes.`);
  return passage;
}

/** Whether `node` is `outer` or anywhere inside it, climbing the draft's containers. */
function within(draft: Draft, node: InstanceId, outer: InstanceId): boolean {
  const climbed = new Set<InstanceId>();
  for (let at: InstanceId | null = node; at !== null && !climbed.has(at);) {
    if (at === outer) return true;
    climbed.add(at);
    at = draft.instance(at)?.container ?? null;
  }
  return false;
}

/** Whether `id`'s kind declares `contains actors`: whether it is a place. */
function holdsActors(draft: Draft, id: InstanceId): boolean {
  return draft.instance(id)?.kind.containsActors === true;
}
