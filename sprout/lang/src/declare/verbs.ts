// Verbs (the spec's Verbs › Declaring a verb, Set roles, Optional tools,
// Value roles, Exits, Engine verbs, Reserved names; Kinds › Libraries and
// namespaces; Limits › Static caps), in both tiers.
//
// The first tier checks a verb against itself: every slot names a role
// the verb declares, once per phrase, and every phrase names the first
// role, the target. The second tier is `VerbTable`, which resolves each
// verb in the library that declared it: what fills each role, and
// whether each role is optional, computed from the phrases. A verb's
// identity is its library and its name, as a kind's is. B24 plays a
// role and B27 parses a phrase; neither is here.

import type {
  KindExpr,
  PhraseDeclaration,
  PhraseSlot,
  RoleDeclaration,
  VerbDeclaration,
} from '../syntax/ast.js';
import type { Diagnostics } from '../source/diagnostics.js';
import { textOf } from '../source/source.js';
import { readable } from '../source/words.js';
import { nearestOption, qualifiedName, SPROUT, type EnumTable } from './enums.js';
import type { KindRef } from './kinds.js';
import {
  identityOf,
  unknownKind,
  writtenKind,
  type KindSource,
  type OnUnknown,
} from './compose.js';

/** The host's figures for the spec's static caps that bound a verb. Never this layer's numbers. */
export interface VerbCaps {
  readonly rolesPerVerb: number;
  readonly phrasesPerVerb: number;
  readonly phraseCharacters: number;
}

/** One verb, checked against itself. */
export function checkVerbDeclaration(
  declared: VerbDeclaration,
  caps: VerbCaps,
  diagnostics: Diagnostics,
): void {
  const verb = declared.name.text;
  checkCaps(declared, caps, diagnostics);

  const roles = new Map<string, RoleDeclaration>();
  for (const role of declared.roles) {
    if (roles.has(role.name.text)) {
      diagnostics.refuse(
        role.name.at,
        `\`${verb}\` declares the role \`${role.name.text}\` twice.`,
        "A role's name is what a slot fills, so it is written once. Remove the second, or give it another name.",
      );
      continue;
    }
    roles.set(role.name.text, role);
    checkRole(declared, role, diagnostics);
  }

  const target = declared.roles[0];
  const seen = new Map<string, PhraseDeclaration>();
  for (const phrase of declared.phrases) {
    const written = textOf(phrase.at);
    if (phrase.parts.length === 0) {
      diagnostics.refuse(
        phrase.at,
        `\`${verb}\` has a phrase with no words in it.`,
        `Write the words a visitor types, as in \`"${verb} [target]"\`, or take the phrase out.`,
      );
      continue;
    }
    const key = meaningOf(phrase);
    if (seen.has(key)) {
      diagnostics.refuse(
        phrase.at,
        `\`${verb}\` has the phrase \`${written}\` twice.`,
        'A phrase is written once. Remove the second.',
      );
      continue;
    }
    seen.set(key, phrase);

    const filled = new Set<string>();
    let named = true;
    for (const slot of phrase.parts.filter(isSlot)) {
      const role = slot.role.text;
      if (!roles.has(role)) {
        named = false;
        unknownRole(declared, written, slot, diagnostics);
        continue;
      }
      if (filled.has(role)) {
        diagnostics.refuse(
          slot.at,
          `\`${written}\` fills \`${role}\` twice.`,
          'A phrase fills each role once. Name another role in one of the slots, or take one out.',
        );
        continue;
      }
      filled.add(role);
    }
    // A phrase that named a role the verb lacks has been refused for it,
    // and may well have meant the target there.
    if (named && target !== undefined && !filled.has(target.name.text)) {
      diagnostics.refuse(
        phrase.at,
        `\`${written}\` leaves out \`${target.name.text}\`, the role \`${verb}\` is done to.`,
        `Every phrase names the first role, as \`"${verb} [${target.name.text}]"\` does.`,
      );
    }
  }
}

/**
 * The caps that bound one verb, each said once at the first thing past
 * it: how many a verb holds is one fact about one verb.
 */
