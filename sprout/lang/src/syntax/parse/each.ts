// `each <name> in <container> { … }`, `each <name>: <Kind> in <container>
// { … }` and `each <name> of <set role> { … }`, read (the spec's
// Properties › Walking contents). What is walked is an expression, and
// whether it holds things, or is a set role, is the checker's.
//
// A refused `each` costs only itself: its header is refused once, and
// the block after it, where one follows, is left for the enclosing
// block's recovery to step over whole.

import type { Block, EachStatement, Expr, KindExpr } from '../ast.js';
import { isReserved } from '../reserved.js';
import { spanning } from '../../source/source.js';
import { kindName } from './composition.js';
import { expression } from './expressions.js';
import { punct, type Parser } from './parser.js';
import { block, notAStatement, onItsOwn, type Enclosing } from './statements.js';

/** The forms written right, for every remedy that shows them. */
const FORMS =
  'Write `each thing in self { … }`, `each pot: Vessel in self { … }` or `each tool of tools { … }`.';

/** An `each`, the word next. Null having said once why it is not one. */
export function eachStatement(p: Parser, within: Enclosing = onItsOwn()): EachStatement | null {
  const keyword = p.take('name', 'each');
  if (keyword === null) {
    notAStatement(p, p.peek());
    return null;
  }
  const named = p.peek();
  if (named.kind !== 'name' || named.text.startsWith('$')) {
    p.diagnostics.refuse(
      named.kind === 'end' ? p.source.span(keyword.at.end) : named.at,
      named.kind === 'kind'
        ? `The name \`each\` gives what it walks starts with a small letter, and \`${named.text}\` starts with a capital.`
        : '`each` needs a name for what it walks.',
      FORMS,
    );
    return null;
  }
  if (isReserved(named.text)) {
    p.diagnostics.refuse(
      named.at,
      `\`${named.text}\` is a word of the language, so it cannot name what \`each\` walks.`,
      'Choose another word, as in `each thing in self { … }`.',
    );
    return null;
  }
  p.next();
  const variable = p.ident(named);

  let filter: KindExpr | null = null;
  if (punct(p.peek(), ':')) {
    p.next();
    filter = kindName(p);
    if (filter === null) return null;
  }

  const walk = p.peek();
  if (walk.kind !== 'name' || (walk.text !== 'in' && walk.text !== 'of')) {
    p.diagnostics.refuse(
      walk.kind === 'end' ? p.source.endSpan : walk.at,
      `\`each ${variable.text}\` is followed by \`in\` and a container, or \`of\` and a set role.`,
      FORMS,
    );
    return null;
  }
  p.next();
  const walks = walk.text;
  if (filter !== null && walks === 'of') {
    p.diagnostics.refuse(
      filter.at,
      'A kind picks out what a container holds, and `of` walks a set role whole.',
      `Write \`each ${variable.text}: ${written(filter)} in <container> { … }\`, or leave the kind out: \`each ${variable.text} of <set role> { … }\`.`,
    );
    return null;
  }
  if (punct(p.peek(), '{') || p.done) {
    p.diagnostics.refuse(
      p.done ? p.source.endSpan : p.peek().at,
      `\`each ${variable.text} ${walks}\` does not say what it walks.`,
      FORMS,
    );
    return null;
  }
  const over: Expr | null = expression(p);
  if (over === null) return null;
  if (!p.at('punct', '{')) {
    p.diagnostics.refuse(
      p.done ? p.source.endSpan : p.peek().at,
      'What `each` does goes in braces.',
      `Write \`each ${variable.text} ${walks} … { … }\`, as in \`each thing in self { send thing :stir }\`.`,
    );
    return null;
  }
  const body: Block | null = block(p, within);
  if (body === null) return null;
  return {
    kind: 'each',
    at: spanning(keyword.at, body.at),
    variable,
    filter,
    walks,
    over,
    body,
  };
}

/** A kind as written. */
function written(kind: KindExpr): string {
  return kind.library === null ? kind.name.text : `${kind.library.text}.${kind.name.text}`;
}
