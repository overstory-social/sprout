// The bottom of a spine: a literal, a name in scope, and what is written
// where a value is wanted but is not one (the spec's Properties › Where
// types come from, What the compiler checks). A bare option names no enum
// on its own, a kind is not a value, and a free call is not read yet —
// each is refused with what to write instead.
//
// `FREE_CALLS` is the empty table B33 fills with `chance` and `random`;
// the parser reads their shape so the refusal can name the word rather
// than complain about a bracket.

import type { Expr, Ident } from '../../syntax/ast.js';
import { valueOf, type BindingType } from '../bindings.js';
import { writtenKind } from '../../declare/compose.js';
import { nearestOption } from '../../declare/enums.js';
import { BOOLEAN, integer, STRING } from '../../declare/types.js';
import { readable } from '../../source/words.js';
import type { CheckContext, Checker } from './checker.js';
import { identityType } from './operators.js';

/** The free calls this compiler reads. B33 fills it with `chance` and `random`. */
export const FREE_CALLS: ReadonlySet<string> = new Set<string>();

/** The type at the bottom of a spine, or null having said why it has none. */
export function leafType(expr: Expr, context: Checker): BindingType | null {
  switch (expr.kind) {
    case 'boolean':
      return valueOf(BOOLEAN);
    case 'integer':
      return valueOf(integer());
    case 'string':
      return valueOf(STRING);
    case 'binding':
      return bindingType(expr.name, context);
    case 'symbol-expr':
      context.diagnostics.refuse(
        expr.at,
        `\`:${expr.name.text}\` does not say which enum it belongs to.`,
        'An option is compared with something typed, as in `self.get(:state) == :wet`.',
      );
      return null;
    case 'binary':
      // The one binary the spine hands to a leaf: `sym == x` / `sym !=
      // x`, whose left is a symbol literal. `identityType` checks it
      // against the right instead of typing it alone.
      return identityType(expr, null, context);
    case 'kind-expr':
      context.diagnostics.refuse(
        expr.at,
        `\`${writtenKind(expr)}\` is a kind, not a value.`,
        'A kind is what `is()` and `count()` take, as in `tool.is(Key)`.',
      );
      return null;
    case 'free-call':
      context.diagnostics.refuse(
        expr.name.at,
        `Sprout does not know how to read \`${expr.name.text}\` here.`,
        `This compiler reads ${readable([...FREE_CALLS])}.`,
      );
      return null;
    default:
      // A unary, member or call never reaches here: the spine walk
      // stops above it and `aboveType` types it. A binary reaches here
      // only through the `'binary'` case above.
      context.diagnostics.refuse(
        expr.at,
        'Sprout cannot work out what this reads.',
        'Write a value, a name something in scope answers to, or a reading such as `self.get(:wear)`.',
      );
      return null;
  }
}

/** What a name in scope is bound to, or null having said nothing here answers to it. */
export function bindingType(name: Ident, context: CheckContext): BindingType | null {
  const binding = context.scope.lookup(name.text);
  if (binding !== null) return binding.type;
  const meant = nearestOption(name.text, context.scope.names());
  context.diagnostics.refuse(
    name.at,
    `Nothing here is called \`${name.text}\`.${meant === null ? '' : ` Did you mean \`${meant}\`?`}`,
    `In reach: ${readable(context.scope.names())}.`,
  );
  return null;
}
