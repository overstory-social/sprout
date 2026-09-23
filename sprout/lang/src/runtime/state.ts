// A world's state in memory (the spec's The runtime › State): per
// instance its id, how it was made, its kind, its container, its
// properties, its links, its pending wakes, its memory of each actor and
// when it last ticked; per visitor the visit, the nickname, the instance
// and where they last stood.
//
// A `WorldState` is immutable. A write turn works in a `Draft` over one
// and commits a new one or drops it, so a fault leaves the world exactly
// as it was and a poll reads the committed state (Limits › Runtime
// budgets; The runtime › Turns). What cannot be decoded against the
// bundle now is kept dormant, verbatim, so a file restored brings its
// objects back as they were (The compiler › What absent means).
//
// A container's contents are in one order (The world model › Range):
// declared objects still where they were declared first, in declared
// order, then everything that arrived, by arrival. An arrival draws the
// world's next serial, so whatever arrives last is last.

import type { StaticCaps } from '../bundle/limits.js';
import type { KindRef } from '../declare/kinds.js';
import type { InstanceId, VisitKey } from './ids.js';
import type { StoredInstance, StoredMade } from './stored.js';
import { defaultOf, type Value } from './values.js';

/** How an instance came to be: the world, a declared object, a visitor, a spawn, or what a spawn's kinds gave it. */
export type Made = StoredMade;

/** One pending wake: the serial it was asked under, and when it was asked and is due, in host seconds. */
export interface PendingWake {
  readonly serial: number;
  readonly askedAt: number;
  readonly dueAt: number;
}

/** One instance whose kind the bundle declares. */
export interface Instance {
  readonly id: InstanceId;
  readonly made: Made;
  /** What `made` resolves to in the bundle now; the closure is re-derived at every load, never stored. */
  readonly kind: KindRef;
  /** Null for the world, and for a visitor who is away. */
  readonly container: InstanceId | null;
  /** The serial of its last arrival; null for a declared object still where it was declared. */
  readonly arrival: number | null;
  /** Every property the kind declares that is not remembered, each with a value. */
  readonly properties: ReadonlyMap<string, Value>;
  /** Each set link by name, and the place it leads to; an unset link has no entry. */
  readonly links: ReadonlyMap<string, InstanceId>;
  readonly wakes: readonly PendingWake[];
  /** Per actor, only what was written; a missing entry reads as the declared default. */
  readonly memory: ReadonlyMap<InstanceId, ReadonlyMap<string, Value>>;
  /** When it last ticked, in host seconds; null if it never has, and always for what is not a place. */
  readonly lastTick: number | null;
}

/** One person in this world, stable across visits. */
export interface VisitorRecord {
  readonly visit: VisitKey;
  readonly nickname: string;
  readonly instance: InstanceId;
  /** Where they last stood; null before they have stood anywhere. */
  readonly lastPlace: InstanceId | null;
}

export interface WorldState {
  readonly world: InstanceId;
  /** The last serial issued; 0 before the first. */
  readonly serial: number;
  /** Everything whose kind the bundle declares, decoded. */
  readonly instances: ReadonlyMap<InstanceId, Instance>;
  /**
   * Everything kept untouched and saved back verbatim: an object absent
   * from source or of an absent kind, a spawn of a kind no longer
   * declared, and, in a loaded world that admits no one for want of
   * them, the world without its kind and visitors without theirs.
   */
  readonly dormant: ReadonlyMap<InstanceId, StoredInstance>;
  readonly visitors: ReadonlyMap<VisitKey, VisitorRecord>;
  /** What each container holds among `instances`, in contents order. Derived, never stored. */
  readonly children: ReadonlyMap<InstanceId, readonly InstanceId[]>;
}

/** What a turn reads state through: the committed state for a poll, a draft for a write turn. */
export interface StateReader {
  readonly world: InstanceId;
  instance(id: InstanceId): Instance | undefined;
  /** What `id` holds among decoded instances, in contents order. */
  children(id: InstanceId): readonly InstanceId[];
  visitor(visit: VisitKey): VisitorRecord | undefined;
}

/** A reader of committed state. */
export function readerOf(state: WorldState): StateReader {
  return {
    world: state.world,
    instance: (id) => state.instances.get(id),
    children: (id) => state.children.get(id) ?? [],
    visitor: (visit) => state.visitors.get(visit),
  };
}

/** An instance at its kind's defaults (the spec's Properties › Declaring a property), with no links, wakes, memory or tick. */
export function newInstance(
  id: InstanceId,
  made: Made,
  kind: KindRef,
  container: InstanceId | null,
  arrival: number | null,
  caps: StaticCaps,
): Instance {
  const properties = new Map<string, Value>();
  for (const property of kind.properties.values()) {
    if (!property.remembered) properties.set(property.name, defaultOf(property, caps));
  }
  return {
    id,
    made,
    kind,
    container,
    arrival,
    properties,
    links: new Map(),
    wakes: [],
    memory: new Map(),
    lastTick: null,
  };
}

/**
 * Whether `a` comes before `b` in their container: a declared object
 * still where it was declared before anything that arrived, and among
 * those by `rank`; what arrived by arrival. Ties, which well-formed state
 * never has, fall to the id so the order is total.
 */
export function contentsOrder(
  rank: (id: InstanceId) => number,
): (a: Instance, b: Instance) => number {
  return (a, b) => {
    if (a.arrival === null && b.arrival !== null) return -1;
    if (a.arrival !== null && b.arrival === null) return 1;
    const by =
      a.arrival === null || b.arrival === null ? rank(a.id) - rank(b.id) : a.arrival - b.arrival;
    if (by !== 0) return by;
    return codeUnitOrder(a.id, b.id);
  };
}

/** Strings in code-unit order, which is the same on every host: how stored state is sorted. */
export function codeUnitOrder(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** What each container holds among `instances`, in contents order under `rank`. */
export function childrenOf(
  instances: Iterable<Instance>,
  rank: (id: InstanceId) => number,
): Map<InstanceId, readonly InstanceId[]> {
  const held = new Map<InstanceId, Instance[]>();
  for (const instance of instances) {
    if (instance.container === null) continue;
    const siblings = held.get(instance.container);
    if (siblings === undefined) held.set(instance.container, [instance]);
    else siblings.push(instance);
  }
  const order = contentsOrder(rank);
  return new Map(
    [...held].map(([container, siblings]) => [
      container,
      siblings.sort(order).map((instance) => instance.id),
    ]),
  );
}
