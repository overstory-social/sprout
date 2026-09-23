// What of a world's state is in the tree this turn (the spec's The world
// model › Range; The compiler › What absent means). An instance is live
// when it is decoded and so is every container from it out to the
// world: an object of an absent kind is not in range and not listed, and
// what it holds is unreachable until the kind returns, decoded or not. A
// visitor who is away has no container and is live nowhere.
//
// The world is always live: it is the root, whether or not the bundle
// carries a kind to decode it against. The climb is a loop, never
// recursion, since nesting has no cap, and it stops at a container it has
// already passed, so stored state that closes a ring is simply not live.

import type { InstanceId } from './ids.js';
import type { LiveTree } from './range.js';
import type { StateReader } from './state.js';

/** Whether `id` is in the tree: decoded, with every container out to the world decoded. */
export function isLive(reader: StateReader, id: InstanceId): boolean {
  const climbed = new Set<InstanceId>();
  let at = id;
  while (at !== reader.world) {
    const instance = reader.instance(at);
    if (instance === undefined || instance.container === null || climbed.has(at)) return false;
    climbed.add(at);
    at = instance.container;
  }
  return true;
}

/** The state's containment tree as range walks it: only what is live holds or is held. */
export function liveTree(reader: StateReader): LiveTree<InstanceId> {
  return {
    contents: (node) => (isLive(reader, node) ? reader.children(node) : []),
    containerOf: (node) =>
      isLive(reader, node) ? (reader.instance(node)?.container ?? null) : null,
  };
}
