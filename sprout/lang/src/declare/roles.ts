// The roles a kind plays: `as <role> for <verb>` as a member, resolved
// against the verbs the bundle declares and composed (the spec's Verbs ›
// Playing a role, The actor's own part, Roles compose, A role-player
// narrows its own options; Kinds › How members combine, the row "`as
// <role> for <verb>`: all `permit` run, any refusal decides; all `do`
// run").
//
// A play names its verb bare, and the verb it reaches is the one its
// kind's library would reach: the library's own, else the standard
// library's. Composing needs only which verbs exist and the roles each
// declares, which `VerbNames` answers from the declarations before any
// kind is composed; what fills a role is the `VerbTable`'s, and the
// checker's to read. Every play of one role in one verb runs, in closure
// order, the composer's own last.

import type { FromDeclaration, KindMember, PlayDeclaration } from '../syntax/ast.js';
import type { RoleDeclaration, VerbDeclaration } from '../syntax/ast-verbs.js';
import type { Diagnostics } from '../source/diagnostics.js';
import type { Span } from '../source/source.js';
import { readable } from '../source/words.js';
import { nearestOption, qualifiedName, SPROUT } from './enums.js';
import type { Suppression } from './kinds.js';
import type { ResolvedProperty } from './properties.js';
import { composeContributions } from './contributions.js';
import { ENGINE_VERBS } from './verbs.js';

/** The role every verb has besides the ones it declares: whoever is acting (The actor's own part). */
export const ACTOR_ROLE = 'actor';

/**
 * What a role-player's `from` narrows a value role by: a property it
 * holds, or a range written out.
 */
export type RoleNarrowing =
  | { readonly narrows: 'property'; readonly property: ResolvedProperty; readonly at: Span }
  | {
      readonly narrows: 'range';
      readonly min: number;
      readonly max: number;
      readonly at: Span;
    };

/** A verb by its full identity: `sprout.take` is not `ericworld.take`. */
export interface VerbIdentity {
  readonly library: string;
  readonly name: string;
}

/** A verb as composing reads it: whose it is, and its declaration, roles and all. */
export interface NamedVerb {
  readonly library: string;
  readonly declaration: VerbDeclaration;
}

/**
 * Which verbs the bundle declares, by library and name, read from the
 * declarations alone. It keeps the verbs the `VerbTable` keeps: the first
 * of two of one name in a library, and an engine verb's name only in the
 * standard library.
 */
export class VerbNames {
  private readonly byQualified = new Map<string, NamedVerb>();

  add(library: string, declarations: readonly VerbDeclaration[]): void {
    for (const declaration of declarations) {
      const name = declaration.name.text;
      if (library !== SPROUT && ENGINE_VERBS.includes(name)) continue;
      const key = qualifiedName(library, name);
      if (!this.byQualified.has(key)) this.byQualified.set(key, { library, declaration });
    }
  }

  /** A verb written without a library, from inside `from`: its own first, then `sprout`'s. */
  unqualified(name: string, from: string): NamedVerb | null {
    return (
      this.byQualified.get(qualifiedName(from, name)) ??
      this.byQualified.get(qualifiedName(SPROUT, name)) ??
      null
    );
  }

  /** The names a bare verb may be from inside `from`, for a guess at a misspelling. */
  named(from: string): string[] {
    const names = [...this.byQualified.values()]
      .filter((verb) => verb.library === from || verb.library === SPROUT)
      .map((verb) => verb.declaration.name.text);
    return [...new Set(names)];
  }
}

/** One kind's play of one role in one verb, as a composed kind runs it. */
export interface ResolvedPlay {
  /** The kind that wrote it, by qualified name; an object's or a world's own body is named for it. */
  readonly origin: string;
  /** The library of the verb it plays for. */
  readonly library: string;
  /** The verb's name, bare. */
  readonly verb: string;
  /** A role the verb declares, or `actor`. */
  readonly role: string;
  /** What each value role this body narrows is narrowed by, by the role's name. */
  readonly narrows: ReadonlyMap<string, RoleNarrowing>;
  readonly declaration: PlayDeclaration;
}

/** Every play a composed kind runs, by `playKey`, each list in run order. */
export type Plays = ReadonlyMap<string, readonly ResolvedPlay[]>;

/** A kind with no play anywhere in its closure. */
export const NO_PLAYS: Plays = new Map();

/** The key a kind's plays are held under: the role, and the verb by its full identity. */
export function playKey(library: string, verb: string, role: string): string {
  return `as ${role} for ${qualifiedName(library, verb)}`;
}

/** The plays a kind runs for one role of one verb, in run order. */
export function playsOf(
  plays: Plays,
  library: string,
  verb: string,
  role: string,
): readonly ResolvedPlay[] {
  return plays.get(playKey(library, verb, role)) ?? [];
}

/**
 * Told of a verb a play names that nothing declares, with the words to
 * say. A compile at load makes it a gap under the absent table's `verb`
 * row, the play dropped; with none it is refused.
 */
