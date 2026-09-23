// What a reading or a write is given (the spec's Properties › What the
// compiler checks): how many things, the property it names with a colon,
// and the kind it names with a capital. Each refuses, in words an author
// can act on, where what was written is not what the call takes.

import type { Expr, Ident } from '../../syntax/ast.js';
import { writtenKind } from '../../declare/compose.js';
import type { KindRef } from '../../declare/kinds.js';
import type { CheckContext } from './checker.js';

/** Whether a call is given exactly as many things as it takes, refusing at the word if not. */
export function arity(
  method: Ident,
  args: readonly Expr[],
  wanted: number,
  context: CheckContext,
): boolean {
  if (args.length === wanted) return true;
  context.diagnostics.refuse(
    method.at,
    `\`${method.text}\` is given ${count(wanted)}, and this gives it ${count(args.length)}.`,
    wanted === 1
      ? `Write \`${method.text}(…)\` with one thing in the brackets.`
      : `Write \`${method.text}(…, …)\` with two.`,
  );
  return false;
}

/** How many things, as a sentence says it. */
export function count(many: number): string {
  return many === 1 ? 'one thing' : `${many} things`;
}

/** `:p` in the place a call names a property. */
export function propertyName(written: Expr, context: CheckContext): Ident | null {
  if (written.kind === 'symbol-expr') return written.name;
  context.diagnostics.refuse(
    written.at,
    'This names the property to read, and that is written with a colon.',
    'Write `:wear`, naming the property.',
  );
  return null;
}

/** The kind a `Key` or `sprout.Container` names, or null having said why it names none. */
export function resolveKind(written: Expr, context: CheckContext): KindRef | null {
  if (written.kind !== 'kind-expr') {
    context.diagnostics.refuse(
      written.at,
      'This names a kind, which starts with a capital letter.',
      'Write the kind, as in `Key` or `sprout.Container`.',
    );
    return null;
  }
  const found =
    written.library === null
      ? context.kinds.unqualified(written.name.text, context.from)
      : context.kinds.qualified(written.library.text, written.name.text);
  if (found !== null) return found;
  context.diagnostics.refuse(
    written.at,
    `Nothing here is a \`${writtenKind(written)}\`.`,
    'Write a kind this world declares, or one a library it uses exports.',
  );
  return null;
}
