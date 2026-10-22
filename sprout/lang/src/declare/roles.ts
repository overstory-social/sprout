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
//
// `as target for any` and `as tool for any` play every verb at once, by
// the category of the role the object fills: the target, the first role,
// or a tool, any other; `as actor for any` plays the actor's own part of
// every verb (the spec's Roles compose). `except` names verbs one does not
// run for. A wildcard only permits, so it holds a `permit` and nothing
// else; for a participant, its wildcard plays run before the ones for the
// verb.
//
// A play written `default` steps aside, `permit` and `do` alike, in any
// kind where another source's play of its role in its verb meets it, and
// stays out of every kind composing that one, as a `without` would leave
// it out (Kinds › How members combine). Where only defaults meet, the
// composer's own replaces the rest, and two others are refused.

import type {
  FromDeclaration,
  Ident,
  KindExpr,
  KindMember,
  PlayDeclaration,
} from '../syntax/ast.js';
import type { RoleDeclaration, VerbDeclaration } from '../syntax/ast-verbs.js';
import type { Diagnostics } from '../source/diagnostics.js';
import type { Span } from '../source/source.js';
import { readable } from '../source/words.js';
import { lookingFrom, nearestOption, qualifiedName, SPROUT, type DeclaredEnum } from './enums.js';
import type { Suppression } from './kinds.js';
import type { ResolvedProperty } from './properties.js';
import { composeContributions, composedWhereSame } from './contributions.js';
import { ENGINE_VERBS } from './verbs.js';

/** The role every verb has besides the ones it declares: whoever is acting (The actor's own part). */
export const ACTOR_ROLE = 'actor';

/** The word after `for` that plays every verb at once (the spec's Roles compose). */
export const ANY_VERB = 'any';

/** What a wildcard plays: the target, a reading's first role, or a tool, any other. */
export type Category = 'target' | 'tool';

/** What a wildcard plays: a category of role, or the actor's own part. */
export type Wildcard = Category | typeof ACTOR_ROLE;

/** The category of `role` in a verb whose roles are `roles`, in order. */
export function categoryOf(roles: readonly { readonly name: string }[], role: string): Category {
  return roles[0]?.name === role ? 'target' : 'tool';
}

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
      this.byQualified.get(qualifiedName(lookingFrom(from), name)) ??
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
  /** The library of the verb it plays for; for a wildcard, the composer's. */
  readonly library: string;
  /** The verb's name, bare; `any` for a wildcard. */
  readonly verb: string;
  /** A role the verb declares, or `actor`; for a wildcard, its category. */
  readonly role: string;
  /** Whether it plays every verb at once: `as target for any`, `as tool for any` or `as actor for any`. */
  readonly any: boolean;
  /** For a wildcard, the verbs its `except` names, which it does not run for; absent where it names none. */
  readonly except?: readonly VerbIdentity[];
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

/** The key a kind's wildcard plays of one part are held under. */
export function anyKey(part: Wildcard): string {
  return `as ${part} for ${ANY_VERB}`;
}

