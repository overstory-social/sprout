// A kind, as typing and declaration resolution ask about it; what the
// shape tier can say about a kind or an object declaration on its own;
// and the table of every kind the bundle declares (the spec's Kinds,
// composition and libraries › Declaring and composing, Libraries and
// namespaces; The compiler › What it refuses). A kind's identity is its
// library and its name. What composing one means is `compose.ts`'s; the
// table only walks the kinds in the order composing them needs.

import type { KindDeclaration, ObjectDeclaration } from '../syntax/ast.js';
import type { Diagnostics } from '../source/diagnostics.js';
import type { ResolvedProperty } from './properties.js';
import { qualifiedName, SPROUT, type EnumTable } from './enums.js';
import { composeKind, type Found, type KindSource, type OnUnknown } from './compose.js';
import { refuseComposingWorld, writesWorld } from './sprout-world.js';

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
    refuseComposingWorld(name, written, diagnostics);
  }
}

export interface KindRef {
  readonly library: string;
  readonly name: string;
  /**
   * Every kind this one composes, itself included, by qualified name, in
   * the order their composable members run: depth-first, left to right,
   * each kind at its first appearance and itself last, so `D: B, C` with
   * `B: A` and `C: A` is `A, B, C, D` (the spec's How members combine,
   * rules 2 and 3).
   */
  readonly order: readonly string[];
  /** The same kinds as a set, so that "does this compose that" is one lookup. */
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

/**
 * Every kind the bundle declares, by library and name, composed. Every
 * library's declarations are added first and then `resolve` composes
 * them all, each after what it composes, so a kind may compose one
 * declared later or in another file.
 */
export class KindTable implements KindLookup, KindSource {
  private readonly declared = new Map<
    string,
    { readonly library: string; readonly declaration: KindDeclaration }
  >();
  private readonly composed = new Map<string, KindRef>();
  /** Kinds that were declared and could not be composed, having said why. */
  private readonly failed = new Set<string>();

  /**
   * Add a library's declarations. Two kinds of one name in one library
   * are refused at the second; two in different libraries are two kinds.
   */
  add(library: string, declarations: readonly KindDeclaration[], diagnostics: Diagnostics): void {
    for (const declared of declarations) {
      const key = qualifiedName(library, declared.name.text);
      if (this.declared.has(key)) {
        diagnostics.refuse(
          declared.name.at,
          `${library} declares two kinds called \`${declared.name.text}\`.`,
          'Give one of them another name, or remove it.',
        );
        continue;
      }
      this.declared.set(key, { library, declaration: declared });
    }
  }

  /**
   * Compose every kind added. A kind reached while it is still being
   * composed closes a cycle, which `composeKind` refuses; `onUnknown` is
   * told of a composed kind nothing declares.
   */
  resolve(enums: EnumTable, diagnostics: Diagnostics, onUnknown?: OnUnknown): void {
    const composing: string[] = [];
    const source: KindSource = {
      declares: (identity) => this.declares(identity),
      named: (library) => this.named(library),
      find: (identity) => {
        const settled = this.settled(identity);
        if (settled !== null) return settled;
        const at = composing.indexOf(identity);
        if (at >= 0) return { found: 'cycle', through: composing.slice(at + 1) };
        visit(identity);
        return this.settled(identity)!;
      },
    };
    const visit = (identity: string): void => {
      const { library, declaration } = this.declared.get(identity)!;
      composing.push(identity);
      const kind = composeKind(
        {
          library,
          name: declaration.name.text,
          composes: declaration.composes,
          members: declaration.members,
        },
        { enums, kinds: source, diagnostics, ...(onUnknown === undefined ? {} : { onUnknown }) },
      );
      composing.pop();
      if (kind === null) this.failed.add(identity);
      else this.composed.set(identity, kind);
    };
    for (const identity of this.declared.keys()) {
      if (this.settled(identity) === null) visit(identity);
    }
  }

  /** Whether a kind of this identity is declared, composed or not. */
  declares(identity: string): boolean {
    return this.declared.has(identity);
  }

  /** The names of the kinds a library declares, composed or not. */
  named(library: string): string[] {
    return [...this.declared.values()]
      .filter((one) => one.library === library)
      .map((one) => one.declaration.name.text);
  }

  /** What a composition finds for a kind, once `resolve` has composed them all. */
  find(identity: string): Found {
    return this.settled(identity) ?? { found: 'unknown' };
  }

  /** A composed kind by its full identity: `sprout.Container` is not `ericworld.Container`. */
  qualified(library: string, name: string): KindRef | null {
    return this.composed.get(qualifiedName(library, name)) ?? null;
  }

  /** A kind written without a library, from inside `from`: its own first, then the standard library's. */
  unqualified(name: string, from: string): KindRef | null {
    return this.qualified(from, name) ?? this.qualified(SPROUT, name);
  }

  /** Every kind that composed, in the order it was declared. */
  all(): KindRef[] {
    return [...this.declared.keys()].flatMap((identity) => this.composed.get(identity) ?? []);
  }

  private settled(identity: string): Found | null {
    const kind = this.composed.get(identity);
    if (kind !== undefined) return { found: 'kind', kind };
    if (this.failed.has(identity)) return { found: 'failed' };
    if (!this.declared.has(identity)) return { found: 'unknown' };
    return null;
  }
}
