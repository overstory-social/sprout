// The root of the one tree (the spec's The world model, Places). A
// microworld is one tree; at its root is the world, the only object with
// no container. A world composes like a kind, so what it writes after
// its colon and in its body is composed by `compose.ts`, `sprout.World`
// among the rest in the order written; what is its own is what it says
// about visitors. Three things about it are load-bearing elsewhere: its
// pass rule is `pass any (false)` unless it writes otherwise, so places
// are out of range of one another until the world says so; `visitors
// are` names the visitor kind, so `item.is(sprout.Actor)` is an ordinary
// nominal test; and `contains actors` is what makes a place a place, the
// world included if it says so. B14 resolves `visitors arrive at`, B32
// reads the pass rules, and B42 handles arrival.

import type { Ident, KindMember, WorldDeclaration } from '../syntax/ast.js';
import type { KindRef } from './kinds.js';
import { WORLD, writesWorld } from './sprout-world.js';
import type { Diagnostics } from '../source/diagnostics.js';
import type { EnumTable } from './enums.js';
import { composeKind, identityOf, unknownKind, type KindSource } from './compose.js';

/**
 * What a world's own pass rule answers where it writes none: nothing
 * crosses. This is why places cannot reach one another, and it is a
 * default of the LANGUAGE rather than of the host — the spec states the
 * value, so it is not a limit anybody configures.
 */
export const WORLD_PASSES_ANYTHING = false;

/** A world, with what it is made of worked out. */
export interface ResolvedWorld {
  readonly name: string;
  /**
   * What it is made of, composed as a kind is and named for the world:
   * its closure in run order, itself last, with its properties merged
   * and `contains` held wherever anything it composes holds.
   */
  readonly kind: KindRef;
  /** What a person is made of here. */
  readonly visitor: KindRef;
  /**
   * Where a person begins, as written. Resolving an identifier to an
   * object is B14's, which has `containsActors` to ask whether what it
   * resolved to is a place.
   */
  readonly arriveAt: Ident;
  /** Whether anything crosses it. False until B32 reads a rule saying otherwise. */
  readonly passesAnything: boolean;
  readonly declaration: WorldDeclaration;
}

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
      ? `\`World\` on its own is not \`${WORLD}\`; write the library too: \`world ${declared.name.text}: ${WORLD} { … }\`.`
      : `Every world writes it: \`world ${declared.name.text}: ${WORLD} { … }\`.`,
  );
}

/**
 * Work out what a world declares, or refuse it. Returns null having
 * said why, because a world nobody can enter is not a microworld and
 * everything after this reads its answer. What it says about visitors is
 * read whether or not it composed, so an author is told all of it.
 */
export function resolveWorld(
  declared: WorldDeclaration,
  enums: EnumTable,
  kinds: KindSource,
  /** The library this is being read from inside, for a name written without one. */
  from: string,
  diagnostics: Diagnostics,
): ResolvedWorld | null {
  // A world WRITES `sprout.World`, so nothing is composed here that the
  // declaration did not say. The shape tier has already refused a world
  // that left it out; asking again keeps the resolver from quietly
  // making a world of something that is not one.
  checkWorldDeclaration(declared, diagnostics);

  const kind = composeKind(
    {
      library: from,
      name: declared.name.text,
      composes: declared.composes,
      members: declared.members.filter(
        (member): member is KindMember =>
          member.kind !== 'visitors-are' && member.kind !== 'visitors-arrive-at',
      ),
      mayComposeWorld: true,
    },
    { enums, kinds, diagnostics },
  );

  // --- what it says about visitors --------------------------------------
  let visitor: KindRef | null = null;
  let arriveAt: Ident | null = null;
  let saidAre = false;
  let saidArrive = false;
  /** Whether the visitor kind failed to compose, which has been said already. */
  let visitorFailed = false;

  for (const member of declared.members) {
    switch (member.kind) {
      case 'visitors-are': {
        if (saidAre) {
          diagnostics.refuse(
            member.at,
            `\`${declared.name.text}\` says twice what its visitors are.`,
            'A world has one visitor kind. Say it once.',
          );
          break;
        }
        saidAre = true;
        const written = member.visitor;
        const found = kinds.find(identityOf(written, from, kinds));
        if (found.found === 'kind') {
          visitor = found.kind;
        } else if (found.found === 'unknown') {
          const { message, remedy } = unknownKind(written, from, kinds);
          diagnostics.refuse(written.at, message, remedy);
        } else {
          visitorFailed = true;
        }
        break;
      }
      case 'visitors-arrive-at':
        if (saidArrive) {
          diagnostics.refuse(
            member.at,
            `\`${declared.name.text}\` says twice where its visitors arrive.`,
            'A world has one place visitors begin in. Say it once.',
          );
          break;
        }
        saidArrive = true;
        arriveAt = member.place;
        break;
      default:
        // What any kind may hold, which composing it has read.
        break;
    }
  }

  // A world that says neither is owed both sentences, not the first one
  // twice over: an author who forgot the block forgot all of it.
  if (visitor === null && !visitorFailed) {
    diagnostics.refuse(
      declared.name.at,
      saidAre
        ? `\`${declared.name.text}\` does not say what its visitors are made of.`
        : `\`${declared.name.text}\` does not say what a visitor is.`,
      'Write `visitors are <Kind>`, naming the kind a person is made of here.',
    );
  }
  if (arriveAt === null) {
    diagnostics.refuse(
      declared.name.at,
      `\`${declared.name.text}\` does not say where a visitor arrives.`,
      'Write `visitors arrive at <name>`, naming the place they begin in.',
    );
  }
  if (kind === null || visitor === null || arriveAt === null) return null;

  return {
    name: declared.name.text,
    kind,
    visitor,
    arriveAt,
    passesAnything: WORLD_PASSES_ANYTHING,
    declaration: declared,
  };
}
