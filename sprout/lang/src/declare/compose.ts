// Composing a kind (the spec's Kinds, composition and libraries › How
// members combine, Properties merge; they never shadow). One function
// composes a written composition list and a body into a `KindRef`, for a
// kind and for an object's anonymous kind alike.
//
// Three rules hold here. The closure is walked depth-first, left to
// right, each kind at its first appearance and the composer last, and
// that is the order composable members run in. A property is one slot
// per name: one origin reached by several paths is one property, two
// origins are refused unless the composer restates it, and a restatement
// keeps the type. `contains` and `contains actors` are idempotent, so
// they are OR'd over the closure.

import type { KindExpr, KindMember, PropertyDeclaration } from '../syntax/ast.js';
import type { Diagnostics } from '../source/diagnostics.js';
import { nearestOption, qualifiedName, shownName, SPROUT, type EnumTable } from './enums.js';
import type { KindRef } from './kinds.js';
import { refuseComposingWorld, WORLD, writesWorld } from './sprout-world.js';
import {
  resolveProperty,
  restatementOf,
  restateProperty,
  type ResolvedProperty,
} from './properties.js';
import { identicalType, showType } from './types.js';

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

/** What is being composed: a kind, or an object's anonymous kind named for the object. */
export interface Composer {
  /** The library it is declared in, which is also where its written names are read from. */
  readonly library: string;
  readonly name: string;
  readonly composes: readonly KindExpr[];
  readonly members: readonly KindMember[];
}

export interface ComposeContext {
  readonly enums: EnumTable;
  readonly kinds: KindSource;
  readonly diagnostics: Diagnostics;
  readonly onUnknown?: OnUnknown;
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
 * What is said of a composed kind nothing declares, read from inside
 * `from`, with the kind it most likely meant where one is close enough.
 */
export function unknownKind(
  written: KindExpr,
  from: string,
  kinds: KindSource,
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
          ? `Write \`${meant}\`, or declare \`${name}\` with \`kind ${name} { … }\`.`
          : `Write \`${as(meant)}\`.`,
    };
  }
  return {
    message,
    remedy:
      library === null
        ? `Declare it with \`kind ${name} { … }\`, or check the spelling of a kind this world or a library it uses declares.`
        : `Check the spelling, and that the world uses the library \`${library}\` and it declares \`${name}\`.`,
  };
}

/** A kind as the author wrote it: bare stays bare, qualified stays qualified. */
function writtenKind(written: KindExpr): string {
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
  for (const member of composer.members) {
    switch (member.kind) {
      case 'contains':
        contains = true;
        containsActors = containsActors || member.actors;
        break;
      case 'remembers':
        for (const entry of member.properties) hold(entry, true);
        break;
      default:
        hold(member, false);
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

  // --- the closure, in run order ----------------------------------------
  const order: string[] = [];
  for (const { kind } of composed) {
    for (const identity of kind.order) if (!order.includes(identity)) order.push(identity);
  }
  order.push(own);

  return {
    library: composer.library,
    name: composer.name,
    order,
    composes: new Set(order),
    properties: merged,
    contains: contains || containsActors,
    containsActors,
  };
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
    if (identity === WORLD) {
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
        const { message, remedy } = unknownKind(written, composer.library, kinds);
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