/** The wildcard plays a kind runs for `part`, in run order, whatever their `except` names. */
export function anyPlaysOf(plays: Plays, part: Wildcard): readonly ResolvedPlay[] {
  return plays.get(anyKey(part)) ?? [];
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
 * The enums whose options a `from` hears for `role` of `verb`, through any
 * part any of `plays` holds in it, each once: the options an `act` may give
 * that role and have it bound (the spec's A role-player narrows its own options).
 */
export function heardEnums(
  plays: readonly Plays[],
  verb: {
    readonly library: string;
    readonly name: string;
    readonly roles: readonly { readonly name: string }[];
  },
  role: string,
): DeclaredEnum[] {
  const parts = [ACTOR_ROLE, ...verb.roles.map((one) => one.name)];
  const heard = new Set<DeclaredEnum>();
  for (const held of plays) {
    for (const part of parts) {
      for (const play of playsOf(held, verb.library, verb.name, part)) {
        const narrowing = play.narrows.get(role);
        if (narrowing?.narrows !== 'property') continue;
        const type = narrowing.property.type;
        if (type.type === 'list' && type.element.type === 'symbol') heard.add(type.element.of);
      }
    }
  }
  return [...heard];
}

/**
 * Told of a verb a play names that nothing declares, in its head or its
 * `except`, with the words to say. A compile at load makes it a gap under
 * the absent table's `verb` row, the play dropped, or the name left out of
 * the `except`; with none it is refused.
 */
export type OnUnknownVerb = (written: Ident, message: string, remedy: string) => void;

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
    if (verb.text === ANY_VERB) {
      const part = wildcardOf(member, diagnostics);
      if (part === null) continue;
      const except = exceptions(composer, member, part, context);
      if (except === null) continue;
      const key = anyKey(part);
      if (own.has(key)) {
        diagnostics.refuse(
          member.head.at,
          `\`${composer.name}\` plays \`${part}\` for \`any\` twice.`,
          'Keep one, and write what both decide in its `permit`.',
        );
        continue;
      }
      own.set(key, {
        origin,
        library: composer.library,
        verb: ANY_VERB,
        role: part,
        any: true,
        ...(except.length === 0 ? {} : { except }),
        narrows: new Map(),
        declaration: member,
      });
      continue;
    }
    const named = verbs.unqualified(verb.text, composer.library);
    if (named === null) {
      const said = `\`${composer.name}\` plays \`${role.text}\` for \`${verb.text}\``;
      unknownVerb(verb, said, `as ${role.text} for`, composer, context);
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
      any: false,
      narrows,
      declaration: member,
    });
  }
  return own;
}

/**
 * The part a wildcard plays, or null having said why it cannot be
 * played: its head names a category or the actor, and its body only
 * permits, since what a thing does belongs to a verb, and narrows
 * nothing, since it knows no verb's value roles.
 */
function wildcardOf(play: PlayDeclaration, diagnostics: Diagnostics): Wildcard | null {
  const { role } = play.head;
  if (role.text !== 'target' && role.text !== 'tool' && role.text !== ACTOR_ROLE) {
    diagnostics.refuse(
      role.at,
      `\`as ${role.text} for any\` names a role, and \`for any\` plays every verb at once, so it names what kind of role instead: \`target\`, \`tool\` or \`actor\`.`,
      `Write \`as target for any\` for the thing a verb is done to, \`as tool for any\` for any other role, \`as actor for any\` for whoever is acting, or name the verb: \`as ${role.text} for <verb>\`.`,
    );
    return null;
  }
  let whole = true;
  if (play.do !== null) {
    diagnostics.refuse(
      play.do.at,
      `\`as ${role.text} for any\` holds a \`do\`, and what a thing does belongs to a verb; a play for every verb only permits.`,
      `Move the \`do\` into \`as ${role.text} for <verb> { do { … } }\` for the verb it belongs to, and keep the \`permit\` here.`,
    );
    whole = false;
  }
  if (play.yields === true) {
    diagnostics.refuse(
      play.head.at,
      `\`as ${role.text} for any\` is written \`default\`, and only a play for one verb steps aside for another source's play of it.`,
      `Take out \`default\`, or write \`as ${role.text === ACTOR_ROLE ? ACTOR_ROLE : '<role>'} for <verb> default { … }\` for the verb whose answer should step aside.`,
    );
    whole = false;
  }
  for (const line of play.narrows) {
    diagnostics.refuse(
      line.at,
      `\`as ${role.text} for any\` narrows \`${line.role.text}\`, and a play for every verb knows no verb's roles.`,
      `Narrow it in \`as ${role.text} for <verb>\`, for the verb that declares \`${line.role.text}\`.`,
    );
    whole = false;
  }
  return whole ? role.text : null;
}

