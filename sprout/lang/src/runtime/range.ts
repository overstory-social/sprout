// What an object can reach (the spec's The world model › Range): what it
// may `get`, `send` to and walk with `each`, what a command's nouns
// resolve against, and the walk a broadcast makes (Events, messages and
// the bus › Sending). The tree and the pass rules are the caller's, so
// the walk reads a `LiveTree` and asks a `PassRule`; every node it
// reaches is one step of the turn's budget (Limits › Runtime budgets).
//
// Two invariants. The asker always reaches itself, its own contents and
// the surface of every container out to the first that refuses, whatever
// that one's rule says, because a lid stops others looking in, not the
// chest looking down, and a wall is still a thing to name. And the walk
// is a loop over a queue, never recursion, since nesting has no cap.

import type { Budget } from './budget.js';
import type { DeclaredMessage } from '../declare/messages.js';

/**
 * What is asked of a container: one message, which `pass :m` answers
 * where written and `pass any` otherwise, or `any`, for `get`, `each` and
 * a command's nouns.
 */
export type Asking = 'any' | DeclaredMessage;

/** The containment tree as it stands this turn. B16's state model is one. */
export interface LiveTree<Id> {
  /** What a node holds, in the container's order, leaving out anything absent. */
  contents(node: Id): readonly Id[];
  /** What holds a node: null for the world, and for a visitor who is away. */
  containerOf(node: Id): Id | null;
}

/**
 * Whether a container lets `asking` through to what it holds: the
 * container's policy, never the item's. B32 evaluates written rules;
 * unwritten ones relay, except the world's, which refuses.
 */
export type PassRule<Id> = (container: Id, asking: Asking) => boolean;

/** What a walk reads: the tree, the pass rules, and the turn's meter it is charged to. */
export interface RangeContext<Id> {
  readonly tree: LiveTree<Id>;
  readonly passes: PassRule<Id>;
  readonly budget: Budget;
}

/**
 * How a node came into range: the asker itself, one of its own contents,
 * a container outward that refuses, seen from inside only as a surface,
 * or through a rule that passed. `self` and `surface` are what a
 * broadcast leaves out.
 */
export type Via = 'self' | 'held' | 'surface' | 'passed';

export interface Reached<Id> {
  readonly node: Id;
  readonly via: Via;
}

/** One walk's answer. */
export interface RangeWalk<Id> {
  /** Everything in range, nearest first, each once. */
  readonly reached: readonly Reached<Id>[];
  /** The same nodes, for asking whether one is in range. */
  readonly within: ReadonlySet<Id>;
  /** Every container the walk asked that refused, in the order asked: why a branch stopped. */
  readonly walls: readonly Id[];
}

/**
 * Everything in range of `asker` for `asking`, nearest first: itself, its
 * own contents breadth-first, then each container outward, followed by
 * its other contents breadth-first, until one refuses, which is reached
 * as a surface and is the last. A container that holds something is
 * crossed into only if it passes, and each rule is asked at most once.
 */
export function rangeOf<Id>(context: RangeContext<Id>, asker: Id, asking: Asking): RangeWalk<Id> {
  const { tree, passes, budget } = context;
  const reached: Reached<Id>[] = [];
  const within = new Set<Id>();
  const walls: Id[] = [];

  const reach = (node: Id, via: Via): void => {
    budget.spend();
    within.add(node);
    reached.push({ node, via });
  };

  /** Cross inward from every node in `frontier`, breadth-first; `frontier` grows as it is read. */
  const sweep = (frontier: Id[]): void => {
    for (let head = 0; head < frontier.length; head++) {
      const node = frontier[head]!;
      const held = tree.contents(node);
      if (held.length === 0) continue;
      if (!passes(node, asking)) {
        walls.push(node);
        continue;
      }
      for (const item of held) {
        reach(item, 'passed');
        frontier.push(item);
      }
    }
  };

  reach(asker, 'self');
  const own = [...tree.contents(asker)];
  for (const item of own) reach(item, 'held');
  sweep(own);

  let inner = asker;
  let outer = tree.containerOf(asker);
  while (outer !== null) {
    const open = passes(outer, asking);
    if (!open) {
      reach(outer, 'surface');
      walls.push(outer);
      break;
    }
    reach(outer, 'passed');
    const ring = tree.contents(outer).filter((item) => item !== inner);
    for (const item of ring) reach(item, 'passed');
    sweep(ring);
    inner = outer;
    outer = tree.containerOf(outer);
  }

  return { reached, within, walls };
}

/**
 * Whether `target` is in range of `asker`, by the path between them
 * alone: every node strictly between must pass. One step per node
 * climbed, and each rule on the path asked in the order `rangeOf` would
 * ask it.
 */
export function reaches<Id>(
  context: RangeContext<Id>,
  asker: Id,
  target: Id,
  asking: Asking,
): boolean {
  const { tree, passes, budget } = context;

  // The asker and its ancestors, itself at 0 and its container at 1.
  const chain: Id[] = [];
  const depth = new Map<Id, number>();
  for (let node: Id | null = asker; node !== null; node = tree.containerOf(node)) {
    budget.spend();
    depth.set(node, chain.length);
    chain.push(node);
  }

  // The target and its ancestors up to where they meet the asker's chain.
  const below: Id[] = [];
  let node: Id | null = target;
  while (node !== null && !depth.has(node)) {
    budget.spend();
    below.push(node);
    node = tree.containerOf(node);
  }
  if (node === null) return false;
  const meet = depth.get(node)!;

  if (below.length === 0) {
    // The target is the asker or one of its ancestors, reached as a
    // surface if nothing between refuses: every container from the
    // asker's own out to the one inside the target must pass.
    for (let at = 1; at < meet; at++) if (!passes(chain[at]!, asking)) return false;
    return true;
  }

  // Outward from the asker's own container to where the paths meet, which
  // is strictly between them, then inward from there, leaving out the
  // target itself. At the asker (meet 0), the first step inward is the
  // asker's own contents, whose rule is never asked.
  for (let at = 1; at <= meet; at++) if (!passes(chain[at]!, asking)) return false;
  for (let at = below.length - 1; at >= 1; at--) if (!passes(below[at]!, asking)) return false;
  return true;
}
