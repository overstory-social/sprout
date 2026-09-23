// What one bundle says about the instances a world may hold (the spec's
// The runtime › State): every declared object by its id, what the world
// and a visitor are made of, the kinds a spawn may name, where visitors
// arrive, and the host's caps that stored values are read under. Built
// once per load, and read by every rule that reconciles stored state
// with source.
//
// Every placement in the declared tree is here, one whose kind is absent
// included, so that what it holds keeps its declared container and its
// rank. A declared object's rank is its position in one walk of the
// tree, which keeps siblings in the order they were declared.

import type { Bundle } from '../bundle/bundle.js';
import type { StaticCaps } from '../bundle/limits.js';
import { kindName, type KindRef } from '../declare/kinds.js';
import { WORLD } from '../declare/sprout-world.js';
import type { Placement, TreePath } from '../declare/tree.js';
import { declaredId, type InstanceId } from './ids.js';

/** One object the tree places. */
export interface DeclaredEntry {
  readonly id: InstanceId;
  readonly path: TreePath;
  /** The id of its declared container, the world's for an object declared `in` it. */
  readonly container: InstanceId;
  /** Its composed anonymous kind; null where the kind is absent and the object with it. */
  readonly kind: KindRef | null;
  /** Its position in a walk of the declared tree, so siblings keep their declared order. */
  readonly rank: number;
}

export interface Catalogue {
  /** The world's id, which is its name and the root of the tree. */
  readonly world: InstanceId;
  /** What the world is made of; null in a loaded world that admits no one for want of it. */
  readonly worldKind: KindRef | null;
  /** What a visitor is made of; null in a loaded world that admits no one for want of it. */
  readonly visitorKind: KindRef | null;
  /** Every placement in the declared tree, by id, absent kinds included. */
  readonly declared: ReadonlyMap<InstanceId, DeclaredEntry>;
  /**
   * The kinds a spawn may name, by qualified name: every kind the bundle
   * declares but those composing `sprout.World`, since the world is never
   * spawned (the spec's The world model). A stored spawn of one stays dormant.
   */
  readonly kinds: ReadonlyMap<string, KindRef>;
  /** Where visitors arrive, or null for a world that admits no one. */
  readonly arrival: InstanceId | null;
  /** The host's caps now, which stored values are read under; not the ones the bundle was checked against. */
  readonly caps: StaticCaps;
}

/** What `bundle` says about instances, read under the host's current `caps`. */
export function catalogueOf(bundle: Bundle, caps: StaticCaps): Catalogue {
  const name = bundle.manifest.name;
  const world = declaredId(name, []);
  const declared = new Map<InstanceId, DeclaredEntry>();
  const queue: Placement[] = [...bundle.tree.holds.values()];
  for (let head = 0; head < queue.length; head++) {
    const placement = queue[head]!;
    const id = declaredId(name, placement.path);
    declared.set(id, {
      id,
      path: placement.path,
      container: declaredId(name, placement.container),
      kind: placement.kind,
      rank: head,
    });
    queue.push(...placement.holds.values());
  }
  return {
    world,
    worldKind: bundle.world,
    visitorKind: bundle.visitor,
    declared,
    kinds: new Map(
      bundle.kinds
        .filter((kind) => !kind.composes.has(WORLD))
        .map((kind) => [kindName(kind), kind]),
    ),
    arrival: bundle.arrival === null ? null : declaredId(name, bundle.arrival),
    caps,
  };
}