function checkCaps(declared: VerbDeclaration, caps: VerbCaps, diagnostics: Diagnostics): void {
  const verb = declared.name.text;
  const role = declared.roles[caps.rolesPerVerb];
  if (role !== undefined) {
    diagnostics.refuse(
      role.at,
      `\`${verb}\` has ${declared.roles.length} roles, and ${caps.rolesPerVerb} is as many as a verb may have.`,
      'Take some out. A set role, marked `many`, counts as one however many things it binds.',
    );
  }
  const phrase = declared.phrases[caps.phrasesPerVerb];
  if (phrase !== undefined) {
    diagnostics.refuse(
      phrase.at,
      `\`${verb}\` has ${declared.phrases.length} phrases, and ${caps.phrasesPerVerb} is as many as a verb may have.`,
      'Keep the ways of saying it a visitor is most likely to type, and take the rest out.',
    );
  }
  for (const each of declared.phrases) {
    // Counted as the phrase means it, after escapes, since that is what
    // a visitor would type.
    const length = [...each.text].length;
    if (length > caps.phraseCharacters) {
      diagnostics.refuse(
        each.at,
        `This phrase is ${length} characters long, and ${caps.phraseCharacters} is as long as a phrase may be.`,
        'Say it in fewer words: a phrase is what a visitor types.',
      );
    }
  }
}

/** What a role's own modifiers must agree with: its filler, its place, and the verb's phrases. */
function checkRole(
  declared: VerbDeclaration,
  role: RoleDeclaration,
  diagnostics: Diagnostics,
): void {
  const verb = declared.name.text;
  const name = role.name.text;
  const value = role.filler?.kind === 'value-filler' ? role.filler.value : null;
  if (role.many !== null && value !== null) {
    diagnostics.refuse(
      role.many.at,
      `\`${name}\` is ${value === 'symbol' ? 'a' : 'an'} \`${value}\` role, and a value role is single.`,
      'Several values are several roles; take `many` off.',
    );
  }
  if (role.optional === null) return;
  if (declared.phrases.length > 0) {
    diagnostics.refuse(
      role.optional.at,
      `\`${name}\` is marked \`optional\`, and \`${verb}\` has phrases, so its phrases decide.`,
      'A tool some phrase leaves out is optional already; `optional` is written only on a verb with no phrases. Remove it.',
    );
  } else if (declared.roles[0] === role) {
    diagnostics.refuse(
      role.optional.at,
      `\`${name}\` is the role \`${verb}\` is done to, and the target is never optional.`,
      '`optional` is for a tool, a role after the first. Remove it.',
    );
  }
}

/** A slot naming a role the verb does not declare, said with what it may name instead. */
function unknownRole(
  declared: VerbDeclaration,
  written: string,
  slot: PhraseSlot,
  diagnostics: Diagnostics,
): void {
  const verb = declared.name.text;
  const role = slot.role.text;
  const names = [...new Set(declared.roles.map((r) => r.name.text))];
  if (names.length === 0) {
    diagnostics.refuse(
      slot.at,
      `\`${written}\` names \`${role}\`, and \`${verb}\` has no roles.`,
      `Take the slot out, or add \`role ${role}\`.`,
    );
    return;
  }
  const meant = names.length === 1 ? names[0]! : nearestOption(role, names);
  const its = `Its ${names.length === 1 ? 'role is' : 'roles are'} ${readable(names)}.`;
  diagnostics.refuse(
    slot.at,
    `\`${written}\` names \`${role}\`, and \`${verb}\` has no such role.`,
    meant === null
      ? `${its} Name one of them, or add \`role ${role}\`.`
      : `${its} Write \`[${meant}]\`, or add \`role ${role}\`.`,
  );
}

function isSlot(part: PhraseDeclaration['parts'][number]): part is PhraseSlot {
  return part.kind === 'phrase-slot';
}

/** A phrase as it means, for telling two apart: its words as words and its slots by role. */
function meaningOf(phrase: PhraseDeclaration): string {
  return phrase.parts
    .map((part) => (part.kind === 'phrase-slot' ? `[${part.role.text}]` : part.text))
    .join(' ');
}

// --- the second tier: every verb the bundle declares ------------------------

/** The verbs whose behaviour is the engine's (the spec's Engine verbs), in its order. */
export const ENGINE_VERBS: readonly string[] = [
  'go',
  'look',
  'examine',
  'inventory',
  'wait',
  'help',
];

/** The one verb whose role an exit may fill (the spec's Exits). */
const GO = 'go';

