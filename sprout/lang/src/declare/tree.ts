// The containment tree as declared, and how a name is resolved in it
// (the spec's The world model; Names › Identifiers and scope; Verbs ›
// Places inside places). The world is the root, named by the manifest's
// name, and the tree is the parse tree: an object is a node under the
// one whose body it is written in, or under the world where it is
// written in the world's, one whose kind is absent included, since what
// it holds still has somewhere to be. What a kind's body holds is a node
// under each instance of the kind, one declaration placed many times.
//
// A name resolves nearest first, walking outward one container at a time
// to the world (`resolveFrom`), so an object that hides one of its name
// further out is warned about once the tree is whole; a first step read
// from the world's body, as `visitors arrive at` is, names something
// directly in the world. Both walks are loops rather than recursion.

import type { Ident, ObjectDeclaration, ObjectPath } from '../syntax/ast.js';
import { onceEach, type Diagnostics, type Sayer } from '../source/diagnostics.js';
import { readable } from '../source/words.js';
import { nearestOption } from './enums.js';
import type { KindRef } from './kinds.js';

/** Names from the world down, outermost first. The world is the empty path. */
export type TreePath = readonly string[];

/**
 * What `placeObjects` places: a declaration, what holds it, and its kind
 * where it composed. Each is one object, and is placed by its identity:
 * a kind's content is one declaration placed once in every instance.
 */
