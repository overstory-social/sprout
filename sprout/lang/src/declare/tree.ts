// The containment tree as declared, and how a name is resolved in it
// (the spec's The world model; Names › Identifiers and scope; Verbs ›
// Places inside places). The world is the root, named by the manifest's
// name, and every object declaration is a node under it, one whose kind
// is absent included: what it holds still has somewhere to be.
//
// Two rules hold here. What a file writes at its top level, an object's
// `in`, is read from inside the world: a first step names something
// directly in the world, or the world itself, and anything deeper is
// named by its path. And from anywhere else the nearest declaration
// wins, walking outward one container at a time to the world
// (`resolveFrom`). Both are loops rather than recursion, since nesting
// has no cap.

import type { Ident, ObjectDeclaration, ObjectPath } from '../syntax/ast.js';
import type { Diagnostics } from '../source/diagnostics.js';
import { readable } from '../syntax/parse/parser.js';
import { nearestOption } from './enums.js';
import type { KindRef } from './kinds.js';

/** Names from the world down, outermost first. The world is the empty path. */
export type TreePath = readonly string[];

/** What `placeObjects` places: a declaration, and its kind where it composed. */
export interface Placeable {
  readonly declaration: ObjectDeclaration;
  /** Null for an object whose kind is absent. */
  readonly kind: KindRef | null;
}

/** One object where it sits. */
export interface Placement {
  /** Its own path, itself last. */
  readonly path: TreePath;
  /** Its container's path. */
  readonly container: TreePath;
  readonly declaration: ObjectDeclaration;
  readonly kind: KindRef | null;
  /** What it holds, by name, in the order declared. */
  readonly holds: ReadonlyMap<string, Placement>;
}

/** The tree: the world at its root, and every object that was placed. */
export interface ObjectTree {
  /** The world's name, which is the root's. */
  readonly world: string;
  /** What the world holds, by name, in the order declared. */
  readonly holds: ReadonlyMap<string, Placement>;
  /** Every placed object, by `pathKey` of its path. */
  readonly placed: ReadonlyMap<string, Placement>;
}

/** What a path resolves to from somewhere in the tree. */
export type Resolution =
  | { readonly found: 'object'; readonly placement: Placement }
  | { readonly found: 'world' }
  /**
   * Nothing answers at `step`. `within` is the node whose contents were
   * searched, or null where the first step was searched for outward.
   */
  | { readonly found: 'missing'; readonly step: number; readonly within: TreePath | null }
  /** The world's name, as the first step of a longer path. */
  | { readonly found: 'world-inside'; readonly step: number };

/** The key a node is held under in `placed`: `kiln.shelf`. */
export function pathKey(path: TreePath): string {
  return path.join('.');
}

/**
 * What each node from the world down to `vantage` holds, the world's
 * first, as far down as the vantage is placed.
 */
function ringsTo(tree: ObjectTree, vantage: TreePath): ReadonlyMap<string, Placement>[] {
  const rings = [tree.holds];
  let holds = tree.holds;
  for (const name of vantage) {
    const next = holds.get(name);
    if (next === undefined) break;
    holds = next.holds;
    rings.push(holds);
  }
  return rings;
}

/** What a node holds, by name, in the order declared; nothing for a path not placed. */
export function contentsOf(tree: ObjectTree, path: TreePath): string[] {
  const rings = ringsTo(tree, path);
  return rings.length === path.length + 1 ? [...rings.at(-1)!.keys()] : [];
}

/**
 * The names a first step can reach from `vantage`, nearest first: its
 * own contents, then each container's outward to the world's, then the
 * world's own name. A nearer name hides an outer one.
 */
export function inReach(tree: ObjectTree, vantage: TreePath): string[] {
  const names = new Set<string>();
  for (const holds of ringsTo(tree, vantage).reverse()) {
    for (const name of holds.keys()) names.add(name);
  }
  names.add(tree.world);
  return [...names];
}

/**
 * Resolve `path` from inside `vantage`, the nearest declaration winning
 * (the spec's Identifiers and scope). The first step is looked for in
 * the vantage's contents, then its container's, which hold the vantage
 * itself, outward to the world's and then the world's name; each step
 * after it among the contents of what the one before reached.
 */
