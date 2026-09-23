// Actors, and the one kind a world's people are made of (the spec's The
// world model › Actors and visitors). An actor is whatever composes
// `sprout.Actor`, an ordinary nominal test rather than a name the engine
// knows, and every actor may `act`. The visitor kind is the world's own
// kind composing `sprout.Visitor`; an instance of it is a visitor, and
// every other actor is an NPC. Nothing declares or spawns a visitor, and
// an actor is only ever directly inside something that declares
// `contains actors` (`checkActors`), so every actor has a place; where one
// may be moved is `runtime/move.ts`'s.

import type { KindExpr } from '../syntax/ast.js';
import { onceEach, type Diagnostics } from '../source/diagnostics.js';
import { qualifiedName, SPROUT } from './enums.js';
import { kindName, type KindRef } from './kinds.js';
import { writtenKind } from './compose.js';
import { pathKey, type ObjectTree, type Placeable } from './tree.js';

/** `sprout.Actor`: the hands and their capacity, which every actor composes. */
export const ACTOR = qualifiedName(SPROUT, 'Actor');

/** `sprout.Visitor`: what a person is made of, which only the visitor kind composes. */
export const VISITOR = qualifiedName(SPROUT, 'Visitor');

/** Whether things made of `kind` are actors: it composes `sprout.Actor`. */
export function isActor(kind: KindRef): boolean {
  return kind.composes.has(ACTOR);
}

/** Whether `kind` is made for a person: it composes `sprout.Visitor`. */
export function isVisitorKind(kind: KindRef): boolean {
  return kind.composes.has(VISITOR);
}

/**
 * Refuse a visitor kind, written as `written` after `visitors are`, that
 * is not the world's own or does not compose `sprout.Visitor`; `world` is
 * the namespace the world's own kinds are in. True when it may be what
 * visitors are made of.
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
    // to have" is written, so a library's kind, `sprout.Visitor` included,
    // is composed into one rather than named here.
    const base = isVisitorKind(kind) ? kindName(kind) : VISITOR;
    diagnostics.refuse(
      written.at,
      `\`${name}\` belongs to the library \`${kind.library}\`. A world's visitors are made of a kind of its own.`,
      `Declare one that composes \`${base}\`, as \`kind Person is ${base} { … }\`, and write \`visitors are Person\`.`,
    );
    return false;
  }
  if (!isVisitorKind(kind)) {
    // A kind of the world's own named `Visitor` hides `sprout.Visitor`,
    // which is warned, so the kind a remedy suggests has another name.
    const person = name === 'Person' ? 'Guest' : 'Person';
    diagnostics.refuse(
      written.at,
      `\`${name}\` does not compose \`${VISITOR}\`, and a world's visitors are made of a kind that does.`,
      isActor(kind)
        ? `Write \`kind ${person} is ${name}, ${VISITOR} { }\` and \`visitors are ${person}\`, so a person has what \`${name}\` gives.`
        : `Write \`kind ${person} is ${VISITOR} { … }\` and \`visitors are ${person}\`, or name a kind that composes \`${VISITOR}\`.`,
    );
    return false;
  }
  return true;
}

/**
 * Why `name`, which composes `sprout.Visitor`, may not be declared or
 * spawned: the refusal a declaration and a spawn share, and its remedy.
 */
export function aVisitorMade(
  name: string,
  how: 'declares' | 'spawns',
): { message: string; remedy: string } {
  const what = name === VISITOR ? `\`${name}\` is` : `\`${name}\` composes \`${VISITOR}\`,`;
  return {
    message: `${what} what a person is made of, and nothing ${how} a visitor: each one is a person who arrives.`,
    remedy: `For an NPC, use a kind that composes \`${ACTOR}\` and not \`${VISITOR}\`; to share it with the visitors, write \`kind Creature is ${ACTOR} { … }\` and \`kind Person is Creature, ${VISITOR} { }\`.`,
  };
}

/** What `checkActors` reads: the tree, every object in it, and what the world is made of. */
export interface ActorSetting {
  readonly tree: ObjectTree;
  /** Every object declared, in the order declared, with its kind where it composed. */
  readonly objects: readonly Placeable[];
  /** The world's kind; null where it is absent, which has been said. */
  readonly world: KindRef | null;
  readonly diagnostics: Diagnostics;
}

/**
 * Refuse every declared object composing `sprout.Visitor`, and every NPC
 * declared directly inside something that does not hold actors (the
 * spec's Actors and visitors), a kind's content in each instance
 * included. Each object is told at most one of the two, and nothing is
 * said where what decides it is absent.
 */
export function checkActors(setting: ActorSetting): void {
  const { tree, world } = setting;
  const diagnostics = onceEach(setting.diagnostics);
  for (const object of setting.objects) {
    const { declaration, kind } = object;
    if (kind === null || !isActor(kind)) continue;
    const name = declaration.name.text;
    if (isVisitorKind(kind)) {
      const { message, remedy } = aVisitorMade(name, 'declares');
      diagnostics.refuse(declaration.name.at, message, remedy);
      continue;
    }
    const placement = tree.placements.get(object);
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
