// What an identifier or a dotted path in a body is, as the checker types
// it (the spec's Names › Identifiers and scope; Properties › Where types
// come from). A name in scope is its binding, and a binding hides an
// object of its name; any other name is resolved from where the body is
// written (`declare/names.ts`). One the compile fixes is typed at the
// object's kind, so it reads without `is()`; one in a kind's body that
// reaches whatever is nearest each instance is of the object type, read
// only through `is()`. Each name resolved is recorded, by the node
// written, for the runtime to find what it reaches, which is only ever a
// target when it is in range.

import type { Expr, Ident, ObjectPath } from '../syntax/ast.js';
import { writtenPath } from '../syntax/ast.js';
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
import { objectOf, OPEN_OBJECT, type BindingType } from './bindings.js';
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
  const scope = context.names;
  const parts = path.parts.map((part) => part.text);
  if (scope === undefined) {
    context.diagnostics.refuse(
      path.at,
      `Nothing here is called \`${writtenPath(path)}\`.`,
      'Name something in scope, as in `self` or `actor`.',
    );
    return null;
  }
  const naming = nameFrom(scope.source, scope.vantage, parts);
  if (naming.names === 'world-inside') {
    const step = path.parts[naming.step]!;
    const rest = parts.filter((part, i) => i === 0 || part !== step.text);
    context.diagnostics.refuse(
      step.at,
      `\`${step.text}\` is the world, whose name may be a path's first step and no other.`,
      `Leave the world's name out of the middle: write \`${rest.join('.')}\`.`,
    );
    return null;
  }
  if (naming.names === 'missing') {
    const step = path.parts[naming.step]!;
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
  scope.table.set(path, naming);
  return typed(naming, scope);
}

function typed(named: Named, scope: NameScope): BindingType {
  if (named.names === 'placed') return OPEN_OBJECT;
  const kind = named.names === 'world' ? scope.world : named.kind;
  return kind === null ? OPEN_OBJECT : objectOf(kind);
}

/**
 * Where `receiver` is a name in a kind's body that reaches whatever is
 * nearest each instance, the words for reading through it: say so, and
 * narrow it through a `let`, since `is()` narrows a binding and a passage
 * reads the bindings of the body that says it. Null for any other receiver.
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
    remedy: `Name it with \`let\` and narrow that, as in \`let found = ${name}\` and then \`if (found.is(${kind})) { … }\`; a passage said inside the branch may read \`found\` too.`,
  };
}
