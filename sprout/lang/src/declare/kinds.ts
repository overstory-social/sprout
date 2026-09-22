// A kind, as typing and declaration resolution ask about it, and what the
// shape tier can say about a kind or an object declaration on its own
// (the spec's Kinds, composition and libraries › Declaring and composing;
// The compiler › What it refuses). B19 composes kinds and B21 namespaces
// them; both produce something that satisfies `KindRef`, and nothing
// here needs the rest.

import type { KindDeclaration, KindExpr, ObjectDeclaration } from '../syntax/ast.js';
import type { Diagnostics } from '../source/diagnostics.js';
import type { ResolvedProperty } from './properties.js';
import { qualifiedName, SPROUT } from './enums.js';

/**
 * What every world composes, written with its library (the spec's The
 * world model). An unqualified `World` does not stand for it.
 */
export const WORLD = `${SPROUT}.World`;

/** Whether a kind as written is `sprout.World`, library and all. */
export function writesWorld(written: KindExpr): boolean {
  return written.library?.text === SPROUT && written.name.text === 'World';
}

/**
 * Refuse what one kind or object declaration gets wrong on its own: an
 * object that names no kind (the spec's Objects: "An object names its
 * kinds and its container"), and `sprout.World` written anywhere but on
 * the world, since it would make a thing into a world (The compiler ›
 * What it refuses). Which kinds the names resolve to is the second tier's.
 */
export function checkKindDeclaration(
  declared: KindDeclaration | ObjectDeclaration,
  diagnostics: Diagnostics,
): void {
  const name = declared.name.text;
  if (declared.kind === 'object' && declared.composes.length === 0) {
    diagnostics.refuse(
      declared.name.at,
      `\`${name}\` does not say what kind of thing it is.`,
      `An object names the kinds it is made of: \`object ${name}: <Kind> in ${declared.container.text} { … }\`.`,
    );
  }
  for (const written of declared.composes.filter(writesWorld)) {
    diagnostics.refuse(
      written.at,
      `\`${name}\` composes \`${WORLD}\`, which only a world may.`,
      `Take it out of what \`${name}\` composes: it would make a thing into a world, and a bundle has one world, written \`world <name>: ${WORLD} { … }\`.`,
    );
  }
}

export interface KindRef {
  readonly library: string;
  readonly name: string;
  /**
   * Every kind this one composes, itself included, by qualified name.
   * The closure is computed once so that "does this compose that" is
   * one lookup.
   */
  readonly composes: ReadonlySet<string>;
  /** What it declares, by name, the remembered ones included. */
  readonly properties: ReadonlyMap<string, ResolvedProperty>;
  /** Whether it may hold others: `contains`, or `contains actors`, which implies it. */
  readonly contains: boolean;
  /**
   * Whether what it holds may be people, which is the whole of what
   * makes a place a place. It implies `contains`, and whoever builds a
   * `KindRef` keeps that true.
   */
  readonly containsActors: boolean;
}

/** `sprout.Container` — a kind's full identity is its library and its name. */
export function kindName(kind: KindRef): string {
  return qualifiedName(kind.library, kind.name);
}

/** Matching is nominal and by composition: a kind composes itself. */
export function composesKind(kind: KindRef, target: KindRef): boolean {
  return kind.composes.has(kindName(target));
}

/** Every kind the bundle declares, asked the same two ways an enum is. */
export interface KindLookup {
  qualified(library: string, name: string): KindRef | null;
  unqualified(name: string, from: string): KindRef | null;
}
