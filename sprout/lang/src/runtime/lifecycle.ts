// Making and unmaking instances while a world runs (the spec's The world
// model › Spawning, Destroying; Limits › Runtime budgets). A spawn makes
// an instance of a declared kind at its defaults, under a minted id, last
// in a container in range, and with it a copy of everything its kinds'
// bodies give it, all the way down, each under a minted id of its own; a
// destroy removes an instance and everything inside it, all the way down,
// dormant records included, tombstones every declared object among them,
// which is gone for good, and tells no one.
//
// Two invariants. Nothing is written until every check has passed, so a
// fault leaves the draft as it was, and a spawn makes all of what it
// would make or none of it. And what the engine tells the world
// of a spawn is returned as `EngineSend`s rather than queued here, as a
// destroy returns every instance it removed, so the queue (`bus.ts`) holds the one
// rule for what is dropped with a destroyed object (the spec's Destroying).

import type { Budget } from './budget.js';
import type { Catalogue } from './catalogue.js';
import type { Draft } from './draft.js';
import type { Draws } from './draws.js';
import type { InstanceId } from './ids.js';
import type { HostSeconds } from './time.js';
import { isLive, liveTree } from './live.js';
import { reaches, type PassRule } from './range.js';
import { newInstance, type Made } from './state.js';
import { isActor } from '../declare/actors.js';
import { givenBy, type KindContent, type KindContents } from '../declare/contents.js';
import type { KindRef } from '../declare/kinds.js';

/** Why a spawn or a destroy could not be made. */
export type LifecycleFaultReason =
  | 'instances'
  | 'out-of-range'
  | 'holds-nothing'
  | 'holds-no-actors'
  | 'kind-absent'
  | 'world'
  | 'visitor'
  | 'visitor-inside';

/**
 * A spawn or a destroy the world cannot make. Thrown, as `ListFull` is,
 * because the turn cannot do what it was asked and is about to be rolled
 * back, and faults the turn (`faults.ts`). The detail names the object
 * by its id, for the log and the host, never for a visitor.
 */
export class LifecycleFault extends Error {
  constructor(
    readonly reason: LifecycleFaultReason,
    /** The instance the fault is about: the container of a spawn, the object of a destroy. */
    readonly object: InstanceId,
    detail: string,
  ) {
    super(detail);
    this.name = 'LifecycleFault';
  }
}

/**
 * A message the engine sends for itself, for the queue to deliver in the order
 * given (the spec's Events, messages and the bus › Receiving). Its sender
 * is the engine, never the object a binding names; each arm carries the
 * bindings its handler receives, by the names the spec gives them.
 */
export type EngineSend =
  | {
      readonly message: 'entered';
      readonly recipient: InstanceId;
      readonly item: InstanceId;
      readonly from: InstanceId;
    }
  | {
      readonly message: 'left';
      readonly recipient: InstanceId;
      readonly item: InstanceId;
      readonly to: InstanceId;
    }
  | {
      readonly message: 'moved';
      readonly recipient: InstanceId;
      readonly from: InstanceId;
      readonly to: InstanceId;
    }
  | { readonly message: 'spawned'; readonly recipient: InstanceId; readonly from: InstanceId };

/** What a spawn, a destroy and a `wake` read and write, and what an acting body draws from. */
export interface LifecycleContext {
  readonly draft: Draft;
  readonly catalogue: Catalogue;
  readonly passes: PassRule<InstanceId>;
  readonly budget: Budget;
  /** The turn's one stream of draws (`draws.ts`). */
  readonly draws: Draws;
  /**
   * The most instances the host will store for this world this turn (the
   * world, declared, spawned, visitors and dormant alike), recorded with
   * the turn; null where it sets no bound.
   */
  readonly mayHold: number | null;
  /** The instant the turn runs, in host seconds, which a `wake` is asked at. */
  readonly now: HostSeconds;
}

export interface Spawned {
  readonly id: InstanceId;
  /** What its kinds gave it, each after what holds it, all the way down. */
  readonly contents: readonly InstanceId[];
  /** `:entered` to the container, then `:spawned` to the new instance; nothing for its contents. */
  readonly sends: readonly EngineSend[];
}

/** One instance a spawn makes: its kind, how it was made, and which of the others holds it. */
interface Making {
  readonly kind: KindRef;
  readonly made: Made;
  /** The index in the list of the one that holds it; null for the instance spawned. */
  readonly holder: number | null;
}

export interface Destroyed {
  readonly id: InstanceId;
  /**
   * Every instance removed: `id`, then what it held, as `Draft.subtree`
   * orders them. The caller drops everything pending on each (the spec's
   * Destroying); nothing is sent for any of them.
   */
  readonly removed: readonly InstanceId[];
}

/**
 * Spawn an instance of `kind`, by qualified name, into `container` at the
 * kind's defaults, with its contents; `spawner` is the object whose body
 * ran the `spawn`. Faults, writing nothing, when the kind is absent, the
 * container is out of range, holds nothing, or holds no actors where
 * anything made is an actor, or the turn's cap or the host's bound is
 * reached by any of what it would make.
 */
