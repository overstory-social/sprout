// `each`, checked (the spec's Properties › Walking contents, Where types
// come from). `each x in c` walks something whose kind holds things, and
// `each x: K in c` those of its contents composing `K`, typed so; `each x
// of s` walks a set role, each member at the role's kind. There is no
// `each` over a list: a list holds values, and `{for … of}` renders them.
// The body is checked by the caller, as the body it stands in allows, in
// the scope this gives it.

import type { EachStatement } from '../syntax/ast.js';
import { shownName } from '../declare/enums.js';
import { kindName } from '../declare/kinds.js';
import {
  loopBinding,
  setMemberBinding,
  showBindingType,
  type Binding,
  type Scope,
} from './bindings.js';
import { resolveKind, typeOf, type CheckContext } from './check.js';
import { placedWords } from './names.js';

/** The scope an `each`'s body is checked in, its variable bound; null having said why it walks nothing. */
export function eachScope(statement: EachStatement, context: CheckContext): Scope | null {
  const variable = eachVariable(statement, context);
  if (variable === null) return null;
  const scope = context.scope.inner();
  return scope.introduce(variable, context.diagnostics) ? scope : null;
}

/** What an `each` binds its variable to, or null having said why. */
function eachVariable(statement: EachStatement, context: CheckContext): Binding | null {
  const { variable, over } = statement;
  const type = typeOf(over, context);
  if (type === null) return null;
  if (statement.walks === 'of') {
    if (type.binds === 'set') return setMemberBinding(variable.text, type.kind, variable.at);
    context.diagnostics.refuse(
      over.at,
      `\`each … of\` walks a role marked \`many\`, and this is ${shown(type, context)}.`,
      type.binds === 'object'
        ? `To walk what it holds, write \`each ${variable.text} in …\`.`
        : type.type.type === 'list'
          ? 'A list holds values, not things, so nothing walks it with `each`: render it in a passage with `{for … of}`.'
          : 'Name a role marked `many`, as in `each tool of tools { … }`.',
    );
    return null;
  }
  if (type.binds === 'object' && type.kind !== null && type.kind.contains) {
    const filter = statement.filter === null ? null : resolveKind(statement.filter, context);
    if (statement.filter !== null && filter === null) return null;
    return loopBinding(variable.text, filter, variable.at);
  }
  const [message, remedy] =
    type.binds !== 'object'
      ? [
          `\`each … in\` walks what a thing holds, and this is ${showBindingType(type)}.`,
          type.binds === 'set'
            ? `Walk a role marked \`many\` with \`each ${variable.text} of …\`.`
            : 'A list holds values, not things, so nothing walks it with `each`: render it in a passage with `{for … of}`.',
        ]
      : type.kind === null
        ? unknownHolder(statement, type.remedy, context)
        : [
            `\`${shownName(kindName(type.kind), context.from)}\` holds nothing, so there is nothing to walk.`,
            'Containment is a declaration: a kind that holds things writes `contains`.',
          ];
  context.diagnostics.refuse(over.at, message, remedy);
  return null;
}

/** A binding type as a refusal names it: a kind by its name, else as `showBindingType` says it. */
function shown(type: NonNullable<ReturnType<typeof typeOf>>, context: CheckContext): string {
  return type.binds === 'object' && type.kind !== null
    ? `\`${shownName(kindName(type.kind), context.from)}\``
    : showBindingType(type);
}

/** The words for walking what a name of the object type holds. */
function unknownHolder(
  statement: EachStatement,
  remedy: string | undefined,
  context: CheckContext,
): [string, string] {
  const placed = placedWords(statement.over, 'walk', context);
  if (placed !== null) return [placed.message, placed.remedy];
  return [
    'Sprout does not know whether this holds anything.',
    remedy ?? 'Narrow it first, as in `if (thing.is(sprout.Container)) { each … }`.',
  ];
}
