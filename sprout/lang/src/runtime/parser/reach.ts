// What a visitor may name (the spec's Range; Range › Sight; Parsing ›
// Choosing a reading): every live thing the range walk reaches but the
// world, nearest first, each with its nearness and whether the one typing
// carries it. In the dark a visitor names only themselves and what they
// carry. Every object the walk visits is a step.

import type { InstanceId } from '../ids.js';
import { liveTree } from '../live.js';
import { carriedIn, rangeOf, type LiveTree, type Reached } from '../range.js';
import type { StateReader } from '../state.js';
import { inTheDark } from '../darkness.js';
import type { CommandContext } from '../parser.js';
import { addressOf, type AddressContext } from './address.js';
import type { Candidate } from './nouns.js';

/** What `actor` may name, as the turn `context` finds the world. */
export function reachOf(actor: InstanceId, context: CommandContext): Candidate[] {
  const { state, budget } = context;
  const addressing: AddressContext = { world: state.world, nicknames: context.nicknames };
  const tree = liveTree(state);
  const range = rangeOf({ tree, passes: context.passes, budget }, actor, 'any');
  const reached = candidatesOf(state, tree, actor, range.reached, addressing);
  return inTheDark(actor, context)
    ? reached.filter((one) => one.carried || one.instance.id === actor)
    : reached;
}

/**
 * What may be named among what the walk reached, nearest first: every
 * live thing but the world, each with its nearness (`nearnessOf`) and
 * whether `actor` carries it.
 */
function candidatesOf(
  state: StateReader,
  tree: LiveTree<InstanceId>,
  actor: InstanceId,
  reached: readonly Reached<InstanceId>[],
  addressing: AddressContext,
): Candidate[] {
  const near = nearnessOf(tree, reached, state.instance(actor)!.container!);
  const carried = carriedIn(tree, actor, reached);
  return reached.flatMap(({ node }) => {
    const instance = node === state.world ? undefined : state.instance(node);
    if (instance === undefined) return [];
    const address = addressOf(instance, addressing);
    return [{ instance, address, near: near.get(node)!, carried: carried.has(node) }];
  });
}

/**
 * How near each thing reached is, as the spec's Range counts it: first by
 * the ring it is in, how far out the container is that it is reached
 * through, then by how deep inside that container it lies. Two things
 * are equally near only where both agree. The actor's own place is further
 * than everything it holds and nearer than the ring beyond it (Parsing ›
 * Choosing a reading), so a place answers to its name only where nothing
 * in it answers as well.
 */
function nearnessOf(
  tree: LiveTree<InstanceId>,
  reached: readonly Reached<InstanceId>[],
  place: InstanceId,
): Map<InstanceId, number> {
  const where = new Map<InstanceId, { ring: number; depth: number }>();
  // The last of the asker and its containers outward that the walk reached.
  let outer: InstanceId | null = null;
  for (const { node, via } of reached) {
    let here: { ring: number; depth: number };
    if (via === 'self') {
      here = { ring: 0, depth: 0 };
      outer = node;
    } else if (outer !== null && node === tree.containerOf(outer)) {
      here = { ring: where.get(outer)!.ring + 1, depth: 0 };
      outer = node;
    } else {
      const inside = where.get(tree.containerOf(node)!);
      if (inside === undefined) throw new Error(`\`${node}\` was reached before what holds it.`);
      here = { ring: inside.ring, depth: inside.depth + 1 };
    }
    where.set(node, here);
  }
  const own = where.get(place);
  if (own !== undefined) where.set(place, { ring: own.ring, depth: Infinity });
  const ordered = [...where].sort(([, a], [, b]) => a.ring - b.ring || a.depth - b.depth);
  const rank = new Map<InstanceId, number>();
  let at = -1;
  let last: { ring: number; depth: number } | null = null;
  for (const [node, here] of ordered) {
    if (last === null || here.ring !== last.ring || here.depth !== last.depth) at++;
    last = here;
    rank.set(node, at);
  }
  return rank;
}