export function resolveFrom(tree: ObjectTree, vantage: TreePath, path: TreePath): Resolution {
  const first = path[0];
  if (first === undefined) return { found: 'missing', step: 0, within: null };
  const rings = ringsTo(tree, vantage);
  let reached: Placement | undefined;
  for (let ring = rings.length - 1; ring >= 0 && reached === undefined; ring--) {
    reached = rings[ring]!.get(first);
  }
  if (reached === undefined) {
    if (first !== tree.world) return { found: 'missing', step: 0, within: null };
    return path.length === 1 ? { found: 'world' } : { found: 'world-inside', step: 0 };
  }
  for (let step = 1; step < path.length; step++) {
    const next: Placement | undefined = reached.holds.get(path[step]!);
    if (next === undefined) return { found: 'missing', step, within: reached.path };
    reached = next;
  }
  return { found: 'object', placement: reached };
}

/**
 * Told of a container step nothing in reach answers to, with the words
 * to say. A compile makes it a gap under the absent table's `container`
 * row; with none it is refused.
 */
export type OnUnknownContainer = (
  container: ObjectPath,
  step: Ident,
  message: string,
  remedy: string,
) => void;

export interface TreeContext {
  /** The world's name: the root, and the one name no object may take. */
  readonly world: string;
  readonly diagnostics: Diagnostics;
  readonly onUnknown?: OnUnknownContainer;
}

/** An object whose container did not resolve, and where its path stopped. */
interface Miss {
  readonly index: number;
  readonly step: number;
  readonly within: TreePath | null;
}

/**
 * Place every object under the world, reading each `in` from inside the
 * world. `in <world>` places at depth one and a path of k steps at depth
 * k + 1, so placing in order of path length, in the order declared
 * within each, finds every container already placed or already failed.
 * What fails to place is said once, at the step it is about, and nothing
 * more is said about what it holds.
 */
export function placeObjects(objects: readonly Placeable[], context: TreeContext): ObjectTree {
  const { world, diagnostics } = context;
  const placed = new Map<string, Placement>();
  const worldHolds = new Map<string, Placement>();
  const tree: ObjectTree = { world, holds: worldHolds, placed };
  /** Every node's contents, writable while placing; the world's is `worldHolds`. */
  const writable = new Map<Placement, Map<string, Placement>>();

  // --- what one declaration gets wrong on its own ------------------------
  const pending: { index: number; depth: number }[] = [];
  objects.forEach(({ declaration }, index) => {
    const parts = declaration.container.parts;
    if (declaration.name.text === world) {
      diagnostics.refuse(
        declaration.name.at,
        `\`${world}\` is the world's name, so no object can take it.`,
        'Give the object another name.',
      );
      return;
    }
    const inside = parts.length > 1 ? parts.find((part) => part.text === world) : undefined;
    if (inside !== undefined) {
      const rest = parts.filter((part) => part.text !== world).map((part) => part.text);
      diagnostics.refuse(
        inside.at,
        `\`${world}\` is the world, which is named on its own and never as a step of a path.`,
        rest.length === 0
          ? `Write \`in ${world}\`.`
          : `A path starts from something directly in the world: write \`in ${rest.join('.')}\`.`,
      );
      return;
    }
    const depth = parts.length === 1 && parts[0]!.text === world ? 0 : parts.length;
    pending.push({ index, depth });
  });
  pending.sort((a, b) => a.depth - b.depth);

  // --- placing, shallowest first ------------------------------------------
  const isPlaced = new Set<number>();
  const misses: Miss[] = [];
  for (const { index, depth } of pending) {
    const { declaration, kind } = objects[index]!;
    const name = declaration.name.text;
    let holder: Placement | null = null;
    if (depth > 0) {
      const steps = declaration.container.parts.map((part) => part.text);
      const found = resolveFrom(tree, [], steps);
      if (found.found === 'missing') {
        misses.push({ index, step: found.step, within: found.within });
        continue;
      }
      if (found.found !== 'object') continue;
      holder = found.placement;
      if (holder.kind !== null && !holder.kind.contains) {
        const last = holder.path.at(-1)!;
        diagnostics.refuse(
          declaration.container.parts.at(-1)!.at,
          `\`${last}\` holds nothing, so \`${name}\` cannot be in it.`,
          `Put \`${name}\` in something that holds things, or let \`${last}\` hold things by writing \`contains\` in its body.`,
        );
        continue;
      }
    }
    const siblings = holder === null ? worldHolds : writable.get(holder)!;
    if (siblings.has(name)) {
      diagnostics.refuse(
        declaration.name.at,
        `\`${holder === null ? world : pathKey(holder.path)}\` holds two objects called \`${name}\`.`,
        'Give one of them another name, or remove it.',
      );
      continue;
    }
    const container = holder === null ? [] : holder.path;
    const holds = new Map<string, Placement>();
    const placement: Placement = {
      path: [...container, name],
      container,
      declaration,
      kind,
      holds,
    };
    writable.set(placement, holds);
    siblings.set(name, placement);
    placed.set(pathKey(placement.path), placement);
    isPlaced.add(index);
  }

  // --- what did not place, and why ----------------------------------------
  // A step naming an object that did not place either is inside something
  // that failed, which has been said, or it is a ring of such steps. Each
  // step leads to the first unplaced declaration of its name.
  const unplaced = new Map<string, number>();
  objects.forEach(({ declaration }, index) => {
    const name = declaration.name.text;
    if (!isPlaced.has(index) && !unplaced.has(name)) unplaced.set(name, index);
  });
  misses.sort((a, b) => a.index - b.index);
  const missed = new Map(misses.map((miss) => [miss.index, miss]));
  const stepOf = (miss: Miss): Ident =>
    objects[miss.index]!.declaration.container.parts[miss.step]!;
  const leadsTo = (index: number): number | undefined => {
    const miss = missed.get(index);
    return miss === undefined ? undefined : unplaced.get(stepOf(miss).text);
  };

  for (const miss of misses) {
    if (leadsTo(miss.index) !== undefined) continue;
    unknownStep(tree, objects[miss.index]!.declaration.container, miss, context);
  }

  // Each declaration leads to at most one other, so a ring is found by
  // walking until the walk meets itself.
  const walked = new Map<number, 'walking' | 'done'>();
  for (const miss of misses) {
    const trail: number[] = [];
    let at: number | undefined = miss.index;
    while (at !== undefined && !walked.has(at)) {
      walked.set(at, 'walking');
      trail.push(at);
      at = leadsTo(at);
    }
    if (at !== undefined && walked.get(at) === 'walking') {
      const ring = trail.slice(trail.indexOf(at));
      const start = ring.indexOf(ring.reduce((first, index) => Math.min(first, index)));
      const ordered = [...ring.slice(start), ...ring.slice(0, start)];
      const names = ordered.map((index) => `\`${objects[index]!.declaration.name.text}\``);
      diagnostics.refuse(
        stepOf(missed.get(ordered[0]!)!).at,
        ordered.length === 1
          ? `${names[0]} cannot be inside itself.`
          : `${names[0]} is in ${names.slice(1).join(', which is in ')}, which is in ${names[0]}.`,
        ordered.length === 1
          ? `\`in\` names what holds ${names[0]}: name something else.`
          : 'Something cannot hold what holds it. Put one of them somewhere else.',
      );
    }
    for (const index of trail) walked.set(index, 'done');
  }

  return tree;
}

