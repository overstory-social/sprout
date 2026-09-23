// What an identifier or a dotted path written inside a body names (the
// spec's Names › Identifiers and scope): resolved from where the body is
// written, the nearest declaration winning, the world's name as a first
// step reaching what the world holds from anywhere.
//
// A body is written in one of two places. The world's body and a declared
// object's own body have a place in the tree, and resolve from it. A
// kind's body has none, and nor has the body of an object a kind gives its
// instances: those resolve against what the giving kind's body holds, from
// the content's own place in it outward, and then against what the world's
// body holds, which every instance is inside. What a kind's name reaches
// is a copy, found at run time inside the instance running the body.

import type { KindRef } from './kinds.js';
import { contentAt, type KindContents } from './contents.js';
import { resolveFrom, type ObjectTree, type TreePath } from './tree.js';

/** Where a body is written, which is where its names are resolved from. */
export type Vantage =
  /** The world's body, the empty path, or a declared object's own body. */
  | { readonly in: 'tree'; readonly path: TreePath }
  /** A kind's body, the empty path, or the body of an object it gives, at its path there. */
  | { readonly in: 'kind'; readonly giver: string; readonly path: TreePath };

/** What a name reaches. */
export type Named =
  | { readonly names: 'world' }
  /** A declared object, by its declared path. */
  | { readonly names: 'declared'; readonly path: TreePath; readonly kind: KindRef | null }
  /**
   * The copy of what `giver`'s body writes at `path`, inside the instance
   * that holds the body's `self`, `depth` steps out from it.
   */
  | {
      readonly names: 'given';
      readonly giver: string;
      readonly path: TreePath;
      readonly depth: number;
      readonly kind: KindRef | null;
    };

/** A name resolved, or where it failed. */
export type Naming =
  | Named
  /** Nothing answers at `step`; `within` is what was searched, null where the first step was sought outward. */
  | { readonly names: 'missing'; readonly step: number; readonly within: string | null }
  /** The world's name as a step other than the first. */
  | { readonly names: 'world-inside'; readonly step: number };

/** What resolving a name reads: the tree, what each kind's body gives, and the world's name. */
export interface NameSource {
  readonly tree: ObjectTree;
  readonly contents: KindContents;
}

/** Resolve `parts`, a name or a dotted path, from inside `vantage`. */
export function nameFrom(source: NameSource, vantage: Vantage, parts: readonly string[]): Naming {
  const { tree, contents } = source;
  if (vantage.in === 'kind' && parts[0] !== tree.world) {
    const given = fromContents(contents, vantage, parts);
    if (given !== null) return given;
  }
  const from = vantage.in === 'tree' ? vantage.path : [];
  const resolved = resolveFrom(tree, from, parts);
  switch (resolved.found) {
    case 'object':
      return {
        names: 'declared',
        path: resolved.placement.path,
        kind: resolved.placement.kind,
      };
    case 'world':
      return { names: 'world' };
    case 'world-inside':
      return { names: 'world-inside', step: resolved.step };
    case 'missing':
      return {
        names: 'missing',
        step: resolved.step,
        within:
          resolved.within === null
            ? null
            : resolved.within.length === 0
              ? tree.world
              : resolved.within.join('.'),
      };
  }
}

/**
 * The first step among what `vantage.giver`'s body holds, from the
 * vantage's own place in it outward, and each step after it inside the
 * one before; null where the first step is nothing the kind gives, and
 * missing where a later step is.
 */
function fromContents(
  contents: KindContents,
  vantage: Extract<Vantage, { in: 'kind' }>,
  parts: readonly string[],
): Naming | null {
  const [first, ...rest] = parts;
  if (first === undefined) return null;
  for (let depth = vantage.path.length; depth >= 0; depth--) {
    const at = [...vantage.path.slice(0, depth), first];
    const found = contentAt(contents, vantage.giver, at);
    if (found === null) continue;
    let path = at;
    let here = found;
    for (const [i, step] of rest.entries()) {
      const next = here.holds.find((one) => one.declaration.name.text === step);
      if (next === undefined) {
        return { names: 'missing', step: i + 1, within: path.join('.') };
      }
      path = [...path, step];
      here = next;
    }
    return {
      names: 'given',
      giver: vantage.giver,
      path,
      depth: vantage.path.length,
      kind: here.kind,
    };
  }
  return null;
}

/** The names a first step can reach from `vantage`, nearest first, for a guess at a misspelling. */
export function namesInReach(source: NameSource, vantage: Vantage): string[] {
  const found = new Set<string>();
  if (vantage.in === 'kind') {
    for (let depth = vantage.path.length; depth >= 0; depth--) {
      const holder = vantage.path.slice(0, depth);
      const level =
        holder.length === 0
          ? (source.contents.get(vantage.giver) ?? [])
          : (contentAt(source.contents, vantage.giver, holder)?.holds ?? []);
      for (const one of level) found.add(one.declaration.name.text);
    }
  }
  const from = vantage.in === 'tree' ? vantage.path : [];
  let holds = source.tree.holds;
  const rings = [holds];
  for (const step of from) {
    const next = holds.get(step);
    if (next === undefined) break;
    holds = next.holds;
    rings.push(holds);
  }
  for (const ring of rings.reverse()) for (const name of ring.keys()) found.add(name);
  found.add(source.tree.world);
  return [...found];
}
