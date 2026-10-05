// What an identifier or a dotted path in a body is, as the checker types
// it (the spec's Names › Identifiers and scope; Properties › Where types
// come from). A name in scope is its binding, and a binding hides an
// object of its name; any other name is resolved from where the body is
// written (`declare/names.ts`). One the compile fixes is typed at the
// object's kind, so it reads without `is()`; one in a kind's body that
// reaches whatever is nearest each instance is of the object type, read
// only through `is()`, which narrows it for its branch as it narrows a
// binding. Each name resolved is recorded, by the node written, for the
// runtime to find what it reaches, which is only ever a target when it is
// in range.

import type { Expr, Ident, MemberExpr, ObjectPath } from '../syntax/ast.js';
import { everyContent } from '../declare/contents.js';
import { pathKey } from '../declare/tree.js';
import type { Node } from '../source/nodes.js';
import { readable } from '../source/words.js';
import { nearestOption } from '../declare/enums.js';
import { writtenKind } from '../declare/compose.js';
import type { KindRef } from '../declare/kinds.js';
import {
  nameFrom,
  namesInReach,
  type Named,
  type NameSource,
  type Vantage,
} from '../declare/names.js';
import { objectOf, OPEN_OBJECT, type BindingType, type ObjectBinding } from './bindings.js';
import type { CheckContext } from './check.js';

/** Every name a bundle's bodies resolved, by the node written, for the runtime. */
export type NameTable = ReadonlyMap<Node, Named>;

/** Where a body's names are resolved from, and where what they reach is recorded. */
export interface NameScope {
  readonly source: NameSource;
  readonly vantage: Vantage;
  /** What the world is made of, which its name types as. */
  readonly world: KindRef | null;
  readonly table: Map<Node, Named>;
}

/**
 * What an identifier nothing in scope answers to names, recorded at
 * `ident`; null where nothing does, leaving the refusal to the caller.
 */
export function identifierType(ident: Ident, context: CheckContext): BindingType | null {
  const scope = context.names;
  if (scope === undefined) return null;
  const naming = nameFrom(scope.source, scope.vantage, [ident.text]);
  if (naming.names === 'missing' || naming.names === 'world-inside') return null;
  checkNameable(ident, [ident.text], context);
  scope.table.set(ident, naming);
  return typed(naming, scope);
}

/** The names an identifier could have meant here, beside what is in scope. */
export function identifiersInReach(context: CheckContext): string[] {
  const scope = context.names;
  return scope === undefined ? [] : namesInReach(scope.source, scope.vantage);
}

/**
 * What a dotted path names, recorded at `path`, or null having said why:
 * a step nothing answers to, with the one most likely meant, or the
 * world's name written anywhere but first.
 */
export function dottedType(path: ObjectPath, context: CheckContext): BindingType | null {
  return stepsType(path.parts, path, context);
}

/**
 * How many of `members`, the member readings written on the name `first`
 * in an expression, are the steps of a dotted path: each names an object
 * declared in the body of the one before (the spec's Identifiers and
 * scope). None where `first` is bound, names nothing, or the path stops
 * at its first dot, so `lamp.count` stays a reading. Says nothing.
 */
export function pathSteps(
  first: Ident,
  members: readonly MemberExpr[],
  context: CheckContext,
): number {
  const scope = context.names;
  if (scope === undefined || members.length === 0) return 0;
  if (!declaredNames(scope.source).has(members[0]!.member.text)) return 0;
  if (context.scope.lookup(first.text) !== null || context.scope.withheld(first.text) !== null) {
    return 0;
  }
  const parts = [first.text, ...members.map((one) => one.member.text)];
  const naming = nameFrom(scope.source, scope.vantage, parts);
  if (naming.names === 'missing' || naming.names === 'world-inside') {
    return Math.max(0, naming.step - 1);
  }
  return members.length;
}

/** Every name some object in the bundle is declared by, which each step after a path's first must be. */
const DECLARED = new WeakMap<NameSource, ReadonlySet<string>>();

/** `DECLARED` for `source`, gathered once, so a reading such as `x.count` is told from a step without resolving it. */
function declaredNames(source: NameSource): ReadonlySet<string> {
  let names = DECLARED.get(source);
  if (names === undefined) {
    names = new Set([
      ...[...source.tree.placed.values()].map((one) => one.path.at(-1)!),
      ...everyContent(source.contents).map((one) => one.declaration.name.text),
    ]);
    DECLARED.set(source, names);
  }
  return names;
}

/**
 * The dotted path an expression's member readings write on a name, whose
 * `steps` `pathSteps` counted, typed at what it names and recorded at its
 * last step for the runtime. Where the reading after it is a word no
 * reading is, it was meant as a step too, and is refused as a path's
 * step nothing answers to.
 */
export function memberPathType(
  first: Ident,
  steps: readonly MemberExpr[],
  after: MemberExpr | undefined,
  context: CheckContext,
): BindingType | null {
  const written = [first, ...steps.map((one) => one.member)];
  if (after !== undefined && after.member.text !== 'count') {
    return stepsType([...written, after.member], after, context);
  }
  return stepsType(written, steps.at(-1)!, context);
}