export interface Placeable {
  readonly declaration: ObjectDeclaration;
  /** What holds it; null where that is the world. */
  readonly within: Placeable | null;
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
  /** The same, by what was placed. */
  readonly placements: ReadonlyMap<Placeable, Placement>;
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

export interface TreeContext {
  /** The world's name: the root, and the one name no object may take. */
  readonly world: string;
  readonly diagnostics: Diagnostics;
}

/** The words for `name` written in the body of `holder`, which holds nothing. */
export function holdsNothing(holder: string, name: string): { message: string; remedy: string } {
  return {
    message: `\`${holder}\` holds nothing, so \`${name}\` cannot be in it.`,
    remedy: `Move \`${name}\` out of \`${holder}\`'s braces into something that holds things, or let \`${holder}\` hold things by writing \`contains\` in its body.`,
  };
}

/**
 * Place every object under what holds it, or under the world, shallowest
 * first and in the order listed within a depth, which is the order
 * `placed` keeps. `objects` lists each after what holds it. What fails to
 * place is said once, at its name, and nothing more is said about what it
 * holds, which has nowhere to be; what is said at one declaration twice,
 * as a kind's content in two instances can be, is said once.
 */
export function placeObjects(objects: readonly Placeable[], context: TreeContext): ObjectTree {
  const { world } = context;
  const diagnostics = onceEach(context.diagnostics);
  const placed = new Map<string, Placement>();
  const placements = new Map<Placeable, Placement>();
  const worldHolds = new Map<string, Placement>();
  const tree: ObjectTree = { world, holds: worldHolds, placed, placements };
  /** Every placed node's contents, writable while placing. */
  const writable = new Map<Placeable, { at: Placement; holds: Map<string, Placement> }>();

  const depth = new Map<Placeable, number>();
  for (const object of objects) {
    const { within } = object;
    depth.set(object, within === null ? 0 : (depth.get(within) ?? 0) + 1);
  }
  const shallowestFirst = objects
    .map((object, index) => ({ object, index }))
    .sort((a, b) => depth.get(a.object)! - depth.get(b.object)! || a.index - b.index)
    .map(({ object }) => object);

  for (const object of shallowestFirst) {
    const { declaration, within, kind } = object;
    const name = declaration.name.text;
    const holder = within === null ? null : writable.get(within);
    // Inside something that did not place, whose own refusal was said.
    if (holder === undefined) continue;
    if (name === world) {
      diagnostics.refuse(
        declaration.name.at,
        `\`${world}\` is the world's name, so no object can take it.`,
        'Give the object another name.',
      );
      continue;
    }
    if (holder !== null && holder.at.kind !== null && !holder.at.kind.contains) {
      const words = holdsNothing(holder.at.path.at(-1)!, name);
      diagnostics.refuse(declaration.name.at, words.message, words.remedy);
      continue;
    }
    const siblings = holder === null ? worldHolds : holder.holds;
    if (siblings.has(name)) {
      diagnostics.refuse(
        declaration.name.at,
        `\`${holder === null ? world : pathKey(holder.at.path)}\` holds two objects called \`${name}\`.`,
        'Give one of them another name, or remove it.',
      );
      continue;
    }
    const container = holder === null ? [] : holder.at.path;
    const holds = new Map<string, Placement>();
    const placement: Placement = {
      path: [...container, name],
      container,
      declaration,
      kind,
      holds,
    };
    writable.set(object, { at: placement, holds });
    siblings.set(name, placement);
    placed.set(pathKey(placement.path), placement);
    placements.set(object, placement);
  }

  warnHidden(tree, diagnostics);
  return tree;
}

/**
 * Warn at each placed object that hides one of its name held further out
 * (the spec's Identifiers and scope): by the container around its own, or
 * any beyond that out to the world. Only the nearest one hidden is named,
 * since it is the one the name meant there before.
 */
function warnHidden(tree: ObjectTree, diagnostics: Sayer): void {
  for (const inner of tree.placed.values()) {
    const name = inner.declaration.name.text;
    const rings = ringsTo(tree, inner.container);
    // The last ring is the container's own, where two of one name are refused.
    let hidden: Placement | undefined;
    for (let ring = rings.length - 2; ring >= 0 && hidden === undefined; ring--) {
      hidden = rings[ring]!.get(name);
    }
    if (hidden === undefined) continue;
    const inside = pathKey(inner.container);
    const outer = pathKey(hidden.path);
    if (hidden.container.length === 0) {
      diagnostics.warn(
        inner.declaration.name.at,
        `\`${name}\` hides the \`${name}\` directly in the world: inside \`${inside}\`, a bare \`${name}\` now means this one.`,
        `No path reaches the world's \`${name}\` from inside \`${inside}\`, since the world's name is never a step of one. Give one of them another name if both are meant there.`,
      );
    } else {
      diagnostics.warn(
        inner.declaration.name.at,
        `\`${name}\` hides \`${outer}\`: inside \`${inside}\`, a bare \`${name}\` now means this one.`,
        `Write \`${outer}\` where the outer one is meant, or give this one another name.`,
      );
    }
  }
}

/** What to say about a path, and the step it is said at. */
export interface PathWords {
  readonly step: Ident;
  readonly message: string;
  readonly remedy: string;
}

/**
 * The world's name as a step of a longer path in `visitors arrive at`,
 * which is refused: the world is never a step of a path. Null where the
 * path does not name it so.
 */
export function worldInPath(world: string, path: ObjectPath): PathWords | null {
  const { parts } = path;
  const inside = parts.length > 1 ? parts.find((part) => part.text === world) : undefined;
  if (inside === undefined) return null;
  const rest = parts.filter((part) => part.text !== world).map((part) => part.text);
  return {
    step: inside,
    message: `\`${world}\` is the world, which is named on its own and never as a step of a path.`,
    remedy:
      rest.length === 0
        ? 'Name a place in the world, as in `visitors arrive at kiln`.'
        : `A path starts from something directly in the world: write \`visitors arrive at ${rest.join('.')}\`.`,
  };
}

/**
 * The words for a step of `visitors arrive at`, read from the world's
 * body, that names nothing in reach, with where it may be meant: a name
 * close to it, or an object of that name deeper in the tree, whose path
 * is what to write.
 */
export function unknownStep(
  tree: ObjectTree,
  path: ObjectPath,
  miss: { readonly step: number; readonly within: TreePath | null },
): PathWords {
  const steps = path.parts.map((part) => part.text);
  const step = path.parts[miss.step]!;
  const within = miss.within;
  const reach = within === null ? inReach(tree, []) : contentsOf(tree, within);
  const meant = nearestOption(step.text, reach);
  const where = within === null ? 'here' : `in \`${pathKey(within)}\``;
  const message = `Nothing ${where} is called \`${step.text}\`.${meant === null ? '' : ` Did you mean \`${meant}\`?`}`;

  const rest = steps.slice(miss.step + 1);
  const elsewhere = [...tree.placed.values()].filter((one) => one.path.at(-1) === step.text);
  const written = (at: TreePath): string => `\`visitors arrive at ${[...at, ...rest].join('.')}\``;
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
  return { step, message, remedy };
}
