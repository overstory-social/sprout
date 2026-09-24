// `chance(n)` and `random(n)`, typed (the spec's Chance › The forms, Where
// chance is forbidden). Each takes one positive integer literal: `chance`
// is a boolean, true one time in n, and `random` an integer from 0 to
// n − 1, typed by exactly that range so a comparison it can never meet is
// refused as any literal outside a range is. Where the body draws
// nothing, either is refused whatever it is given.

import type { Expr, FreeCallExpr } from '../../syntax/ast.js';
import { valueOf, type BindingType } from '../bindings.js';
import { BOOLEAN, integer } from '../../declare/types.js';
import { readable } from '../../source/words.js';
import { DRAWS, refuseDraw } from '../chance.js';
import { arity } from './arguments.js';
import type { Checker } from './checker.js';

/** What a free call gives, or null having said why it gives nothing. */
export function drawType(expr: FreeCallExpr, context: Checker): BindingType | null {
  const { name } = expr;
  if (!DRAWS.has(name.text)) {
    context.diagnostics.refuse(
      name.at,
      `Sprout does not know how to read \`${name.text}\` here.`,
      `The calls written with nothing before them are ${readable([...DRAWS].map((draw) => `${draw}(…)`))}; a reading is written on what it reads, as in \`self.get(:wear)\`.`,
    );
    return null;
  }
  if (context.undrawn !== undefined) {
    refuseDraw({ written: name.text, at: name.at }, context.undrawn, context.diagnostics);
    return null;
  }
  if (!arity(name, expr.arguments, 1, context)) return null;
  const written = expr.arguments[0]!;
  const bound = boundOf(written);
  if (bound === null || bound < 1) {
    context.diagnostics.refuse(
      written.at,
      bound === null
        ? `\`${name.text}\` is given a number written out, and this is worked out.`
        : `\`${name.text}\` is given a number above zero, and this is ${bound}.`,
      name.text === 'chance'
        ? 'Write the number itself, as in `chance(3)`, which is true one time in three.'
        : 'Write the number itself, as in `random(6)`, which is a number from 0 to 5.',
    );
    return null;
  }
  return name.text === 'chance' ? valueOf(BOOLEAN) : valueOf(integer(0, bound - 1));
}

/** The number an argument writes out, a minus on it included; null for anything worked out. */
function boundOf(written: Expr): number | null {
  if (written.kind === 'integer') return written.value;
  if (written.kind === 'unary' && written.operator === '-' && written.operand.kind === 'integer') {
    return -written.operand.value;
  }
  return null;
}
