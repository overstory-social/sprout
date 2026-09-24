// The root of the one tree (the spec's The world model, Places, Actors
// and visitors). A microworld is one tree; at its root is the world, the
// only object with no container. A world composes like a kind, so what
// it writes after `is` and in its body is composed by `compose.ts`,
// `sprout.World` among the rest in the order written (`composeWorld`);
// what is its own is what it says about visitors. Three things about it
// are load-bearing elsewhere: its pass rule is `pass any (false)` unless
// it writes otherwise, so places are out of range of one another until
// the world says so; `visitors are` names the visitor kind, the world's
// own kind composing `sprout.Visitor` (`resolveVisitors`); and `contains
// actors` is what makes a place a place. `visitors arrive at` is a path
// read from the world's body, where it is written, and what it
// reaches must be a place inside the world, never the world itself, even
// one that declares `contains actors` (`resolveArrival`), and it is where
// a new visitor stands at run time; a world's written pass rules compose
// as any kind's.

import {
  writtenPath,
  type KindExpr,
  type KindMember,
  type ObjectPath,
  type WorldDeclaration,
} from '../syntax/ast.js';
import type { KindRef } from './kinds.js';
import { WORLD, writesWorld } from './sprout-world.js';
import type { Diagnostics } from '../source/diagnostics.js';
import type { Span } from '../source/source.js';
import type { EnumTable } from './enums.js';
import {
  composeKind,
  identityOf,
  unknownKind,
  writtenKind,
  type KindSource,
  type MemberNames,
  type OnUnknown,
} from './compose.js';
import { checkVisitorKind, VISITOR } from './actors.js';
import {
  pathKey,
  resolveFrom,
  unknownStep,
  worldInPath,
  type ObjectTree,
  type Placeable,
  type TreePath,
} from './tree.js';

/**
 * What a world's own pass rule answers where it writes none: nothing
 * crosses. This is why places cannot reach one another, and it is a
 * default of the LANGUAGE rather than of the host — the spec states the
 * value, so it is not a limit anybody configures.
 */
export const WORLD_PASSES_ANYTHING = false;

/**
 * Refuse a world that does not write `sprout.World`. It carries the
 * words the engine speaks for itself, and the library is part of its
 * name: an unqualified `World` is some other kind and does not stand
 * for it (the spec's The world model). One declaration answers this on
 * its own, so it is a shape-tier check.
 */
export function checkWorldDeclaration(declared: WorldDeclaration, diagnostics: Diagnostics): void {
  if (declared.composes.some(writesWorld)) return;
  const bare = declared.composes.some((one) => one.library === null && one.name.text === 'World');
  diagnostics.refuse(
    declared.name.at,
    `\`${declared.name.text}\` does not compose \`${WORLD}\`.`,
    bare
      ? `\`World\` on its own is not \`${WORLD}\`; write the library too: \`world ${declared.name.text} is ${WORLD} { … }\`.`
      : `Every world writes it: \`world ${declared.name.text} is ${WORLD} { … }\`.`,
  );
}

/** What composing a world, and reading what its visitors are made of, read. */
export interface WorldContext extends MemberNames {
  readonly enums: EnumTable;
  readonly kinds: KindSource;
  /** The library the world is read from inside: its own kinds are in it. */
  readonly from: string;
  readonly diagnostics: Diagnostics;
  /**
   * Told of a kind the world composes that nothing declares. A compile
   * at load makes it the absent table's `world` row; with none it is
   * refused.
   */
  readonly onUnknown?: OnUnknown;
}

/**
 * What a world is made of, composed as a kind is and named for the
 * world: its closure in run order, itself last, with its properties
 * merged and `contains` held wherever anything it composes holds. Null
 * having said why, or told `onUnknown`, when it cannot be composed; a
 * world that does not write `sprout.World` is not composed at all.
 */