/** What fills a role, resolved against the bundle's kinds. */
export type RoleFiller =
  | { readonly fills: 'kind'; readonly kind: KindRef }
  /** Nothing was written: anything that plays it, bound as an object. */
  | { readonly fills: 'open' }
  | { readonly fills: 'symbol' }
  | { readonly fills: 'integer' }
  /** An exit that applies, by its direction or its label: on the standard library's `go` alone. */
  | { readonly fills: 'exit' };

/** A run of words, or a slot by the index of the role it fills in its verb's `roles`. */
export type ResolvedPhrasePart =
  | { readonly part: 'words'; readonly text: string }
  | { readonly part: 'slot'; readonly role: number };

/** One way a visitor may type a verb. */
export interface ResolvedPhrase {
  /** What the quotes mean, after escapes. */
  readonly text: string;
  readonly parts: readonly ResolvedPhrasePart[];
  readonly declaration: PhraseDeclaration;
}

/** One role of a verb, as a body that plays it and a phrase that fills it read it. */
export interface ResolvedRole {
  readonly name: string;
  /** What fills it; null where the kind it names is absent or could not be one, and then nothing does. */
  readonly filler: RoleFiller | null;
  /** A set role (the spec's Set roles): never optional, since the empty set is already an answer. */
  readonly many: boolean;
  /** Whether a body may find it unbound, and so reads it only under `if (bound …)` (Optional tools). */
  readonly optional: boolean;
  /** The first phrase that leaves out an optional role, for a refusal to name; null where none does. */
  readonly omittedBy: ResolvedPhrase | null;
  readonly declaration: RoleDeclaration;
}

/** A verb as the whole bundle sees it: whose it is, what it is called, its roles and phrases. */
export interface ResolvedVerb {
  readonly library: string;
  readonly name: string;
  /** In the order declared, which is the order they are asked in; the first is the target. */
  readonly roles: readonly ResolvedRole[];
  readonly phrases: readonly ResolvedPhrase[];
  readonly declaration: VerbDeclaration;
}

/** What resolving a verb reads: every kind, composed, and every enum, to name one a role may not. */
export interface VerbContext {
  readonly kinds: KindSource;
  readonly enums: EnumTable;
  readonly diagnostics: Diagnostics;
  /**
   * Told of a kind in a role nothing declares. A compile at load makes it
   * a gap under the absent table's `kind-in-role` row; with none it is
   * refused.
   */
  readonly onUnknownKind?: OnUnknown;
}

/** The verbs a bundle declares, found by name as a body or a command names one. */
export interface VerbLookup {
  /** A verb by its full identity: `sprout.take` is not `ericworld.take`. */
  qualified(library: string, name: string): ResolvedVerb | null;
  /** A verb written without a library: the asking world's own first, then `sprout`'s. */
  unqualified(name: string, from: string): ResolvedVerb | null;
}

/** Every verb the bundle declares, by library and name. */
export class VerbTable implements VerbLookup {
  private readonly byQualified = new Map<string, ResolvedVerb>();

  /**
   * Add a library's declarations, resolving each one's roles and
   * phrases. Kinds must already be composed. Two verbs of one name in
   * one library collide, and only the standard library may declare an
   * engine verb's name (the spec's Reserved names).
   */
  add(library: string, declarations: readonly VerbDeclaration[], context: VerbContext): void {
    const { diagnostics } = context;
    for (const declared of declarations) {
      const name = declared.name.text;
      if (library !== SPROUT && ENGINE_VERBS.includes(name)) {
        diagnostics.refuse(
          declared.name.at,
          `\`${name}\` is one of the engine's verbs, and only the standard library declares those.`,
          `The engine answers ${readable(ENGINE_VERBS)} itself. Give yours another name.`,
        );
        continue;
      }
      const key = qualifiedName(library, name);
      if (this.byQualified.has(key)) {
        diagnostics.refuse(
          declared.name.at,
          `${library} declares two verbs called \`${name}\`.`,
          'Give one of them another name, or remove it.',
        );
        continue;
      }
      this.byQualified.set(key, resolveVerb(library, declared, context));
    }
  }

  /** A verb by its full identity: `sprout.take` is not `ericworld.take`. */
  qualified(library: string, name: string): ResolvedVerb | null {
    return this.byQualified.get(qualifiedName(library, name)) ?? null;
  }

  /** A verb written without a library: the asking world's own first, then `sprout`'s. */
  unqualified(name: string, from: string): ResolvedVerb | null {
    return this.qualified(from, name) ?? this.qualified(SPROUT, name);
  }

