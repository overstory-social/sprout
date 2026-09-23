// An object, with what it is made of worked out (the spec's The world
// model › Objects). An object names its kinds and its container, and a
// body that follows declares an anonymous kind for that object alone,
// composed by the same rules as any kind and named for the object. Where
// it sits is `tree.ts`'s; an object the bundle holds is one that both
// composed and was placed.

import type { ObjectDeclaration } from '../syntax/ast.js';
import type { Diagnostics } from '../source/diagnostics.js';
import type { EnumTable } from './enums.js';
import type { KindRef } from './kinds.js';
import { composeKind, type KindSource, type OnUnknown } from './compose.js';
import type { OnUnknownVerb, VerbNames } from './roles.js';
import type { ObjectTree, Placeable } from './tree.js';

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
  readonly kind: KindRef | null;
}

export interface ObjectContext {
  readonly enums: EnumTable;
  /** Every kind, already composed. */
  readonly kinds: KindSource;
  readonly diagnostics: Diagnostics;
  readonly onUnknown?: OnUnknown;
  /** The verbs an object's own plays may name. */
  readonly verbs?: VerbNames;
  readonly onUnknownVerb?: OnUnknownVerb;
}

/**
 * Compose one library's objects, in the order declared. One whose kinds
 * could not be composed has a null kind, having been said: it is absent,
 * and still has a place for what it holds to sit in.
 */
export function resolveObjects(
  library: string,
  declarations: readonly ObjectDeclaration[],
  context: ObjectContext,
): ComposedObject[] {
  return declarations.map((declaration) => ({
    declaration,
    kind: composeKind(
      {
        library,
        name: declaration.name.text,
        composes: declaration.composes,
        members: declaration.members,
      },
      context,
    ),
  }));
}

/** The objects that composed and were placed, in the order declared. */
export function placedObjects(
  library: string,
  composed: readonly ComposedObject[],
  tree: ObjectTree,
): ResolvedObject[] {
  const byDeclaration = new Map(
    [...tree.placed.values()].map((placement) => [placement.declaration, placement]),
  );
  return composed.flatMap(({ declaration, kind }) => {
    const placement = byDeclaration.get(declaration);
    if (kind === null || placement === undefined) return [];
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