export function composeWorld(declared: WorldDeclaration, context: WorldContext): KindRef | null {
  // A world WRITES `sprout.World`, so nothing is composed here that the
  // declaration did not say. The shape tier refuses a world that left it
  // out; asking again keeps this from quietly making a world of
  // something that is not one.
  if (!declared.composes.some(writesWorld)) {
    checkWorldDeclaration(declared, context.diagnostics);
    return null;
  }
  const { enums, kinds, diagnostics, onUnknown, verbs, onUnknownVerb, messages, onUnknownMessage } =
    context;
  return composeKind(
    {
      library: context.from,
      name: declared.name.text,
      composes: declared.composes,
      members: declared.members.filter(
        (member): member is KindMember =>
          member.kind !== 'visitors-are' && member.kind !== 'visitors-arrive-at',
      ),
      mayComposeWorld: true,
    },
    {
      enums,
      kinds,
      world: context.from,
      diagnostics,
      ...(onUnknown === undefined ? {} : { onUnknown }),
      ...(verbs === undefined ? {} : { verbs }),
      ...(onUnknownVerb === undefined ? {} : { onUnknownVerb }),
      ...(messages === undefined ? {} : { messages }),
      ...(onUnknownMessage === undefined ? {} : { onUnknownMessage }),
    },
  );
}

/** What `visitors are` names, as `resolveVisitors` finds it. */
export type Visitors =
  /** The world's own kind, composing `sprout.Visitor`. */
  | { readonly found: 'kind'; readonly kind: KindRef }
  /**
   * Nothing is there to make a visitor of: the absent table's
   * `visitor-kind` row, refused at publish and recorded at load, the
   * world admitting no one. `said` is whether what left it absent has
   * been told already.
   */
  | {
      readonly found: 'absent';
      readonly what: string;
      readonly at: Span;
      readonly message: string;
      readonly remedy: string;
      readonly said: boolean;
    }
  /** Refused in either mode, having said why. */
  | { readonly found: 'refused' };

/**
 * Read `visitors are`: said once, naming a kind of the world's own that
 * composes `sprout.Visitor` (the spec's Actors and visitors). Saying it
 * twice is refused at the second, and the first is read.
 */
export function resolveVisitors(
  declared: WorldDeclaration,
  context: Pick<WorldContext, 'kinds' | 'from' | 'diagnostics'>,
): Visitors {
  const { kinds, from, diagnostics } = context;
  let written: KindExpr | null = null;
  for (const member of declared.members) {
    if (member.kind !== 'visitors-are') continue;
    if (written !== null) {
      diagnostics.refuse(
        member.at,
        `\`${declared.name.text}\` says twice what its visitors are.`,
        'A world has one visitor kind. Say it once.',
      );
      continue;
    }
    written = member.visitor;
  }
  if (written === null) {
    diagnostics.refuse(
      declared.name.at,
      `\`${declared.name.text}\` does not say what a visitor is.`,
      `Write \`visitors are <Kind>\`, naming a kind of the world's own that composes \`${VISITOR}\`.`,
    );
    return { found: 'refused' };
  }

  const name = writtenKind(written);
  const found = kinds.find(identityOf(written, from, kinds));
  switch (found.found) {
    case 'kind':
      return checkVisitorKind(written, found.kind, from, diagnostics)
        ? { found: 'kind', kind: found.kind }
        : { found: 'refused' };
    case 'unknown': {
      const { message, remedy } = unknownKind(written, from, kinds, ` is ${VISITOR}`);
      return { found: 'absent', what: name, at: written.at, message, remedy, said: false };
    }
    case 'failed':
    case 'cycle':
      // Declared, and not composed: what is wrong with it has been said.
      return {
        found: 'absent',
        what: name,
        at: written.at,
        message: `\`${name}\` is absent, so there is nothing for a visitor to be made of.`,
        remedy: `Bring back what \`${name}\` is made of, or name another kind for visitors to be made of.`,
        said: true,
      };
  }
}

/**
 * Where a world says its visitors arrive, as the path written, or null
 * having refused a world that does not say. Saying it twice is refused
 * at the second, and the first is kept.
 */
export function arrivalOf(declared: WorldDeclaration, diagnostics: Diagnostics): ObjectPath | null {
  let arriveAt: ObjectPath | null = null;
  for (const member of declared.members) {
    if (member.kind !== 'visitors-arrive-at') continue;
    if (arriveAt !== null) {
      diagnostics.refuse(
        member.at,
        `\`${declared.name.text}\` says twice where its visitors arrive.`,
        'A world has one place visitors begin in. Say it once.',
      );
      continue;
    }
    arriveAt = member.place;
  }
  if (arriveAt === null) {
    diagnostics.refuse(
      declared.name.at,
      `\`${declared.name.text}\` does not say where a visitor arrives.`,
      'Write `visitors arrive at <name>`, naming the place they begin in.',
    );
  }
  return arriveAt;
}