export type OnUnknownVerb = (written: PlayDeclaration, message: string, remedy: string) => void;

/** What resolving a composer's plays reads. */
export interface PlayContext {
  readonly verbs: VerbNames;
  readonly diagnostics: Diagnostics;
  readonly onUnknownVerb?: OnUnknownVerb;
}

/** The composer whose own plays are read: its library and its name as a message shows it. */
export interface PlayComposer {
  readonly library: string;
  readonly name: string;
}

/**
 * The plays a composer's own body writes, by `playKey`, with `origin` as
 * their origin. `properties` are what the composer holds, composed ones
 * included, which a `from` may name. What cannot be resolved is refused
 * and dropped.
 */
export function ownPlays(
  composer: PlayComposer,
  members: readonly KindMember[],
  origin: string,
  properties: ReadonlyMap<string, ResolvedProperty>,
  context: PlayContext,
): Map<string, ResolvedPlay> {
  const { verbs, diagnostics } = context;
  const own = new Map<string, ResolvedPlay>();
  for (const member of members) {
    if (member.kind !== 'play') continue;
    const { role, verb } = member.head;
    const named = verbs.unqualified(verb.text, composer.library);
    if (named === null) {
      unknownVerb(composer, member, context);
      continue;
    }
    const declared = named.declaration;
    if (role.text !== ACTOR_ROLE && !playable(declared, role.text, role.at, diagnostics)) continue;

    const key = playKey(named.library, verb.text, role.text);
    if (own.has(key)) {
      diagnostics.refuse(
        member.head.at,
        `\`${composer.name}\` plays \`${role.text}\` for \`${verb.text}\` twice.`,
        'Keep one, and write what both do in it.',
      );
      continue;
    }
    const narrows = narrowings(composer, member, declared, properties, diagnostics);
    if (narrows === null) continue;
    own.set(key, {
      origin,
      library: named.library,
      verb: verb.text,
      role: role.text,
      narrows,
      declaration: member,
    });
  }
  return own;
}

/**
 * The plays a composer runs: for each role of each verb, what its composed
 * kinds run, each origin once in closure order, less what its own
 * `suppressed` leaves out, then its own. `reach` says which verb a bare
 * name in one of its own `without` lines reaches, by its full identity.
 */
export function composePlays(
  composed: readonly Plays[],
  order: readonly string[],
  suppressed: readonly Suppression[],
  own: ReadonlyMap<string, ResolvedPlay>,
  reach: (verb: string) => VerbIdentity | null,
): Plays {
  const keys: string[] = [];
  for (const plays of composed)
    for (const key of plays.keys()) if (!keys.includes(key)) keys.push(key);
  for (const key of own.keys()) if (!keys.includes(key)) keys.push(key);
  const plays = new Map<string, readonly ResolvedPlay[]>();
  for (const key of keys) {
    const runs = composeContributions(
      composed.map((one) => one.get(key) ?? []),
      order,
      suppressed,
      own.get(key),
      (suppression, play) => leavesOut(suppression, play, reach),
    );
    if (runs.length > 0) plays.set(key, runs);
  }
  return plays;
}

/** Whether a kind's plays include one of `role` for a verb that `origin` wrote itself. */
export function writesPlay(
  plays: Plays,
  library: string,
  verb: string,
  role: string,
  origin: string,
): boolean {
  return playsOf(plays, library, verb, role).some((play) => play.origin === origin);
}

/** Whether a suppression leaves out `play`. */
function leavesOut(
  suppression: Suppression,
  play: ResolvedPlay,
  reach: (verb: string) => VerbIdentity | null,
): boolean {
  const { member, source } = suppression;
  return (
    member.kind === 'role-ref' &&
    source === play.origin &&
    member.role.text === play.role &&
    sameVerb(reach(member.verb.text), play)
  );
}

/** Whether a verb reached is the one a play is for. */
function sameVerb(reached: VerbIdentity | null, play: ResolvedPlay): boolean {
  return reached !== null && reached.library === play.library && reached.name === play.verb;
}

/** A play naming a verb nothing declares, said with the verb it most likely meant. */
function unknownVerb(composer: PlayComposer, play: PlayDeclaration, context: PlayContext): void {
  const { role, verb } = play.head;
  const meant = nearestOption(verb.text, context.verbs.named(composer.library));
  const message = `\`${composer.name}\` plays \`${role.text}\` for \`${verb.text}\`, and nothing declares that verb.${
    meant === null ? '' : ` Did you mean \`${meant}\`?`
  }`;
  const remedy =
    meant === null
      ? `Declare it with \`verb ${verb.text} { … }\`, or check the spelling of a verb this world or a library it uses declares.`
      : `Write \`as ${role.text} for ${meant}\`, or declare \`verb ${verb.text} { … }\`.`;
  if (context.onUnknownVerb !== undefined) context.onUnknownVerb(play, message, remedy);
  else context.diagnostics.refuse(verb.at, message, remedy);
}

