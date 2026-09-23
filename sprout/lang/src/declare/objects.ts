// An object, with what it is made of worked out (the spec's The world
// model › Objects). An object names its kinds, and a body that follows
// declares an anonymous kind for that object alone, composed by the same
// rules as any kind and named for the object, and holds the objects
// inside it. It holds, before those, a copy of what each kind in its
// closure gives (`contents.ts`), and each copy holds what its own kinds
// give in turn. Where each sits is what holds it, which `tree.ts` makes a
// place in the tree of; an object the bundle holds is one that both
// composed and was placed.

import type { KindDeclaration, ObjectDeclaration, WorldDeclaration } from '../syntax/ast.js';
import type { Diagnostics } from '../source/diagnostics.js';
import type { EnumTable } from './enums.js';
import type { KindRef } from './kinds.js';
import { composeKind, type KindSource, type MemberNames, type OnUnknown } from './compose.js';

import type { ObjectTree, Placeable } from './tree.js';
import { givenBy, type KindContent, type KindContents } from './contents.js';

/** An object declaration, and the object whose body it is written in; null for the world's. */
export interface NestedObject {
  readonly declaration: ObjectDeclaration;
  readonly within: ObjectDeclaration | null;
}

/**
 * Every object written in a body, the world's or a kind's, at any depth,
 * each after what holds it and in the order written: a body's objects in
 * order, each followed by what it holds.
 */
export function objectsIn(body: WorldDeclaration | KindDeclaration): NestedObject[] {
  const found: NestedObject[] = [];
  const pending: NestedObject[] = body.objects
    .map((declaration) => ({ declaration, within: null }))
    .reverse();
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    found.push(next);
    const inner = next.declaration;
    for (let i = inner.objects.length - 1; i >= 0; i--) {
      pending.push({ declaration: inner.objects[i]!, within: inner });
    }
  }
  return found;
}

/** An object as the bundle holds it. */
export interface ResolvedObject {
  readonly name: string;
  /** The world or library whose files declared it. */
  readonly library: string;
  /** Its anonymous kind: what it composes and what its own body declares. */
  readonly kind: KindRef;
  /** The names from the world down to it, itself last: `kiln.shelf`. */
  readonly path: readonly string[];
  /** What holds it, the same way; the world is the empty path. */
  readonly container: readonly string[];
  readonly declaration: ObjectDeclaration;
}

/** An object declaration and its anonymous kind, or null where that could not be composed. */
export interface ComposedObject extends Placeable {
  readonly declaration: ObjectDeclaration;
  readonly within: ComposedObject | null;
  readonly kind: KindRef | null;
  /** The kind whose body gave it, by qualified name; null for one written in the world's body. */
  readonly giver: string | null;
}

export interface ObjectContext extends MemberNames {
  readonly enums: EnumTable;
  /** Every kind, already composed. */
  readonly kinds: KindSource;
  readonly diagnostics: Diagnostics;
  readonly onUnknown?: OnUnknown;
}

/**
 * Compose the objects written in `world`'s body, `library` being the
 * world's namespace, and give each what its kinds' bodies hold: listed
 * each after what holds it, and within one holder what its kinds give,
 * in closure order, before what its own body holds. One whose kinds
 * could not be composed has a null kind, having been said: it is absent,
 * is given nothing, and still has a place for what it holds to sit in.
 */
export function resolveObjects(
  library: string,
  world: WorldDeclaration | undefined,
  context: ObjectContext,
  contents: KindContents,
): ComposedObject[] {
  type Pending =
    | { readonly written: ObjectDeclaration; readonly within: ComposedObject | null }
    | { readonly given: KindContent; readonly within: ComposedObject };
  const found: ComposedObject[] = [];
  const pending: Pending[] = (world?.objects ?? [])
    .map((written): Pending => ({ written, within: null }))
    .reverse();
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const object: ComposedObject =
      'written' in next
        ? {
            declaration: next.written,
            within: next.within,
            kind: composeKind(
              {
                library,
                name: next.written.name.text,
                composes: next.written.composes,
                members: next.written.members,
              },
              { ...context, world: library },
            ),
            giver: null,
          }
        : {
            declaration: next.given.declaration,
            within: next.within,
            kind: next.given.kind,
            giver: next.given.giver,
          };
    found.push(object);
    const given = object.kind === null ? [] : givenBy(contents, object.kind);
    const own =
      'written' in next
        ? next.written.objects.map((written): Pending => ({ written, within: object }))
        : next.given.holds.map((held): Pending => ({ given: held, within: object }));
    const inside = [...given.map((one): Pending => ({ given: one, within: object })), ...own];
    for (let i = inside.length - 1; i >= 0; i--) pending.push(inside[i]!);
  }
  return found;
}

/**
 * The objects written in the world's body that composed and were placed,
 * in the order declared; what a kind gave them is in the tree, not here.
 */
export function placedObjects(
  library: string,
  composed: readonly ComposedObject[],
  tree: ObjectTree,
): ResolvedObject[] {
  return composed.flatMap((object) => {
    const { declaration, kind } = object;
    const placement = tree.placements.get(object);
    if (object.giver !== null || kind === null || placement === undefined) return [];
    return [
      {
        name: declaration.name.text,
        library,
        kind,
        path: placement.path,
        container: placement.container,
        declaration,
      },
    ];
  });
}