/** What `resolveArrival` reads: the tree the world's objects were placed in, and its kinds. */
export interface ArrivalContext {
  readonly tree: ObjectTree;
  /** Every one of the world's objects, placed or not, with its kind where it composed. */
  readonly objects: readonly Placeable[];
  readonly kinds: KindSource;
  /** The library the world is read from inside, for a kind written without one. */
  readonly from: string;
  readonly diagnostics: Diagnostics;
}

/** Where visitors arrive, as `resolveArrival` finds it. */
export type ResolvedArrival =
  /** A place inside the world, by its path. */
  | { readonly found: 'place'; readonly path: TreePath }
  /**
   * Nothing is there to arrive in: the absent table's `place-of-arrival`
   * row, which a compile refuses at publish and records at load. `said`
   * is whether what left it absent has been told already.
   */
  | {
      readonly found: 'absent';
      readonly path: ObjectPath;
      readonly at: Span;
      readonly message: string;
      readonly remedy: string;
      readonly said: boolean;
    }
  /** Refused in either mode, having said why. */
  | { readonly found: 'refused' };

/**
 * Resolve `visitors arrive at` from the world's body, where it is
 * written, and ask whether what it names is a place: something in
 * the world whose kind declares `contains actors` (the spec's Places).
 * The world itself is refused, whatever it declares (the spec's Actors
 * and visitors).
 */
export function resolveArrival(
  declared: WorldDeclaration,
  context: ArrivalContext,
): ResolvedArrival {
  const { tree, diagnostics } = context;
  const path = arrivalOf(declared, diagnostics);
  if (path === null) return { found: 'refused' };
  const inside = worldInPath(tree.world, path);
  if (inside !== null) {
    diagnostics.refuse(inside.step.at, inside.message, inside.remedy);
    return { found: 'refused' };
  }
  const last = path.parts.at(-1)!;
  const absent = (
    message: string,
    remedy: string,
    said: boolean,
    at: Span = last.at,
  ): ResolvedArrival => ({
    found: 'absent',
    path,
    at,
    message,
    remedy,
    said,
  });
  const notAPlace = (name: string, remedy: string): ResolvedArrival => {
    diagnostics.refuse(last.at, `\`${name}\` is not a place, and visitors arrive in one.`, remedy);
    return { found: 'refused' };
  };

  const found = resolveFrom(
    tree,
    [],
    path.parts.map((part) => part.text),
  );
  switch (found.found) {
    case 'world': {
      const place = [...tree.placed.values()].find((one) => one.kind?.containsActors === true);
      diagnostics.refuse(
        last.at,
        `\`${last.text}\` is the world itself, and visitors arrive in a place inside it.`,
        place === undefined
          ? 'Declare a place in the world, an object that composes `sprout.Place` or writes `contains actors` in its body, and name it here.'
          : `Name a place in the world, as in \`visitors arrive at ${pathKey(place.path)}\`.`,
      );
      return { found: 'refused' };
    }
    case 'world-inside':
      // `worldInPath` has answered every path the world's name is a later step of.
      return { found: 'refused' };
    case 'missing': {
      const step = path.parts[found.step]!;
      // A step naming an object that did not place names something
      // absent, whose own refusal or gap has been said.
      const unplaced = context.objects.some(
        (object) => object.declaration.name.text === step.text && !tree.placements.has(object),
      );
      if (unplaced) {
        return absent(
          `\`${writtenPath(path)}\` is absent, so visitors have nowhere to arrive.`,
          `Bring \`${step.text}\` back, or name another place for visitors to arrive at.`,
          true,
          step.at,
        );
      }
      const words = unknownStep(tree, path, found);
      return absent(words.message, words.remedy, false, step.at);
    }
    case 'object': {
      const { kind } = found.placement;
      const name = writtenPath(path);
      if (kind === null) {
        return absent(
          `\`${name}\` is absent, so visitors have nowhere to arrive.`,
          `Bring back what \`${last.text}\` is made of, or name another place for visitors to arrive at.`,
          true,
        );
      }
      if (kind.containsActors) return { found: 'place', path: found.placement.path };
      return notAPlace(
        last.text,
        `Name a place, or make \`${last.text}\` one: compose \`sprout.Place\`, or write \`contains actors\` in its body.`,
      );
    }
  }
}
