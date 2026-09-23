// Composing a kind (the spec's Kinds, composition and libraries › How
// members combine, Suppressing a contribution, Properties merge; they
// never shadow). One function composes a written composition list and a
// body into a `KindRef`, for a kind, for an object's anonymous kind and
// for the world, which composes like a kind (The world model).
//
// Three rules hold here. The closure is walked depth-first, left to
// right, each kind at its first appearance and the composer last, and
// that is the order composable members run in. A property is one slot
// per name: one origin reached by several paths is one property, two
// origins are refused unless the composer restates it, and a restatement
// keeps the type. `contains` and `contains actors` are idempotent, so
// they are OR'd over the closure. A passage is one per name, which
// `passages.ts` resolves: the composer's own, else the one source that
// is not `default`, else the one default. Guards and plays all run, in
// closure order less what `without` leaves out, which `guards.ts` and
// `roles.ts` resolve; a suppression travels to every kind that composes
// the one that wrote it.

import {
  writtenMember,
  type KindExpr,
  type KindMember,
  type MemberRef,
  type PropertyDeclaration,
  type WithoutDeclaration,
} from '../syntax/ast.js';
import type { Diagnostics } from '../source/diagnostics.js';
import { nearestOption, qualifiedName, shownName, SPROUT, type EnumTable } from './enums.js';
import type { KindRef, Suppression } from './kinds.js';
import { refuseComposingWorld, WORLD, writesWorld } from './sprout-world.js';
import {
  resolveProperty,
  restatementOf,
  restateProperty,
  type ResolvedProperty,
} from './properties.js';
import { identicalType, showType } from './types.js';
import { ownPassages, passageArrivals, resolvePassages } from './passages.js';
import { composeGuards, ownGuards, writesGuard } from './guards.js';
import {
  composePlays,
  ownPlays,
  VerbNames,
  writesPlay,
  type OnUnknownVerb,
  type VerbIdentity,
} from './roles.js';

/** What looking up a composed kind finds. */
export type Found =
  | { readonly found: 'kind'; readonly kind: KindRef }
  /** Nothing in the bundle is declared under that identity. */
  | { readonly found: 'unknown' }
  /** It is declared and could not be composed, which has been said already. */
  | { readonly found: 'failed' }
  /** It is being composed right now, so composing it again closes a loop through these. */
  | { readonly found: 'cycle'; readonly through: readonly string[] };

/** Where a composition's kinds are looked up, by qualified name. */
export interface KindSource {
  /** Whether a kind of this identity is declared, composed or not. */
  declares(identity: string): boolean;
  /** The names of the kinds a library declares, for a guess at a misspelling. */
  named(library: string): readonly string[];
  find(identity: string): Found;
}

/**
 * Told of a composed kind nothing declares, with the words to say. A
 * compile at load makes it a gap under the absent table's
 * `kind-in-composition` row; with none it is refused.
 */
export type OnUnknown = (written: KindExpr, message: string, remedy: string) => void;

/** What is being composed: a kind, an object's anonymous kind named for the object, or the world. */
export interface Composer {
  /** The library it is declared in, which is also where its written names are read from. */
  readonly library: string;
  readonly name: string;
  readonly composes: readonly KindExpr[];
  readonly members: readonly KindMember[];
  /** Whether it may compose `sprout.World`, which only the world may. */
  readonly mayComposeWorld?: boolean;
}

export interface ComposeContext {
  readonly enums: EnumTable;
  readonly kinds: KindSource;
  readonly diagnostics: Diagnostics;
  readonly onUnknown?: OnUnknown;
  /** The verbs a play may name; with none, every play names a verb nothing declares. */
  readonly verbs?: VerbNames;
  readonly onUnknownVerb?: OnUnknownVerb;
}

/**
 * The qualified name a written kind stands for, read from inside `from`:
 * as written when it names its library, else `from`'s own kind of that
 * name, else the standard library's (the spec's Libraries and
 * namespaces). Whether anything is declared there is a separate question.
 */
export function identityOf(written: KindExpr, from: string, kinds: KindSource): string {
  if (written.library !== null) return qualifiedName(written.library.text, written.name.text);
  const own = qualifiedName(from, written.name.text);
  return kinds.declares(own) ? own : qualifiedName(SPROUT, written.name.text);
}

/**
 * What is said of a kind nothing declares, read from inside `from`, with
 * the kind it most likely meant where one is close enough. `composes`,
 * written as `: sprout.Actor`, is what a declaration the remedy suggests
 * would compose.
 */
