// An object, with what it is made of worked out (the spec's The world
// model › Objects). An object names its kinds and its container, and a
// body that follows declares an anonymous kind for that object alone,
// composed by the same rules as any kind and named for the object. The
// container is kept as written: resolving it to an object, and scoping
// an object's name to its container, are B14's.

import type { Ident, ObjectDeclaration } from '../syntax/ast.js';
import type { Diagnostics } from '../source/diagnostics.js';
import type { EnumTable } from './enums.js';
import type { KindRef } from './kinds.js';
import { composeKind, type KindSource, type OnUnknown } from './compose.js';

/** An object as the bundle holds it. */
export interface ResolvedObject {
  readonly name: string;
  /** The world or library whose files declared it. */
  readonly library: string;
  /** Its anonymous kind: what it composes and what its own body declares. */
  readonly kind: KindRef;
  /** What holds it, as written. */
  readonly container: Ident;
  readonly declaration: ObjectDeclaration;
}

export interface ObjectContext {
  readonly enums: EnumTable;
  /** Every kind, already composed. */
  readonly kinds: KindSource;
  readonly diagnostics: Diagnostics;
  readonly onUnknown?: OnUnknown;
}

/**
 * Resolve one library's objects. One whose kinds could not be composed
 * is left out, having been said: it is absent. Two of one name in one
 * container as written are refused at the second; two of one name in
 * different containers wait for B14, which scopes a name to its
 * container.
 */
export function resolveObjects(
  library: string,
  declarations: readonly ObjectDeclaration[],
  context: ObjectContext,
): ResolvedObject[] {
  const resolved: ResolvedObject[] = [];
  const seen = new Set<string>();
  for (const declared of declarations) {
    const name = declared.name.text;
    const key = `${declared.container.text} ${name}`;
    if (seen.has(key)) {
      context.diagnostics.refuse(
        declared.name.at,
        `\`${declared.container.text}\` holds two objects called \`${name}\`.`,
        'Give one of them another name, or remove it.',
      );
      continue;
    }
    seen.add(key);
    const kind = composeKind(
      { library, name, composes: declared.composes, members: declared.members },
      context,
    );
    if (kind === null) continue;
    resolved.push({ name, library, kind, container: declared.container, declaration: declared });
  }
  return resolved;
}