  /** Every verb in the bundle, in the order it was added. */
  all(): ResolvedVerb[] {
    return [...this.byQualified.values()];
  }
}

/** One verb, resolved in the library that declared it. */
function resolveVerb(
  library: string,
  declared: VerbDeclaration,
  context: VerbContext,
): ResolvedVerb {
  // A role declared twice was refused by the first tier; a slot names the first.
  const index = new Map<string, number>();
  declared.roles.forEach((role, at) => {
    if (!index.has(role.name.text)) index.set(role.name.text, at);
  });
  const phrases = declared.phrases.map((phrase): ResolvedPhrase => ({
    text: phrase.text,
    parts: phrase.parts.flatMap((part): ResolvedPhrasePart[] => {
      if (part.kind === 'phrase-words') return [{ part: 'words', text: part.text }];
      const role = index.get(part.role.text);
      // A slot naming no role was refused by the first tier.
      return role === undefined ? [] : [{ part: 'slot', role }];
    }),
    declaration: phrase,
  }));
  const roles = declared.roles.map((role, at): ResolvedRole => {
    const leftOutBy =
      phrases.find((phrase) => !phrase.parts.some((p) => p.part === 'slot' && p.role === at)) ??
      null;
    const optional = isOptional(role, declared, leftOutBy);
    return {
      name: role.name.text,
      filler: roleFiller(library, declared, role, context),
      many: role.many !== null,
      optional,
      omittedBy: optional ? leftOutBy : null,
      declaration: role,
    };
  });
  return { library, name: declared.name.text, roles, phrases, declaration: declared };
}

/**
 * Whether a body may find a role unbound (the spec's Optional tools, Set
 * roles, Value roles): a set role never; a value role always, since what
 * a visitor types is never one of a closed set until it has been
 * checked; any other role when some phrase leaves it out, or, on a verb
 * with no phrases, when it is written `optional`.
 */
function isOptional(
  role: RoleDeclaration,
  declared: VerbDeclaration,
  leftOutBy: ResolvedPhrase | null,
): boolean {
  if (role.many !== null) return false;
  const filler = role.filler;
  if (filler?.kind === 'value-filler' && filler.value !== 'exit') return true;
  if (declared.phrases.length === 0) return role.optional !== null;
  return leftOutBy !== null;
}

/** What fills a role, or null having said why nothing does. */
function roleFiller(
  library: string,
  declared: VerbDeclaration,
  role: RoleDeclaration,
  context: VerbContext,
): RoleFiller | null {
  const filler = role.filler;
  if (filler === null) return { fills: 'open' };
  if (filler.kind === 'kind-expr') return kindFiller(library, role, filler, context);
  if (filler.value !== 'exit') return { fills: filler.value };
  if (library === SPROUT && declared.name.text === GO) return { fills: 'exit' };
  context.diagnostics.refuse(
    filler.at,
    "`exit` fills a role only on the engine's `go`.",
    'A role is filled by a kind (`role target: Container`), by `symbol` or `integer` for a value the visitor names, or by nothing.',
  );
  return null;
}

/**
 * The kind a role names, read from inside `library` as a composition
 * reads it. One declared that could not be composed has been said where
 * it was declared; an enum is refused, since a role-player says which
 * options it hears; one nothing declares is `onUnknownKind`'s.
 */
function kindFiller(
  library: string,
  role: RoleDeclaration,
  written: KindExpr,
  context: VerbContext,
): RoleFiller | null {
  const { kinds, enums, diagnostics } = context;
  const identity = identityOf(written, library, kinds);
  const found = kinds.find(identity);
  if (found.found === 'kind') return { fills: 'kind', kind: found.kind };
  if (kinds.declares(identity)) return null;

  const name = written.name.text;
  const anEnum =
    written.library === null
      ? enums.unqualified(name, library)
      : enums.qualified(written.library.text, name);
  if (anEnum !== null) {
    diagnostics.refuse(
      written.at,
      `\`${writtenKind(written)}\` is an enum, and a role is not filled by one.`,
      `Write \`role ${role.name.text}: symbol\`. The object that plays the role says which options it hears with \`${role.name.text} from :<property>\`, a property holding a list of \`${writtenKind(written)}\`.`,
    );
    return null;
  }
  const { message, remedy } = unknownKind(written, library, kinds);
  if (context.onUnknownKind !== undefined) context.onUnknownKind(written, message, remedy);
  else diagnostics.refuse(written.at, message, remedy);
  return null;
}