export function unknownKind(
  written: KindExpr,
  from: string,
  kinds: KindSource,
  composes = '',
): { message: string; remedy: string } {
  const name = written.name.text;
  const library = written.library?.text ?? null;
  const nearby =
    library === null ? [...kinds.named(from), ...kinds.named(SPROUT)] : kinds.named(library);
  const meant = nearestOption(name, nearby);
  const as = (bare: string): string => (library === null ? bare : `${library}.${bare}`);
  const message = `Nothing here is a \`${writtenKind(written)}\`.`;
  if (meant !== null) {
    return {
      message: `${message} Did you mean \`${as(meant)}\`?`,
      remedy:
        library === null
          ? `Write \`${meant}\`, or declare \`${name}\` with \`kind ${name}${composes} { … }\`.`
          : `Write \`${as(meant)}\`.`,
    };
  }
  return {
    message,
    remedy:
      library === null
        ? `Declare it with \`kind ${name}${composes} { … }\`, or check the spelling of a kind this world or a library it uses declares.`
        : `Check the spelling, and that the world uses the library \`${library}\` and it declares \`${name}\`.`,
  };
}

/** A kind as the author wrote it: bare stays bare, qualified stays qualified. */
export function writtenKind(written: KindExpr): string {
  return written.library === null
    ? written.name.text
    : qualifiedName(written.library.text, written.name.text);
}

interface Composed {
  readonly kind: KindRef;
  readonly written: KindExpr;
}

/** A property as it reached the composer: which composed kind, as written, it came through. */
interface Arrival {
  readonly property: ResolvedProperty;
  readonly through: KindExpr;
}

/**
 * Compose a kind from what it names and what its body declares. Null
 * when a kind it names is unknown, failed or loops back to it: then it
 * cannot be composed at all, and its body is not read, since a body
 * restating what a missing kind declared would be misread as new.
 */
export function composeKind(composer: Composer, context: ComposeContext): KindRef | null {
  const composed = composedKinds(composer, context);
  if (composed === null) return null;

  const { enums, diagnostics } = context;
  const own = qualifiedName(composer.library, composer.name);
  const shown = (identity: string): string => shownName(identity, composer.library);

  // --- properties, merged by origin -------------------------------------
  const arrivals = new Map<string, Arrival[]>();
  for (const { kind, written } of composed) {
    for (const property of kind.properties.values()) {
      const came = arrivals.get(property.name) ?? [];
      // One origin by several paths is one property (rule 2).
      if (came.some((one) => one.property.origin === property.origin)) continue;
      came.push({ property, through: written });
      arrivals.set(property.name, came);
    }
  }

  const restate = (
    came: readonly Arrival[],
    declared: PropertyDeclaration,
    remembered: boolean,
  ): ResolvedProperty | null => {
    const first = came[0]!.property;
    const other = came.find((one) => !agree(one.property, first))?.property;
    if (other !== undefined) {
      diagnostics.refuse(
        declared.name.at,
        `\`:${declared.name.text}\` holds ${held(first)} in \`${shown(first.origin)}\` and ${held(other)} in \`${shown(other.origin)}\`, so restating it cannot make them one property.`,
        'Compose only one of them, or give one of them another name in a kind of your own.',
      );
      return null;
    }
    return restateProperty(first, declared, remembered, enums, composer.library, own, diagnostics);
  };

  const properties = new Map<string, ResolvedProperty>();
  const written = new Set<string>();
  const hold = (declared: PropertyDeclaration, remembered: boolean): void => {
    const name = declared.name.text;
    if (written.has(name)) {
      diagnostics.refuse(
        declared.name.at,
        `\`${composer.name}\` holds \`:${name}\` twice.`,
        'A property is declared once. Remove the second, or give it another name.',
      );
      return;
    }
    written.add(name);
    const came = arrivals.get(name);
    const resolved =
      came === undefined
        ? resolveProperty(declared, enums, composer.library, own, diagnostics, remembered)
        : restate(came, declared, remembered);
    if (resolved !== null) properties.set(name, resolved);
  };

  // Idempotent under composition (How members combine), so either line
  // anywhere in the closure holds, and `contains actors` implies `contains`.
  let contains = composed.some(({ kind }) => kind.contains);
  let containsActors = composed.some(({ kind }) => kind.containsActors);
  const withouts: WithoutDeclaration[] = [];
  for (const member of composer.members) {
    switch (member.kind) {
      case 'contains':
        contains = true;
        containsActors = containsActors || member.actors;
        break;
      case 'remembers':
        for (const entry of member.properties) hold(entry, true);
        break;
      case 'property':
        hold(member, false);
        break;
      case 'without':
        withouts.push(member);
        break;
    }
  }

  // Two origins and no restatement: refused at the kind, as written,
  // that brought the second (the spec's What it refuses).
  for (const [name, came] of arrivals) {
    if (came.length < 2 || written.has(name)) continue;
    const first = came[0]!.property;
    const origins = came.map((one) => `\`${shown(one.property.origin)}\``);
    const other = came.find((one) => !agree(one.property, first))?.property;
    diagnostics.refuse(
      came[1]!.through.at,
      came.length === 2
        ? `\`${composer.name}\` gets \`:${name}\` from both ${origins.join(' and ')}, which are two claims on one slot.`
        : `\`${composer.name}\` gets \`:${name}\` from ${listed(origins)}, which are ${came.length} claims on one slot.`,
      other === undefined
        ? `If they are meant to be one property, restate it in \`${composer.name}\`: ${restatementOf(first)}.`
        : `They hold ${held(first)} and ${held(other)}, so they cannot be one property: compose only one of them, or give one of them another name in a kind of your own.`,
    );
  }

  const merged = new Map<string, ResolvedProperty>();
  for (const [name, came] of arrivals) merged.set(name, properties.get(name) ?? came[0]!.property);
  for (const [name, property] of properties) if (!merged.has(name)) merged.set(name, property);

  // --- passages, one per name -------------------------------------------
  const passages = resolvePassages(
    { name: composer.name, shown },
    ownPassages(composer.name, composer.members, own, diagnostics),
    passageArrivals(composed.map(({ kind, written }) => ({ passages: kind.passages, written }))),
    diagnostics,
  );

  // --- the closure, in run order ----------------------------------------
  const order: string[] = [];
  for (const { kind } of composed) {
    for (const identity of kind.order) if (!order.includes(identity)) order.push(identity);
  }
  // What this kind leaves out. A composed kind's own `without` has
  // already shaped that kind's guards, so a contribution reaching here
  // through it is gone and the same contribution reaching here by another
  // path is not: a `without` removes the copy that came through the kind
  // that wrote it.
  const verbs = context.verbs ?? new VerbNames();
  const reach = (verb: string): VerbIdentity | null => {
    const found = verbs.unqualified(verb, composer.library);
    return found === null ? null : { library: found.library, name: found.declaration.name.text };
  };
  const suppressed: Suppression[] = [];
  for (const one of leftOut(composer, withouts, order, reach, context)) {
    if (!suppressed.some((other) => sameSuppression(one, other))) suppressed.push(one);
  }

  // --- guards, all of them, in closure order ----------------------------
  const guards = composeGuards(
    composed.map(({ kind }) => kind.guards),
    order,
    suppressed,
    ownGuards(composer.name, composer.members, own, diagnostics),
  );

  // --- plays, every one of each role, in closure order ------------------
  const plays = composePlays(
    composed.map(({ kind }) => kind.plays),
    order,
    suppressed,
    ownPlays(composer, composer.members, own, merged, {
      verbs,
      diagnostics,
      ...(context.onUnknownVerb === undefined ? {} : { onUnknownVerb: context.onUnknownVerb }),
    }),
    reach,
  );
  order.push(own);

  return {
    library: composer.library,
    name: composer.name,
    order,
    composes: new Set(order),
    properties: merged,
    passages,
    guards,
    plays,
    contains: contains || containsActors,
    containsActors,
    suppressed,
  };
}