/** Say that a step of a container's path names nothing in reach, with where it may be meant. */
function unknownStep(
  tree: ObjectTree,
  container: ObjectPath,
  miss: Miss,
  context: TreeContext,
): void {
  const steps = container.parts.map((part) => part.text);
  const step = container.parts[miss.step]!;
  const within = miss.within;
  const reach = within === null ? inReach(tree, []) : contentsOf(tree, within);
  const meant = nearestOption(step.text, reach);
  const where = within === null ? 'here' : `in \`${pathKey(within)}\``;
  const message = `Nothing ${where} is called \`${step.text}\`.${meant === null ? '' : ` Did you mean \`${meant}\`?`}`;

  // An object of that name deeper in the tree is most likely what was
  // meant, and its path is what to write.
  const rest = steps.slice(miss.step + 1);
  const elsewhere = [...tree.placed.values()].filter((one) => one.path.at(-1) === step.text);
  const written = (path: TreePath): string => `\`in ${[...path, ...rest].join('.')}\``;
  let remedy: string;
  if (elsewhere.length === 1) {
    const [only] = elsewhere as [Placement];
    remedy =
      only.container.length === 0
        ? `\`${step.text}\` is directly in the world, so write ${written(only.path)}.`
        : `\`${step.text}\` is inside \`${pathKey(only.container)}\`, so write ${written(only.path)}.`;
  } else if (elsewhere.length > 1) {
    const all = elsewhere.map((one) => written(one.path));
    remedy = `There is a \`${step.text}\` in more than one place; write the one you mean: ${all.slice(0, -1).join(', ')} or ${all.at(-1)}.`;
  } else if (meant !== null) {
    remedy = `Write ${written([...steps.slice(0, miss.step), meant])}, or declare an object called \`${step.text}\`.`;
  } else if (within === null) {
    remedy =
      'Name something directly in the world, or something deeper by its path, as in `kiln.shelf`.';
  } else {
    remedy = `\`${pathKey(within)}\` holds ${readable(reach)}.`;
  }

  if (context.onUnknown !== undefined) context.onUnknown(container, step, message, remedy);
  else context.diagnostics.refuse(step.at, message, remedy);
}