export function spawnInstance(
  context: LifecycleContext,
  spawner: InstanceId,
  kind: string,
  container: InstanceId,
): Spawned {
  const { draft, catalogue, passes, budget, mayHold } = context;
  const made = catalogue.kinds.get(kind);
  const shown = `\`${shownKind(kind)}\``;
  if (made === undefined) {
    throw new LifecycleFault(
      'kind-absent',
      container,
      `${shown} is absent, so it could not be spawned.`,
    );
  }
  const inRange =
    reaches({ tree: liveTree(draft), passes, budget }, spawner, container, 'any') &&
    isLive(draft, container);
  if (!inRange) {
    throw new LifecycleFault(
      'out-of-range',
      container,
      `\`${container}\` is out of range of \`${spawner}\`, so nothing could be spawned in it.`,
    );
  }
  if (container !== draft.world && draft.instance(container)?.kind.contains !== true) {
    throw new LifecycleFault(
      'holds-nothing',
      container,
      `\`${container}\` holds nothing, so ${shown} could not be spawned in it.`,
    );
  }
  if (isActor(made) && draft.instance(container)?.kind.containsActors !== true) {
    throw new LifecycleFault(
      'holds-no-actors',
      container,
      `\`${container}\` holds no actors, so ${shown}, an actor, could not be spawned in it.`,
    );
  }
  const making = madeWith(made, kind, catalogue.contents);
  for (const one of making) {
    const holder = one.holder === null ? null : making[one.holder]!;
    if (holder !== null && isActor(one.kind) && !holder.kind.containsActors) {
      throw new LifecycleFault(
        'holds-no-actors',
        container,
        `\`${one.kind.name}\`, an actor, would be inside \`${holder.kind.name}\`, which holds no actors, so ${shown} could not be spawned.`,
      );
    }
  }
  for (let n = 0; n < making.length; n++) budget.spawn();
  if (mayHold !== null && draft.held + making.length > mayHold) {
    throw new LifecycleFault(
      'instances',
      container,
      `the host will hold no more instances in this world, so ${shown} could not be spawned.`,
    );
  }
  const ids: InstanceId[] = [];
  for (const one of making) {
    const id = draft.mint();
    const into = one.holder === null ? container : ids[one.holder]!;
    draft.add(newInstance(id, one.made, one.kind, into, draft.nextSerial(), catalogue.caps));
    ids.push(id);
  }
  const [id] = ids as [InstanceId, ...InstanceId[]];
  return {
    id,
    contents: ids.slice(1),
    sends: [
      { message: 'entered', recipient: container, item: id, from: spawner },
      { message: 'spawned', recipient: id, from: spawner },
    ],
  };
}

/**
 * Everything a spawn of `made`, by qualified name `kind`, makes: the
 * instance first, then each content after what holds it, what a holder's
 * kinds give before what its own body holds. A content whose kind is
 * absent is not made, and nor is what it holds.
 */
function madeWith(made: KindRef, kind: string, contents: KindContents): Making[] {
  const making: Making[] = [{ kind: made, made: { from: 'spawned', kind }, holder: null }];
  const inside = (holder: number, own: readonly KindContent[]): [KindContent, number][] =>
    [...givenBy(contents, making[holder]!.kind), ...own].map((content) => [content, holder]);
  const pending = inside(0, []).reverse();
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const [content, holder] = next;
    if (content.kind === null) continue;
    making.push({
      kind: content.kind,
      made: { from: 'given', kind: content.giver, path: content.path },
      holder,
    });
    pending.push(...inside(making.length - 1, content.holds).reverse());
  }
  return making;
}

/**
 * Destroy `id`, as `destroy self` does when the body that ran it ends,
 * and everything inside it with it; each record stays readable through
 * `draft.destroyed` for the rest of the turn. Faults, writing nothing,
 * for the world, and for a visitor or anything with a visitor inside it.
 */
export function destroyInstance(draft: Draft, id: InstanceId): Destroyed {
  if (id === draft.world) {
    throw new LifecycleFault('world', id, 'the world cannot be destroyed.');
  }
  const instance = draft.instance(id);
  if (instance === undefined) throw new Error(`\`${id}\` is not an instance in this world.`);
  if (instance.made.from === 'visitor') {
    throw new LifecycleFault(
      'visitor',
      id,
      `\`${id}\` is a visitor, and a person is never destroyed.`,
    );
  }
  const visitor = draft
    .subtree(id)
    .find((one) => (draft.instance(one) ?? draft.dormant(one))?.made.from === 'visitor');
  if (visitor !== undefined) {
    throw new LifecycleFault(
      'visitor-inside',
      id,
      `\`${id}\` has the visitor \`${visitor}\` inside it, and a person is never destroyed.`,
    );
  }
  return { id, removed: draft.remove(id) };
}

/** A kind as a fault names it: its own name, as an author most often writes it. */
function shownKind(qualified: string): string {
  return qualified.slice(qualified.lastIndexOf('.') + 1);
}
