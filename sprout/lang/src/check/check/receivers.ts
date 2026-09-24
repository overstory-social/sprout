// What a receiver is, asked before a reading or a write goes through it
// (the spec's Properties › What the compiler checks). Two of the checker's
// three rules are decided here: only `self` writes `self` (`onlySelf`),
// and `is()` is the only read through the object type — every other
// question refuses an object whose kind is unknown and says to narrow it.
// Memory is looked up on `self`'s kind, never on the receiver's.

import type { Expr, Ident } from '../../syntax/ast.js';
import { showBindingType, type Binding, type BindingType } from '../bindings.js';
import { composesKind, kindName, type KindRef } from '../../declare/kinds.js';
import { ACTOR, isActor, isVisitorKind } from '../../declare/actors.js';
import { nearestOption, shownName } from '../../declare/enums.js';
import type { ResolvedProperty } from '../../declare/properties.js';
import type { Span } from '../../source/source.js';
import { readable } from '../../source/words.js';
import { placedWords } from '../names.js';
import type { CheckContext } from './checker.js';

/**
 * The kind a receiver is, or a refusal naming what to do about the object
 * type: narrow it, through a `let` where `receiver` is a name in a kind's
 * body that no compile can fix.
 */
export function receiverKind(
  type: BindingType,
  at: Span,
  doing: string,
  context: CheckContext,
  receiver?: Expr,
): KindRef | null {
  if (type.binds === 'object' && type.kind !== null) return type.kind;
  if (type.binds === 'object') {
    const placed = receiver === undefined ? null : placedWords(receiver, doing, context);
    context.diagnostics.refuse(
      at,
      placed?.message ?? `Sprout does not know what this is, so it cannot ${doing} it.`,
      placed?.remedy ?? 'Narrow it first, as in `if (thing.is(Key)) { … }`.',
    );
    return null;
  }
  context.diagnostics.refuse(
    at,
    `Only a thing in the world has properties, and this is ${showBindingType(type)}.`,
    'Name a binding that holds a thing in the world.',
  );
  return null;
}

/** Only `self` writes `self`. Everything else asks, and a message is how. */
export function onlySelf(
  receiver: Expr,
  type: BindingType,
  method: Ident,
  context: CheckContext,
): KindRef | null {
  const named = receiver.kind === 'binding' ? context.scope.lookup(receiver.name.text) : null;
  if (named === null || !named.writable) {
    context.diagnostics.refuse(
      method.at,
      `Only \`self\` writes its own state, and this is ${describe(named, type)}.`,
      'Send it a message and let it decide, as in `send it :unlock_attempt`.',
    );
    return null;
  }
  return receiverKind(type, method.at, 'write to', context);
}

/** A receiver as a refusal names it: by its binding's name, or by its type where that says more. */
export function describe(binding: Binding | null, type: BindingType): string {
  if (binding === null) return showBindingType(type);
  return binding.name === 'self' ? showBindingType(type) : `\`${binding.name}\``;
}

/** Whether a receiver may be asked about memory: it composes `sprout.Actor`. */
export function remembers(
  type: BindingType,
  at: Span,
  context: CheckContext,
  receiver?: Expr,
): boolean {
  if (type.binds === 'object' && type.kind !== null) {
    if (isActor(type.kind)) return true;
    context.diagnostics.refuse(
      at,
      `\`${kindName(type.kind)}\` is not someone a thing is remembered about.`,
      `Only a kind composing \`${ACTOR}\` is. Hold it on the object itself, with \`get\` and \`set\`.`,
    );
    return false;
  }
  if (type.binds === 'object') {
    const placed =
      receiver === undefined ? null : placedWords(receiver, 'ask about memory of', context);
    context.diagnostics.refuse(
      at,
      placed?.message ??
        'Sprout does not know whether this is someone who can be remembered about.',
      placed?.remedy ?? 'Narrow it first, as in `if (item.is(Creature)) { … }`.',
    );
    return false;
  }
  context.diagnostics.refuse(
    at,
    `Only an actor is remembered about, and this is ${showBindingType(type)}.`,
    `Ask it of \`actor\`, or of something composing \`${ACTOR}\`.`,
  );
  return false;
}

