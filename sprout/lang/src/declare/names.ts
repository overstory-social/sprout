// What an identifier or a dotted path written inside a body names (the
// spec's Names › Identifiers and scope): the nearest declaration winning,
// the world's name as a first step reaching what the world holds from
// anywhere.
//
// The world's body and a declared object's own body have a place in the
// tree, and resolve from it at compile time. A kind's body has none, and
// nor has the body of an object a kind gives: a name there resolves at run
// time from where the instance running it sits, judged by what each
// container holds then, so a compile says only what each step of the name
// is answered to by, and which declarations it may reach. One it can fix:
// a name the running instance's own body always declares, which is what
// the kind and its closure give, is that copy in every instance.

import type { ObjectDeclaration } from '../syntax/ast.js';
import { kindName, type KindRef } from './kinds.js';
import {
  contentAt,
  everyContent,
  givenBy,
  type KindContent,
  type KindContents,
} from './contents.js';
import { resolveFrom, type ObjectTree, type Placement, type TreePath } from './tree.js';

/** Where a body is written, which is where its names are resolved from. */
export type Vantage =
  /** The world's body, the empty path, or a declared object's own body. */
  | { readonly in: 'tree'; readonly path: TreePath }
  /**
   * A kind's body, the empty path, or the body of an object it gives, at
   * its path there; `self` is what the instance running the body is made of.
   */
  | {
      readonly in: 'kind';
      readonly giver: string;
      readonly path: TreePath;
      readonly self: KindRef;
    };

/** Where one object is written: at a path in the tree, or at a path in a kind's body. */
export type DeclaredAt =
  | { readonly in: 'tree'; readonly path: TreePath }
  | { readonly in: 'kind'; readonly giver: string; readonly path: TreePath };

/** An object written in a kind's body, as `DeclaredAt` says it. */
export type GivenAt = Extract<DeclaredAt, { in: 'kind' }>;

/**
 * One object in the bundle a name's first step may reach, and each step
 * after it that is written in the body of the one before: as many as the
 * name has steps where the path runs its whole length inside it, fewer
 * where it stops.
 */
export interface Candidate {
  readonly steps: readonly DeclaredAt[];
  /** What the last step reached is made of; null where that is absent. */
  readonly kind: KindRef | null;
  /** The last step reached, as written. */
  readonly declaration: ObjectDeclaration;
}

/**
 * One step of a name judged by contents while the world runs: what an
 * instance directly held answers to it by. A declared object or a copy
 * answers by its identifier; a spawned instance, which has none, answers
 * where it is made of what some declaration of the name is made of.
 */
export interface PlacedStep {
  readonly name: string;
  /** For each declaration of `name` in the bundle, the kinds it is made of, by qualified name. */
  readonly madeOf: readonly (readonly string[])[];
}

/** What a name reaches. */
export type Named =
  | { readonly names: 'world' }
  /** A declared object, by its declared path. */
  | { readonly names: 'declared'; readonly path: TreePath; readonly kind: KindRef | null }
  /**
   * A copy the running instance's own body declares, `parts` down from it:
   * by path under a declared instance, and step by step through `steps`
   * inside a spawned one.
   */
  | {
      readonly names: 'own';
      readonly parts: TreePath;
      readonly steps: readonly GivenAt[];
      readonly kind: KindRef | null;
    }
  /**
   * Whatever is nearest the running instance when the body runs: the
   * first step among what the instance holds, or a container outward to
   * the world holds, and each step after among what the one before holds.
   * `candidates` are the declarations it may so reach, for what the
   * compiler can still say of them.
   */
  | {
      readonly names: 'placed';
      readonly steps: readonly PlacedStep[];
      readonly candidates: readonly Candidate[];
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
  /**
   * Whether the file `file` may name `placement` by its first step: one
   * declared in the file itself, or an object written in a file of its
   * own that the file imports (the spec's Identifiers and scope). Every
   * name may be reached from the world's name.
   */
  readonly nameable?: (file: string, placement: Placement) => boolean;
}

