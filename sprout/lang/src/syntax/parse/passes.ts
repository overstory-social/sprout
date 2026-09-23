// `pass :illuminating (true)` and `pass any (self.get(:open))`, as a
// kind, an object or the world writes one (the spec's Events, messages and
// the bus › Containers route).
//
// A pass rule is `pass`, the message with its colon or `any`, and a
// condition in brackets. What the condition may read, and that it is a
// boolean, is the checker's.

import type { Ident, PassDeclaration } from '../ast.js';
import type { Token } from '../lexer.js';
import { spanning } from '../../source/source.js';
import { expression } from './expressions.js';
import { punct, type Parser } from './parser.js';
import { skipBracketed } from './recovery.js';
import { firstOnItsLine } from './statements.js';

const EXAMPLE = '`pass any (self.get(:open))`';

/**
 * A pass rule, its `pass` next. `startsMember` says where the body's next
 * member starts, which is never part of one. Null having said why.
 */
export function passRule(
  p: Parser,
  startsMember: (token: Token) => boolean,
): PassDeclaration | null {
  const keyword = p.next();
  const head = p.peek();
  let message: Ident | null;
  // A symbol starting a line of its own is the body's next property.
  if (head.kind === 'symbol' && !firstOnItsLine(p, head)) message = p.ident(p.next());
  else if (head.kind === 'name' && head.text === 'any') {
    p.next();
    message = null;
  } else {
    const missing = p.done || punct(head, '}') || punct(head, '(') || startsMember(head);
    if (!missing && head.kind !== 'punct') p.next();
    p.diagnostics.refuse(
      missing ? p.source.span(keyword.at.end) : head.at,
      '`pass` names a message, with its colon, or `any` for every message it does not name.',
      head.kind === 'name' && !missing && head.text !== 'any'
        ? `Write \`pass :${head.text} (…)\` or \`pass any (…)\`, as in ${EXAMPLE}.`
        : `Write \`pass :<message> (…)\` or \`pass any (…)\`, as in ${EXAMPLE}.`,
    );
    if (p.at('punct', '(')) {
      p.next();
      skipBracketed(p, ')');
    }
    return null;
  }
  const written = message === null ? 'pass any' : `pass :${message.text}`;

  const open = p.take('punct', '(');
  if (open === null) {
    p.diagnostics.refuse(
      p.source.span((message?.at ?? head.at).end),
      `\`${written}\` says whether it lets the message through, in brackets.`,
      `Write \`${written} (true)\`, \`${written} (false)\`, or a condition, as in ${EXAMPLE}.`,
    );
    return null;
  }
  if (p.at('punct', ')')) {
    const close = p.next();
    p.diagnostics.refuse(
      spanning(open.at, close.at),
      `\`${written}\` says nothing inside its brackets.`,
      `Write \`${written} (true)\`, \`${written} (false)\`, or a condition, as in ${EXAMPLE}.`,
    );
    return null;
  }
  if (!p.deeper(open.at)) {
    skipBracketed(p, ')');
    return null;
  }
  try {
    const rule = expression(p);
    if (rule === null) {
      skipBracketed(p, ')');
      return null;
    }
    const close = p.take('punct', ')');
    if (close === null) {
      p.diagnostics.refuse(
        p.done ? p.source.endSpan : p.peek().at,
        `The condition of \`${written}\` ends here, and its bracket is never closed.`,
        'Add a ) after the condition.',
      );
      skipBracketed(p, ')');
      return null;
    }
    return { kind: 'pass', at: spanning(keyword.at, close.at), message, rule };
  } finally {
    p.depth -= 1;
  }
}