/** A remembered property of `self` — the only memory any object may touch. */
export function ownMemory(named: Ident, context: CheckContext): ResolvedProperty | null {
  const declared = context.self?.properties.get(named.text) ?? null;
  if (declared !== null && declared.remembered) return declared;
  context.diagnostics.refuse(
    named.at,
    declared === null
      ? `This remembers nothing called \`:${named.text}\`.`
      : `\`:${named.text}\` is held by the object, not remembered about each actor.`,
    declared === null
      ? 'Declare it first, as in `remembers { :visits 0 min 0 max 99 }`. No object reads another object’s memory of anyone.'
      : `Read it with \`get\`, as in \`self.get(:${named.text})\`.`,
  );
  return null;
}

/**
 * The property a kind declares under a name, or a refusal suggesting the
 * nearest it has. Where `receiver`, as written, is read and a world's own
 * kind composing `kind` declares the property, the remedy narrows to it.
 */
export function declaredOn(
  kind: KindRef,
  named: Ident,
  context: CheckContext,
  receiver?: string,
): ResolvedProperty | null {
  const property = kind.properties.get(named.text);
  if (property !== undefined) return property;
  const meant = nearestOption(named.text, [...kind.properties.keys()]);
  const holders = receiver === undefined ? [] : holdersOf(kind, named.text, context);
  const shown = holders.map((holder) => shownName(kindName(holder), context.from));
  const whose = shown.map((name) => `a \`${name}\`'s`).join(' or ');
  context.diagnostics.refuse(
    named.at,
    `\`${kindName(kind)}\` has no \`:${named.text}\`.${meant === null ? '' : ` Did you mean \`:${meant}\`?`}`,
    shown.length === 0
      ? `It has ${readable([...kind.properties.keys()].map((name) => `:${name}`))}.`
      : `\`:${named.text}\` is ${whose}. Read it as ${shown.length === 1 ? 'one' : 'one of them'} first: \`if (${receiver}.is(${shown[0]})) { … ${receiver}.get(:${named.text}) … }\`.`,
  );
  return null;
}

/**
 * The world's own kinds composing `kind` that declare `name`, in the order
 * declared; a person's kind alone where it is one of them, since `actor`
 * is most often a person.
 */
function holdersOf(kind: KindRef, name: string, context: CheckContext): KindRef[] {
  const holders = context.kinds
    .all()
    .filter(
      (one) =>
        one.library === context.from &&
        one !== kind &&
        composesKind(one, kind) &&
        one.properties.get(name)?.remembered === false,
    );
  const person = holders.find(isVisitorKind);
  return person === undefined ? holders : [person];
}

/** `x.count` and `x.count(K)` — a container or a set role. */
export function countable(
  type: BindingType,
  at: Span,
  context: CheckContext,
  receiver?: Expr,
): boolean {
  if (type.binds === 'set') return true;
  // Lists names `count` as one of a list's four operations, where the
  // checker's own table names only a container and a set role. The
  // fuller sentence wins, and the narrower row is recorded in the
  // notes as a row to widen.
  if (type.binds === 'value' && type.type.type === 'list') return true;
  return container(type, at, context, receiver);
}

/** Whether a receiver holds things: a kind that declares `contains`. */
export function container(
  type: BindingType,
  at: Span,
  context: CheckContext,
  receiver?: Expr,
): boolean {
  if (type.binds === 'object' && type.kind !== null && type.kind.contains) return true;
  if (type.binds === 'object' && type.kind !== null) {
    context.diagnostics.refuse(
      at,
      `\`${kindName(type.kind)}\` holds nothing, so there is nothing to count.`,
      'Containment is a declaration: a kind that holds things writes `contains`.',
    );
    return false;
  }
  if (type.binds === 'object') {
    const placed = receiver === undefined ? null : placedWords(receiver, 'count', context);
    context.diagnostics.refuse(
      at,
      placed?.message ?? 'Sprout does not know whether this holds anything.',
      placed?.remedy ?? 'Narrow it first, as in `if (thing.is(sprout.Container)) { … }`.',
    );
    return false;
  }
  context.diagnostics.refuse(
    at,
    `Only a thing that holds things can be counted, and this is ${showBindingType(type)}.`,
    'Ask it of a container, or of a role marked `many`.',
  );
  return false;
}