/** Whether `expr` is a dotted path whole, `w2.forest_1.box`, rather than a reading of one. */
export function isMemberPath(expr: Expr, context: CheckContext): boolean {
  const members: MemberExpr[] = [];
  let node = expr;
  for (; node.kind === 'member'; node = node.receiver) members.unshift(node);
  return (
    node.kind === 'binding' &&
    members.length > 0 &&
    pathSteps(node.name, members, context) === members.length
  );
}

/** What `parts`, written with dots, names, recorded at `key`, or null having said why. */
function stepsType(parts: readonly Ident[], key: Node, context: CheckContext): BindingType | null {
  const scope = context.names;
  const texts = parts.map((part) => part.text);
  if (scope === undefined) {
    context.diagnostics.refuse(
      key.at,
      `Nothing here is called \`${texts.join('.')}\`.`,
      'Name something in scope, as in `self` or `actor`.',
    );
    return null;
  }
  const naming = nameFrom(scope.source, scope.vantage, texts);
  if (naming.names === 'world-inside') {
    const step = parts[naming.step]!;
    const rest = texts.filter((part, i) => i === 0 || part !== step.text);
    context.diagnostics.refuse(
      step.at,
      `\`${step.text}\` is the world, whose name may be a path's first step and no other.`,
      `Leave the world's name out of the middle: write \`${rest.join('.')}\`.`,
    );
    return null;
  }
  if (naming.names === 'missing') {
    const step = parts[naming.step]!;
    const within = naming.within;
    // Inside a named thing, a guess is any name written anywhere, since
    // what the path's steps before it reach is what was mistyped.
    const meant = nearestOption(
      step.text,
      within === null
        ? namesInReach(scope.source, scope.vantage)
        : [...new Set([...scope.source.tree.placed.values()].map((one) => one.path.at(-1)!))],
    );
    context.diagnostics.refuse(
      step.at,
      `Nothing ${within === null ? 'here' : `in \`${within}\``} is called \`${step.text}\`.${meant === null ? '' : ` Did you mean \`${meant}\`?`}`,
      within === null
        ? `In reach: ${readable(namesInReach(scope.source, scope.vantage))}.`
        : `Name something written in the body of \`${within}\`.`,
    );
    return null;
  }
  checkNameable(parts[0]!, texts, context);
  scope.table.set(key, naming);
  return typed(naming, scope);
}

/**
 * Refuse a name in the world's tree whose first step reaches an object
 * another file declares and this one does not import (the spec's
 * Identifiers and scope): it is named from the world instead. A name in a
 * kind's body, which each instance reaches for itself, is never refused.
 */
function checkNameable(first: Ident, parts: readonly string[], context: CheckContext): void {
  const scope = context.names;
  const nameable = scope?.source.nameable;
  if (scope === undefined || nameable === undefined || scope.vantage.in !== 'tree') return;
  const { tree } = scope.source;
  if (parts[0] === tree.world) return;
  const step = nameFrom(scope.source, scope.vantage, [parts[0]!]);
  if (step.names !== 'declared') return;
  const placement = tree.placed.get(pathKey(step.path));
  const file = first.at.source.name;
  if (placement === undefined || nameable(file, placement)) return;
  const path = [tree.world, ...placement.path].join('.');
  context.diagnostics.refuse(
    first.at,
    `\`${first.text}\` is written in \`${placement.declaration.at.source.name}\`, and this file does not import it.`,
    `Name it from the world, as \`${[path, ...parts.slice(1)].join('.')}\`.`,
  );
}

function typed(named: Named, scope: NameScope): BindingType {
  if (named.names === 'placed') return OPEN_OBJECT;
  const kind = named.names === 'world' ? scope.world : named.kind;
  return kind === null ? OPEN_OBJECT : objectOf(kind);
}

/**
 * Where `receiver` is a name in a kind's body that reaches whatever is
 * nearest each instance, the words for reading through it: say so, and
 * narrow it with `is()`, in a body or in a passage. Null for any other
 * receiver.
 */
export function placedWords(
  receiver: Expr,
  doing: string,
  context: CheckContext,
): { message: string; remedy: string } | null {
  if (receiver.kind !== 'binding' || context.scope.lookup(receiver.name.text) !== null) return null;
  const named = context.names?.table.get(receiver.name);
  if (named?.names !== 'placed') return null;
  const name = receiver.name.text;
  const made = named.candidates.flatMap((one) => one.declaration.composes.slice(0, 1));
  const kind = made.length === 0 ? 'Key' : writtenKind(made[0]!);
  return {
    message: `\`${name}\` is whatever is called that nearest each instance, so Sprout does not know what it is, and cannot ${doing} it.`,
    remedy: `Narrow it with \`is()\` and read it inside the branch, as in \`if (${name}.is(${kind})) { … }\` in a body or \`{if ${name}.is(${kind})}…{/if}\` in a passage.`,
  };
}

/**
 * A name in a kind's body that the run resolves, as the binding `is()`
 * narrows for the branch it guards: of the object type, at the name as
 * written. Null for a name in scope, or one the compile fixed, since those
 * are typed already.
 */
export function placedBinding(ident: Ident, context: CheckContext): ObjectBinding | null {
  if (context.scope.lookup(ident.text) !== null) return null;
  if (context.names?.table.get(ident)?.names !== 'placed') return null;
  return {
    name: ident.text,
    type: { binds: 'object', kind: null },
    origin: 'name',
    at: ident.at,
    writable: false,
  };
}