/**
 * What a composer's `without` lines leave out, each checked against its
 * closure, `composed` (the composer not among them): the kind after
 * `from` is one it composes and not itself, and declares the member
 * itself. What fails a check is refused and left out of the answer.
 */
function leftOut(
  composer: Composer,
  withouts: readonly WithoutDeclaration[],
  composed: readonly string[],
  reach: (verb: string) => VerbIdentity | null,
  context: ComposeContext,
): Suppression[] {
  const { kinds, diagnostics } = context;
  const own = qualifiedName(composer.library, composer.name);
  const suppressed: Suppression[] = [];
  for (const { member, source } of withouts) {
    // A bare name is read from the composer's own library first, where
    // the composer itself is declared.
    const identity =
      source.library === null && source.name.text === composer.name
        ? own
        : identityOf(source, composer.library, kinds);
    const named = writtenKind(source);
    const what = writtenMember(member);
    if (identity === own) {
      diagnostics.refuse(
        source.at,
        `\`${composer.name}\` cannot leave out its own \`${what}\`.`,
        `\`without\` leaves out what a kind \`${composer.name}\` composes contributes. To drop its own, take \`${what}\` out of \`${composer.name}\`.`,
      );
      continue;
    }
    if (!composed.includes(identity)) {
      if (identity !== WORLD && !kinds.declares(identity)) {
        const { message, remedy } = unknownKind(source, composer.library, kinds);
        diagnostics.refuse(source.at, message, remedy);
        continue;
      }
      diagnostics.refuse(
        source.at,
        `\`${composer.name}\` does not compose \`${named}\`, so there is nothing of its to leave out.`,
        `After \`from\`, name a kind \`${composer.name}\` composes, or take this line out.`,
      );
      continue;
    }
    if (!declaresMember(identity, member, kinds, reach)) {
      diagnostics.refuse(
        member.at,
        `\`${named}\` has no \`${what}\` to leave out.`,
        `\`without\` names a member the kind after \`from\` declares itself. Take this line out, or name the kind that declares \`${what}\`.`,
      );
      continue;
    }
    suppressed.push({ member, source: identity });
  }
  return suppressed;
}

