// Actors, and the one kind a world's people are made of (the spec's The
// world model › Actors and visitors). An actor is whatever composes
// `sprout.Actor`, an ordinary nominal test rather than a name the engine
// knows. The visitor kind is the world's own kind composing it, and an NPC
// is an object composing the visitor kind with nobody behind it. Nothing
// here asks where an actor stands: an NPC needs no place among its
// ancestors, and where one may be moved is `runtime/move.ts`'s and B42's.

import type { KindExpr } from '../syntax/ast.js';
import type { Diagnostics } from '../source/diagnostics.js';
import { qualifiedName, SPROUT } from './enums.js';
import { composesKind, kindName, type KindRef } from './kinds.js';
import { writtenKind } from './compose.js';

/** `sprout.Actor`: the hands and their capacity, which every actor composes. */
export const ACTOR = qualifiedName(SPROUT, 'Actor');

/** Whether things made of `kind` are actors: it composes `sprout.Actor`. */
export function isActor(kind: KindRef): boolean {
  return kind.composes.has(ACTOR);
}

/**
 * Whether a declared object made of `kind` is an NPC: it composes the
 * world's visitor kind. A visitor's own instance is made of that kind
 * too; what sets it apart is the person behind it, which its visitor
 * record holds.
 */
export function isNpc(kind: KindRef, visitor: KindRef): boolean {
  return composesKind(kind, visitor);
}

/**
 * Refuse a visitor kind, written as `written` after `visitors are`, that
 * is not the world's own or not an actor; `world` is the namespace the
 * world's own kinds are in. True when it may be what visitors are made of.
 */
export function checkVisitorKind(
  written: KindExpr,
  kind: KindRef,
  world: string,
  diagnostics: Diagnostics,
): boolean {
  const name = writtenKind(written);
  if (kind.library !== world) {
    // The world's own kind is where "whatever this story needs a person
    // to have" is written, so a library's kind, `sprout.Actor` included,
    // is composed into one rather than named here.
    const base = isActor(kind) ? kindName(kind) : ACTOR;
    diagnostics.refuse(
      written.at,
      `\`${name}\` belongs to the library \`${kind.library}\`. A world's visitors are made of a kind of its own.`,
      `Declare one that composes \`${base}\`, as \`kind Visitor: ${base} { … }\`, and write \`visitors are Visitor\`.`,
    );
    return false;
  }
  if (!isActor(kind)) {
    diagnostics.refuse(
      written.at,
      `\`${name}\` is not an actor, and a world's visitors are made of one.`,
      `Write \`kind Visitor: ${ACTOR} { … }\` and \`visitors are Visitor\`, or name a kind that composes \`${ACTOR}\`.`,
    );
    return false;
  }
  return true;
}