/**
 * The verbs a wildcard's `except` names, each resolved as a play's head
 * resolves its verb, or null having said why one cannot be left out: it
 * is named twice, or `part` never plays it, since the verb has no such
 * role. A verb nothing declares is refused, or at load is a gap and left
 * out of the list, since there are no readings of it to leave out.
 */
function exceptions(
  composer: PlayComposer,
  play: PlayDeclaration,
  part: Wildcard,
  context: PlayContext,
): VerbIdentity[] | null {
  const { verbs, diagnostics } = context;
  const written = `as ${part} for any`;
  const except: VerbIdentity[] = [];
  let whole = true;
  for (const name of play.except ?? []) {
    const named = verbs.unqualified(name.text, composer.library);
    if (named === null) {
      const said = `\`${composer.name}\` leaves \`${name.text}\` out of \`${written}\``;
      if (!unknownVerb(name, said, `${written} except`, composer, context)) whole = false;
      continue;
    }
    const identity = { library: named.library, name: name.text };
    if (except.some((one) => one.library === identity.library && one.name === identity.name)) {
      diagnostics.refuse(
        name.at,
        `\`${written}\` leaves out \`${name.text}\` twice.`,
        `Name \`${name.text}\` once after \`except\`.`,
      );
      whole = false;
      continue;
    }
    const roles = named.declaration.roles.length;
    const never = part === 'target' ? roles === 0 : part === 'tool' ? roles < 2 : false;
    if (never) {
      diagnostics.refuse(
        name.at,
        `\`${name.text}\` has no ${part === 'target' ? 'roles' : 'role but its target'}, so \`${written}\` never runs for it and has nothing to leave out.`,
        `Take \`${name.text}\` out of the \`except\` list.`,
      );
      whole = false;
      continue;
    }
    except.push(identity);
  }
  return whole ? except : null;
}

/** Whether a play was written `default`, and so steps aside for another source's. */
function yieldsPlay(play: ResolvedPlay): boolean {
  return play.declaration.yields === true;
}

/** The composer whose plays are composed: its name, its composed kinds as written, and how a kind is shown from it. */
export interface PlaysComposer {
  readonly name: string;
  readonly written: readonly KindExpr[];
  shown(identity: string): string;
}

/**
 * The plays a composer runs: for each role of each verb, what its composed
 * kinds run, each origin once in closure order, less what its own
 * `suppressed` leaves out, then its own, and less the defaults that step
 * aside. `reach` says which verb a bare name in one of its own `without`
 * lines reaches, by its full identity. `composed` and `composer.written`
 * are in the order the composition list writes them.
 */
export function composePlays(
  composer: PlaysComposer,
  composed: readonly Plays[],
  order: readonly string[],
  suppressed: readonly Suppression[],
  own: ReadonlyMap<string, ResolvedPlay>,
  reach: (verb: string) => VerbIdentity | null,
  diagnostics: Diagnostics,
): Plays {
  const keys: string[] = [];
  for (const plays of composed)
    for (const key of plays.keys()) if (!keys.includes(key)) keys.push(key);
  for (const key of own.keys()) if (!keys.includes(key)) keys.push(key);
  const plays = new Map<string, readonly ResolvedPlay[]>();
  for (const key of keys) {
    const mine = own.get(key);
    const runs = composeContributions(
      composed.map((one) => one.get(key) ?? []),
      order,
      suppressed,
      mine,
      (suppression, play) => leavesOut(suppression, play, reach),
    );
    const left = stepAside(composer, composed, key, runs, mine, diagnostics);
    if (left.length > 0) plays.set(key, left);
  }
  return composedWhereSame(plays, composed);
}

/**
 * What runs of one key once its defaults step aside: every play but the
 * defaults where any play is not one; else the composer's own default
 * alone where it writes one; else the one default that arrived. A
 * composer's own default that a composed play displaces never runs, and
 * two composed defaults with nothing else beside them are two answers to
 * one question: both are refused, and the first kept.
 */