/**
 * Whether the kind `identity`, composed already, itself declares
 * `member`, a play's verb read as `reach` reads it. Guards and plays are
 * the members read yet; B32 reads handlers and hooks.
 */
function declaresMember(
  identity: string,
  member: MemberRef,
  kinds: KindSource,
  reach: (verb: string) => VerbIdentity | null,
): boolean {
  const found = kinds.find(identity);
  if (found.found !== 'kind') return false;
  if (member.kind === 'guard-ref') return writesGuard(found.kind.guards, member.guard, identity);
  if (member.kind !== 'role-ref') return false;
  const verb = reach(member.verb.text);
  if (verb === null) return false;
  return writesPlay(found.kind.plays, verb.library, verb.name, member.role.text, identity);
}

/** Whether two suppressions leave out the same member of the same kind. */
function sameSuppression(a: Suppression, b: Suppression): boolean {
  return a.source === b.source && writtenMember(a.member) === writtenMember(b.member);
}

/**
 * The kinds a composition list names, looked up, in the order written;
 * null when any of them could not be had. Everything wrong with the
 * list is said, not only the first.
 */
function composedKinds(composer: Composer, context: ComposeContext): Composed[] | null {
  const { kinds, diagnostics } = context;
  const shown = (identity: string): string => shownName(identity, composer.library);
  const composed: Composed[] = [];
  const named = new Set<string>();
  let whole = true;
  for (const written of composer.composes) {
    const identity = identityOf(written, composer.library, kinds);
    if (identity === WORLD && composer.mayComposeWorld !== true) {
      // Written out, the shape tier has refused it already; this catches
      // a bare `World` that means it.
      if (!writesWorld(written)) refuseComposingWorld(composer.name, written, diagnostics);
      continue;
    }
    if (named.has(identity)) {
      diagnostics.refuse(
        written.at,
        `\`${composer.name}\` composes \`${writtenKind(written)}\` twice.`,
        'Compose it once.',
      );
      continue;
    }
    named.add(identity);
    const found = kinds.find(identity);
    switch (found.found) {
      case 'kind':
        composed.push({ kind: found.kind, written });
        break;
      case 'unknown': {
        whole = false;
        const { message, remedy } =
          identity === WORLD ? missingWorld(kinds) : unknownKind(written, composer.library, kinds);
        if (context.onUnknown !== undefined) context.onUnknown(written, message, remedy);
        else diagnostics.refuse(written.at, message, remedy);
        break;
      }
      case 'failed':
        whole = false;
        break;
      case 'cycle': {
        whole = false;
        const through = found.through.map((one) => `\`${shown(one)}\``);
        diagnostics.refuse(
          written.at,
          through.length === 0
            ? `\`${shown(identity)}\` composes itself.`
            : `\`${shown(identity)}\` composes itself, through ${listed(through)}.`,
          `Take \`${shown(identity)}\` out of what \`${composer.name}\` composes: a kind cannot be made of itself.`,
        );
        break;
      }
    }
  }
  return whole ? composed : null;
}

/**
 * What is said when there is no `sprout.World` to compose: the library
 * `sprout` is not there at all, which the manifest answers, or it is and
 * does not declare it.
 */
function missingWorld(kinds: KindSource): { message: string; remedy: string } {
  if (kinds.named(SPROUT).length === 0) {
    return {
      message: `\`${WORLD}\` is not here, because the library \`${SPROUT}\` is not.`,
      remedy: `Every world composes \`${WORLD}\` from the library \`${SPROUT}\`: name it among the manifest's libraries and vendor it with the world, as \`sprout init\` does.`,
    };
  }
  return {
    message: `The standard library is missing \`${WORLD}\`.`,
    remedy: 'Every world composes it, for the words the engine speaks for itself.',
  };
}

/** Whether two origins' declarations could be one slot: the same type, range and memory. */
function agree(a: ResolvedProperty, b: ResolvedProperty): boolean {
  return a.remembered === b.remembered && identicalType(a.type, b.type);
}

/** What a property holds, as a message says it. */
function held(property: ResolvedProperty): string {
  const type = showType(property.type);
  return property.remembered ? `${type} (remembered)` : type;
}

/** `A`, `A and B`, `A, B and C`. */
function listed(items: readonly string[]): string {
  if (items.length < 2) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