/**
 * Whether the role a play names is one the verb declares and something
 * can play: a value or an exit is named by the visitor, not played.
 */
function playable(
  declared: VerbDeclaration,
  role: string,
  at: Span,
  diagnostics: Diagnostics,
): boolean {
  const verb = declared.name.text;
  const found = declared.roles.find((one) => one.name.text === role);
  if (found === undefined) {
    unknownRole(declared, role, at, diagnostics, 'head');
    return false;
  }
  const value = found.filler?.kind === 'value-filler' ? found.filler.value : null;
  if (value === null) return true;
  diagnostics.refuse(
    at,
    `\`${role}\` is filled by ${value === 'exit' ? 'an exit' : 'a value the visitor names'}, so nothing plays it.`,
    value === 'exit'
      ? `Play \`actor\` for \`${verb}\` instead.`
      : `Play \`actor\` or another role of \`${verb}\`, and narrow \`${role}\` in its body with \`${role} from :<property>\`.`,
  );
  return false;
}

/** A role the verb does not declare, in a play's head or a `from`, said with the ones it does. */
function unknownRole(
  declared: VerbDeclaration,
  role: string,
  at: Span,
  diagnostics: Diagnostics,
  where: 'head' | 'from',
): void {
  const verb = declared.name.text;
  const names = declared.roles.map((one: RoleDeclaration) => one.name.text);
  if (names.length === 0) {
    diagnostics.refuse(
      at,
      `\`${verb}\` has no roles, so only the actor plays it.`,
      where === 'head' ? `Write \`as actor for ${verb}\`.` : 'Take this line out.',
    );
    return;
  }
  const meant = nearestOption(role, names);
  const actor = `, or \`as actor for ${verb}\` to play whoever is acting`;
  diagnostics.refuse(
    at,
    `\`${verb}\` has no role \`${role}\`. Its ${names.length === 1 ? 'role is' : 'roles are'} ${readable(names)}.`,
    where === 'head'
      ? `Write \`as ${meant ?? '<one of them>'} for ${verb}\`${actor}.`
      : `Write \`${meant ?? '<one of them>'} from :<property>\`.`,
  );
}

/**
 * What a play's `from` lines narrow, by role: each names a role the verb
 * declares, once, and a property the composer holds that is not
 * remembered, or a range. Whether the role is a value role, and whether
 * the property holds what it needs, is the checker's. Null having said
 * why, where any line is refused.
 */
function narrowings(
  composer: PlayComposer,
  play: PlayDeclaration,
  declared: VerbDeclaration,
  properties: ReadonlyMap<string, ResolvedProperty>,
  diagnostics: Diagnostics,
): Map<string, RoleNarrowing> | null {
  const narrows = new Map<string, RoleNarrowing>();
  let whole = true;
  for (const line of play.narrows) {
    const role = line.role.text;
    if (!declared.roles.some((one) => one.name.text === role)) {
      unknownRole(declared, role, line.role.at, diagnostics, 'from');
      whole = false;
      continue;
    }
    if (narrows.has(role)) {
      diagnostics.refuse(
        line.role.at,
        `\`${role}\` is narrowed twice in \`as ${play.head.role.text} for ${play.head.verb.text}\`.`,
        `Keep one \`${role} from …\`.`,
      );
      whole = false;
      continue;
    }
    const narrowing = narrowingOf(composer, line, properties, diagnostics);
    if (narrowing === null) whole = false;
    else narrows.set(role, narrowing);
  }
  return whole ? narrows : null;
}

/** One `from` line's narrowing, or null having said why it has none. */
function narrowingOf(
  composer: PlayComposer,
  line: FromDeclaration,
  properties: ReadonlyMap<string, ResolvedProperty>,
  diagnostics: Diagnostics,
): RoleNarrowing | null {
  const by = line.by;
  if (by.kind === 'integer-range') {
    return { narrows: 'range', min: by.min.value, max: by.max.value, at: line.at };
  }
  const name = by.name.text;
  const property = properties.get(name);
  if (property === undefined) {
    const meant = nearestOption(name, [...properties.keys()]);
    diagnostics.refuse(
      by.at,
      `\`${composer.name}\` has no property \`:${name}\`.${meant === null ? '' : ` Did you mean \`:${meant}\`?`}`,
      meant === null
        ? `Name a property \`${composer.name}\` holds, or declare \`:${name}\` in it.`
        : `Write \`${line.role.text} from :${meant}\`.`,
    );
    return null;
  }
  if (property.remembered) {
    diagnostics.refuse(
      by.at,
      `\`:${name}\` is remembered about each actor, and \`from\` names what \`${composer.name}\` itself holds.`,
      'Name a property declared without `:remembers`.',
    );
    return null;
  }
  return { narrows: 'property', property, at: line.at };
}
