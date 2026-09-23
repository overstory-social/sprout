// Actors, and the one kind a world's people are made of (the spec's The
// world model › Actors and visitors). An actor is whatever composes
// `sprout.Actor`, an ordinary nominal test rather than a name the engine
// knows. The visitor kind is the world's own kind composing it, and an NPC
// is an object composing the visitor kind with nobody behind it. The only
// actors are visitors and NPCs, and an actor is only ever directly inside
// something that declares `contains actors` (`checkActors`), so every
// actor has a place; where one may be moved is `runtime/move.ts`'s.

import type { KindExpr } from '../syntax/ast.js';
import type { Diagnostics } from '../source/diagnostics.js';
import { qualifiedName, SPROUT } from './enums.js';
import { composesKind, kindName, type KindRef } from './kinds.js';
import { writtenKind } from './compose.js';
import { pathKey, type ObjectTree, type Placeable } from './tree.js';

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
      `Declare one that composes \`${base}\`, as \`kind Visitor is ${base} { … }\`, and write \`visitors are Visitor\`.`,
    );
    return false;
  }
  if (!isActor(kind)) {
    diagnostics.refuse(
      written.at,
      `\`${name}\` is not an actor, and a world's visitors are made of one.`,
      `Write \`kind Visitor is ${ACTOR} { … }\` and \`visitors are Visitor\`, or name a kind that composes \`${ACTOR}\`.`,
    );
    return false;
  }
  return true;
}

/**
 * Why `name`, made of an actor kind that does not compose `visitor`, may
 * not be one: the words a declaration's refusal and a spawn's share.
 */
export function notAnNpc(name: string, visitor: KindRef): string {
  return `\`${name}\` composes \`${ACTOR}\` but not \`${visitor.name}\`, and the only actors are visitors and NPCs.`;
}

/** What `checkActors` reads: the tree, every object in it, and what the world and its visitors are made of. */
export interface ActorSetting {
  readonly tree: ObjectTree;
  /** Every object declared, in the order declared, with its kind where it composed. */
  readonly objects: readonly Placeable[];
  /** The world's kind; null where it is absent, which has been said. */
  readonly world: KindRef | null;
  /** The visitor kind; null where the world has none to name, which has been said. */
  readonly visitor: KindRef | null;
  readonly diagnostics: Diagnostics;
}

/**
 * Refuse every declared actor that is not an NPC, and every NPC declared
 * directly inside something that does not hold actors (the spec's Actors
 * and visitors). Each object is told at most one of the two, and nothing
 * is said where what decides it is absent.
 */
export function checkActors(setting: ActorSetting): void {
  const { tree, world, visitor, diagnostics } = setting;
  const placed = new Map([...tree.placed.values()].map((one) => [one.declaration, one]));
  for (const { declaration, kind } of setting.objects) {
    if (kind === null || !isActor(kind)) continue;
    const name = declaration.name.text;
    if (visitor !== null && !isNpc(kind, visitor)) {
      diagnostics.refuse(
        declaration.name.at,
        notAnNpc(name, visitor),
        `Compose \`${visitor.name}\`, what this world's visitors are made of, to make \`${name}\` an NPC, or make it of kinds that do not compose \`${ACTOR}\`.`,
      );
      continue;
    }
    const placement = placed.get(declaration);
    if (placement === undefined) continue;
    const holder =
      placement.container.length === 0
        ? world
        : tree.placed.get(pathKey(placement.container))!.kind;
    if (holder === null || holder.containsActors) continue;
    if (placement.container.length === 0) {
      const place = [...tree.placed.values()].find((one) => one.kind?.containsActors === true);
      diagnostics.refuse(
        declaration.name.at,
        `\`${tree.world}\` is the world, which holds no actors, so \`${name}\` cannot stand directly in it.`,
        place === undefined
          ? `Declare a place in the world, an object that composes \`sprout.Place\` or writes \`contains actors\` in its body, and write \`${name}\` inside its braces.`
          : `Write \`${name}\` inside the braces of a place in the world, such as \`${pathKey(place.path)}\`.`,
      );
    } else {
      const last = placement.container.at(-1)!;
      diagnostics.refuse(
        declaration.name.at,
        `\`${last}\` holds no actors, so \`${name}\` cannot stand in it.`,
        `Write \`${name}\` inside the braces of a place, or make \`${last}\` one: compose \`sprout.Place\`, or write \`contains actors\` in its body.`,
      );
    }
  }
}