/** Resolve `parts`, a name or a dotted path, from inside `vantage`. */
export function nameFrom(source: NameSource, vantage: Vantage, parts: readonly string[]): Naming {
  const { tree } = source;
  if (vantage.in === 'kind' && parts[0] !== tree.world) {
    const inside = parts.slice(1).indexOf(tree.world);
    if (inside >= 0) return { names: 'world-inside', step: inside + 1 };
    return ownNaming(source, vantage, parts) ?? placedNaming(source, parts);
  }
  const resolved = resolveFrom(tree, vantage.in === 'tree' ? vantage.path : [], parts);
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

/** What the body of the instance running a kind's body declares, before anything outward. */
function ownLevel(
  contents: KindContents,
  vantage: Extract<Vantage, { in: 'kind' }>,
): KindContent[] {
  const written =
    vantage.path.length === 0 ? null : contentAt(contents, vantage.giver, vantage.path);
  return [...(written?.holds ?? []), ...givenBy(contents, vantage.self)];
}

/** What a content's copy holds: what its own body writes, then what its kinds give. */
function insideContent(contents: KindContents, content: KindContent): KindContent[] {
  return [...content.holds, ...(content.kind === null ? [] : givenBy(contents, content.kind))];
}

/**
 * The first step among what the running instance's own body declares, and
 * each step after it inside the one before; null where the first step is
 * nothing it declares, and missing where a later step is.
 */
function ownNaming(
  source: NameSource,
  vantage: Extract<Vantage, { in: 'kind' }>,
  parts: readonly string[],
): Naming | null {
  const { contents } = source;
  const [first, ...rest] = parts;
  let here = ownLevel(contents, vantage).find((one) => one.declaration.name.text === first);
  if (here === undefined) return null;
  const steps: GivenAt[] = [{ in: 'kind', giver: here.giver, path: here.path }];
  for (const [i, step] of rest.entries()) {
    const next: KindContent | undefined = insideContent(contents, here).find(
      (one) => one.declaration.name.text === step,
    );
    if (next === undefined) {
      return { names: 'missing', step: i + 1, within: parts.slice(0, i + 1).join('.') };
    }
    steps.push({ in: 'kind', giver: next.giver, path: next.path });
    here = next;
  }
  return { names: 'own', parts, steps, kind: here.kind };
}

/**
 * Every declaration in the bundle of the first step, each followed as far
 * as the path goes inside it. Missing where nothing is declared by the
 * first step's name, or where no declaration of it holds the rest.
 */
function placedNaming(source: NameSource, parts: readonly string[]): Naming {
  const { tree, contents } = source;
  const [first, ...rest] = parts;
  const candidates: Candidate[] = [];
  for (const placement of tree.placed.values()) {
    if (placement.path.at(-1) !== first) continue;
    let here: Placement = placement;
    const steps: DeclaredAt[] = [{ in: 'tree', path: here.path }];
    for (const step of rest) {
      const next = here.holds.get(step);
      if (next === undefined) break;
      steps.push({ in: 'tree', path: next.path });
      here = next;
    }
    candidates.push({ steps, kind: here.kind, declaration: here.declaration });
  }
  for (const content of everyContent(contents)) {
    if (content.declaration.name.text !== first) continue;
    let here = content;
    const steps: DeclaredAt[] = [{ in: 'kind', giver: here.giver, path: here.path }];
    for (const step of rest) {
      const next = insideContent(contents, here).find((one) => one.declaration.name.text === step);
      if (next === undefined) break;
      steps.push({ in: 'kind', giver: next.giver, path: next.path });
      here = next;
    }
    candidates.push({ steps, kind: here.kind, declaration: here.declaration });
  }
  const reached = Math.max(0, ...candidates.map((one) => one.steps.length));
  if (reached < parts.length) {
    return {
      names: 'missing',
      step: reached,
      within: reached === 0 ? null : parts.slice(0, reached).join('.'),
    };
  }
  const steps = parts.map((name) => ({ name, madeOf: madeOf(source, name) }));
  return { names: 'placed', steps, candidates };
}

/**
 * What each declaration of `name` in the bundle is made of: its kinds by
 * qualified name, less the anonymous kind that names the object itself.
 * One whose kind is absent is left out, since nothing is made of it.
 */
function madeOf(source: NameSource, name: string): (readonly string[])[] {
  const declared = [
    ...[...source.tree.placed.values()].filter((one) => one.path.at(-1) === name),
    ...everyContent(source.contents).filter((one) => one.declaration.name.text === name),
  ];
  return declared.flatMap(({ kind }) =>
    kind === null ? [] : [kind.order.filter((identity) => identity !== kindName(kind))],
  );
}

/**
 * The names a first step can reach from `vantage`, nearest first, for a
 * guess at a misspelling: from the tree, its own contents and each
 * container's outward; from a kind's body, what the running instance's own
 * body declares and then every object the bundle declares, since an
 * instance may sit anywhere. The world's name last.
 */
export function namesInReach(source: NameSource, vantage: Vantage): string[] {
  const found = new Set<string>();
  if (vantage.in === 'kind') {
    for (const one of ownLevel(source.contents, vantage)) found.add(one.declaration.name.text);
    for (const placement of source.tree.placed.values()) found.add(placement.path.at(-1)!);
    for (const one of everyContent(source.contents)) found.add(one.declaration.name.text);
    found.add(source.tree.world);
    return [...found];
  }
  let holds = source.tree.holds;
  const rings = [holds];
  for (const step of vantage.path) {
    const next = holds.get(step);
    if (next === undefined) break;
    holds = next.holds;
    rings.push(holds);
  }
  for (const ring of rings.reverse()) for (const name of ring.keys()) found.add(name);
  found.add(source.tree.world);
  return [...found];
}
