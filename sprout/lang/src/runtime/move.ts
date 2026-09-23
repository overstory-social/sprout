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
// the three messages for B32's queue, and the notices a place speaks for
// B29 to render (B31 describes the place to the one who moved).

import { isActor } from '../declare/actors.js';
import type { GuardName } from '../syntax/ast.js';
import type { ResolvedPassage } from '../declare/passages.js';
import type { Budget } from './budget.js';
import type { Catalogue } from './catalogue.js';
import type { Draft } from './draft.js';
import { runGuard, type Refusal } from './guards.js';
import { declaredPathOf, type InstanceId } from './ids.js';
import type { EngineSend } from './lifecycle.js';
import { isLive, liveTree } from './live.js';
import { reaches, type PassRule } from './range.js';

/** Why a move could not even be asked about. */
export type MoveFaultReason = 'out-of-range' | 'holds-nothing' | 'world' | 'away';

/**
 * A move the world cannot make, as a spawn's `LifecycleFault` is: thrown,
 * because the turn cannot do what it was asked and is about to be rolled
 * back, and turned by B34 into the world's `fault` passage. The detail
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

/** A move refused: by a party's guard, or by the engine, with the words the actor reads. */
export type Refused =
  { readonly refusal: Refusal } | { readonly engine: EngineRefusal; readonly text: string };

/**
 * What the engine speaks for a place when an actor moves between two:
 * the old place's `leaves` to those left behind, the new place's
 * `arrives` to those already there, each with the passage as it applies
 * on the place's kind and the binding it renders with; and the new
 * place's description to the one who moved, which B31 writes.
 */
export type Notice =
  | {
      readonly notice: 'leaves' | 'arrives';
      readonly place: InstanceId;
      readonly passage: ResolvedPassage;
      readonly bindings: { readonly item: InstanceId };
      /** The actors directly in the place, the one who moved left out, NPCs included. */
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
  /** `:left` to `from`, `:entered` to `to`, `:moved` to the item, in that order, the engine the sender. */
  readonly sends: readonly EngineSend[];
  /** `leaves`, `arrives`, then `described`, where an actor moved between places. */
  readonly notices: readonly Notice[];
}

/**
 * Move `item` into `to`, as `mover` proposes: the faults, then the
 * engine's refusals, then the three parties' guards, then the one write.
 * Faults, writing nothing, when the item is the world or an away visitor,
 * the item or `to` is out of `mover`'s range, or `to` holds nothing.
 */
export function moveInstance(
  context: MoveContext,
  mover: InstanceId,
  item: InstanceId,
  to: InstanceId,
): Moved | Refused {
  const { draft, catalogue, passes, budget } = context;
  budget.spend();

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
  if (!isLive(draft, to) || !reaches(range, mover, to, 'any')) {
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
    return { engine: 'inside-itself', text: `${nameOf(draft, item)} cannot go inside itself.` };
  }
  const actor = isActor(moving.kind);
  if (actor && !holdsActors(draft, to)) {
    return {
      engine: 'not-a-place',
      text: `${nameOf(draft, item)} cannot stand in ${nameOf(draft, to)}.`,
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

  const sends: EngineSend[] = [
    { message: 'left', recipient: from, item, to },
    { message: 'entered', recipient: to, item, from },
    { message: 'moved', recipient: item, from, to },
  ];
  const notices: Notice[] = [];
  if (actor && holdsActors(draft, from) && holdsActors(draft, to)) {
    const spoken = (notice: 'leaves' | 'arrives', place: InstanceId): void => {
      const passage = draft.instance(place)?.kind.passages.get(notice);
      if (passage === undefined) return;
      const audience = draft
        .children(place)
        .filter((one) => one !== item && isActor(draft.instance(one)!.kind));
      notices.push({ notice, place, passage, bindings: { item }, audience });
    };
    spoken('leaves', from);
    spoken('arrives', to);
    notices.push({ notice: 'described', place: to, audience: [item] });
  }
  return { item, from, to, sends, notices };
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

/**
 * An object as the engine's own refusals name it until B29 renders
 * names: a declared object by its identifier, the world by its name, and
 * anything made while the world runs by its kind's name.
 */
function nameOf(draft: Draft, id: InstanceId): string {
  const path = declaredPathOf(draft.world, id);
  if (path !== null) return path.at(-1) ?? draft.world;
  return draft.instance(id)?.kind.name ?? id;
}