function stepAside(
  composer: PlaysComposer,
  composed: readonly Plays[],
  key: string,
  runs: readonly ResolvedPlay[],
  mine: ResolvedPlay | undefined,
  diagnostics: Diagnostics,
): readonly ResolvedPlay[] {
  if (!runs.some(yieldsPlay)) return runs;
  const answering = runs.filter((play) => !yieldsPlay(play));
  if (answering.length > 0) {
    if (mine !== undefined && yieldsPlay(mine)) {
      const by = readable(answering.map((play) => composer.shown(play.origin)));
      const written = `as ${mine.role} for ${mine.verb}`;
      diagnostics.refuse(
        mine.declaration.head.at,
        `\`${composer.name}\`'s own \`${written} default\` never runs: ${by} ${answering.length === 1 ? 'plays' : 'play'} \`${mine.role}\` for \`${mine.verb}\` in it, and a default steps aside for any other play.`,
        `Take out \`default\` to run it beside ${answering.length === 1 ? 'that one' : 'them'}, or leave ${answering.length === 1 ? 'that one' : 'them'} out with \`without ${written} from ${composer.shown(answering[0]!.origin)}\` to answer in its place.`,
      );
    }
    return answering;
  }
  if (mine !== undefined) return runs.length === 1 ? runs : [mine];
  if (runs.length > 1) {
    const second = runs[1]!;
    const through = composed.findIndex((plays) =>
      (plays.get(key) ?? []).some((play) => play.origin === second.origin),
    );
    const at = composer.written[through]?.at ?? second.declaration.head.at;
    const written = `as ${second.role} for ${second.verb}`;
    const from = readable(runs.map((play) => composer.shown(play.origin)));
    diagnostics.refuse(
      at,
      `\`${composer.name}\` gets a default \`${written}\` from ${runs.length === 2 ? `both ${from}` : from}, and a default steps aside only for a play that is not one, so ${runs.length === 2 ? 'both' : 'all'} would answer.`,
      `Write its own \`${written} { … }\` in \`${composer.name}\`, which the defaults step aside for, or its own \`${written} default { … }\`, which replaces them, or leave one out with \`without ${written} from ${composer.shown(second.origin)}\`.`,
    );
    return [runs[0]!];
  }
  return runs;
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
  if (member.kind !== 'role-ref' || source !== play.origin || member.role.text !== play.role) {
    return false;
  }
  if (play.any) return member.verb.text === ANY_VERB;
  return member.verb.text !== ANY_VERB && sameVerb(reach(member.verb.text), play);
}

/** Whether a verb reached is the one a play is for. */
function sameVerb(reached: VerbIdentity | null, play: ResolvedPlay): boolean {
  return reached !== null && reached.library === play.library && reached.name === play.verb;
}

/**
 * A verb a play names that nothing declares, said as `said` (what the
 * composer wrote) with the verb it most likely meant, written after
 * `lead`. Returns whether it is a gap rather than a refusal.
 */
function unknownVerb(
  verb: Ident,
  said: string,
  lead: string,
  composer: PlayComposer,
  context: PlayContext,
): boolean {
  const meant = nearestOption(verb.text, context.verbs.named(composer.library));
  const message = `${said}, and nothing declares that verb.${
    meant === null ? '' : ` Did you mean \`${meant}\`?`
  }`;
  const remedy =
    meant === null
      ? `Declare it with \`verb ${verb.text} { … }\`, or check the spelling of a verb this world or a library it uses declares.`
      : `Write \`${lead} ${meant}\`, or declare \`verb ${verb.text} { … }\`.`;
  if (context.onUnknownVerb !== undefined) {
    context.onUnknownVerb(verb, message, remedy);
    return true;
  }
  context.diagnostics.refuse(verb.at, message, remedy);
  return false;
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
      'Name a property declared outside a `remembers` block.',
    );
    return null;
  }
  return { narrows: 'property', property, at: line.at };
}
