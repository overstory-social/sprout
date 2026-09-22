// The root of the one tree (the spec's The world model, Places). A
// microworld is one tree; at its root is the world, the only object with
// no container. Three things about it are load-bearing elsewhere: its
// pass rule is `pass any (false)` unless it writes otherwise, so places
// are out of range of one another until the world says so; `visitors
// are` names the visitor kind, so `item.is(sprout.Actor)` is an ordinary
// nominal test; and `contains actors` is what makes a place a place, the
// world included if it says so. What is here is what the declaration
// WROTE: every world writes `sprout.World` in its composition and B19
// merges what composition brings, B14 resolves `visitors arrive at`,
// B32 reads the pass rules, and B42 handles arrival.

import type { Ident, WorldDeclaration } from '../syntax/ast.js';
import type { KindLookup, KindRef } from './kinds.js';
import { kindName, WORLD, writesWorld } from './kinds.js';
import type { Diagnostics } from '../source/diagnostics.js';
import { qualifiedName, type EnumTable } from './enums.js';
import { resolveProperty, resolveRemembers, type ResolvedProperty } from './properties.js';

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
  /** Everything it composes, as it wrote them, with `sprout.World` first. */
  readonly composes: readonly KindRef[];
  /** What a person is made of here. */
  readonly visitor: KindRef;
  /**
   * Where a person begins, as written. Resolving an identifier to an
   * object is B14's, which now has `containsActors` to ask whether what
   * it resolved to is a place.
   */
  readonly arriveAt: Ident;
  /**
   * Whether it may hold others at all, as this declaration WROTE it.
   * `sprout.World` declares `contains` and every world composes it, so
   * a world that writes nothing still holds things once B19 merges what
   * it composes; false here means only that this text did not say so.
   */
  readonly contains: boolean;
  /**
   * Whether what it holds may be people — which is the whole of what
   * makes a place a place, here and everywhere else. Implies `contains`:
   * the standard library's `kind Place` declares only this one and still
   * holds a bench.
   */
  readonly containsActors: boolean;
  /** What the world itself holds, the remembered ones included. */
  readonly properties: ReadonlyMap<string, ResolvedProperty>;
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
 * everything after this reads its answer.
 */
export function resolveWorld(
  declared: WorldDeclaration,
  enums: EnumTable,
  kinds: KindLookup,
  /** The library this is being read from inside, for a name written without one. */
  from: string,
  diagnostics: Diagnostics,
): ResolvedWorld | null {
  // --- what it composes -------------------------------------------------
  // A world WRITES `sprout.World`, so nothing is composed here that the
  // declaration did not say. The shape tier has already refused a world
  // that left it out; asking again keeps the resolver from quietly
  // making a world of something that is not one.
  checkWorldDeclaration(declared, diagnostics);

  const composes: KindRef[] = [];
  const named = new Set<string>();
  for (const written of declared.composes) {
    const found =
      written.library === null
        ? kinds.unqualified(written.name.text, from)
        : kinds.qualified(written.library.text, written.name.text);
    if (found === null) {
      const name = writtenKind(written.library, written.name);
      if (name === WORLD) {
        diagnostics.refuse(
          written.at,
          `The standard library is missing \`${WORLD}\`.`,
          'Every world composes it, for the words the engine speaks for itself.',
        );
      } else {
        diagnostics.refuse(
          written.at,
          `Nothing here is a \`${name}\`.`,
          'A world composes kinds this world declares, or ones a library it uses exports.',
        );
      }
      continue;
    }
    if (named.has(kindName(found))) {
      diagnostics.refuse(
        written.at,
        `\`${declared.name.text}\` composes \`${kindName(found)}\` twice.`,
        'Compose it once.',
      );
      continue;
    }
    named.add(kindName(found));
    composes.push(found);
  }

  // `sprout.World` goes FIRST, wherever the author wrote it among the
  // rest. Composition order sequences a composable member's
  // contributions, and the words the engine speaks for itself are the
  // ones everything else is written over.
  const ordered = [
    ...composes.filter((one) => kindName(one) === WORLD),
    ...composes.filter((one) => kindName(one) !== WORLD),
  ];

  // --- what it says about visitors --------------------------------------
  let visitor: KindRef | null = null;
  let arriveAt: Ident | null = null;
  let saidAre = false;
  let saidArrive = false;
  let wroteContains = false;
  let wroteContainsActors = false;

  // What the world's own body declares has the world as its origin.
  const origin = qualifiedName(from, declared.name.text);
  const properties = new Map<string, ResolvedProperty>();
  const hold = (property: ResolvedProperty, at: Ident): void => {
    const before = properties.get(property.name);
    if (before !== undefined) {
      diagnostics.refuse(
        at.at,
        `\`${declared.name.text}\` holds \`:${property.name}\` twice.`,
        'A property is declared once. Remove the second, or give it another name.',
      );
      return;
    }
    properties.set(property.name, property);
  };

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
        const found =
          written.library === null
            ? kinds.unqualified(written.name.text, from)
            : kinds.qualified(written.library.text, written.name.text);
        if (found === null) {
          diagnostics.refuse(
            written.at,
            `Nothing here is a \`${writtenKind(written.library, written.name)}\`.`,
            'A visitor is made of a kind this world declares, or one a library it uses exports.',
          );
          break;
        }
        visitor = found;
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
      case 'contains':
        // Idempotent, which is what *How members combine* says of these
        // two where composition brings them together — so a world that
        // writes `contains` beside `contains actors`, or either of them
        // twice, is saying something already true rather than making a
        // mistake. Nothing is said about it; whether a redundant one is
        // worth a WARNING is B50's, which owns the list of them.
        wroteContains = wroteContains || !member.actors;
        wroteContainsActors = wroteContainsActors || member.actors;
        break;
      case 'remembers':
        for (const remembered of resolveRemembers(member, enums, from, origin, diagnostics)) {
          hold(remembered, remembered.declaration.name);
        }
        break;
      default: {
        const resolved = resolveProperty(member, enums, from, origin, diagnostics);
        if (resolved !== null) hold(resolved, member.name);
        break;
      }
    }
  }

  // A world that says neither is owed both sentences, not the first one
  // twice over: an author who forgot the block forgot all of it.
  if (visitor === null) {
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
  if (visitor === null || arriveAt === null) return null;

  return {
    name: declared.name.text,
    composes: ordered,
    visitor,
    arriveAt,
    // Each flag above is one line the author WROTE, and the implication
    // between them is here, once: `contains actors` holds. The standard
    // library's `kind Place` declares only the second and a place holds
    // a bench, which is the whole of the evidence — the spec never says
    // so outright, and the working notes' *Holes in the spec* records
    // what the other reading would cost.
    contains: wroteContains || wroteContainsActors,
    containsActors: wroteContainsActors,
    properties,
    passesAnything: WORLD_PASSES_ANYTHING,
    declaration: declared,
  };
}

function writtenKind(library: Ident | null, name: Ident): string {
  return library === null ? name.text : `${library.text}.${name.text}`;
}
