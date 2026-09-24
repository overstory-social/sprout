// `describe { … }`, as a kind or an object writes one (the spec's Prose;
// Kinds › Declaring and composing). A describe is its word and a block,
// read by the statement reader as any body's is; what the statements may
// do in it, and that it gives its words with `text`, is the checker's. A
// block never closed ends where the body's next member starts.

import type { DescribeDeclaration } from '../ast-speech.js';
import type { Token } from '../lexer.js';
import { spanning } from '../../source/source.js';
import type { Parser } from './parser.js';
import { block, type Enclosing } from './statements.js';

/** How a describe is written, for a remedy. */
const EXAMPLE = 'describe { text "Slat-sided, heavier than it looks." }';

/**
 * A describe, its word next. `owner` names the body it is in, for a
 * remedy; `startsMember` says where that body's next member starts, which
 * ends a block never closed. Null having said why.
 */
export function describe(
  p: Parser,
  owner: string,
  startsMember: (token: Token) => boolean,
): DescribeDeclaration | null {
  const keyword = p.next();
  if (!p.at('punct', '{')) {
    p.diagnostics.refuse(
      p.done ? p.source.span(keyword.at.end) : p.peek().at,
      'What `describe` gives goes in braces.',
      `Write \`${EXAMPLE}\`.`,
    );
    return null;
  }
  const within: Enclosing = {
    owner,
    within: 'describe',
    enclosed: true,
    startsMember,
    unclosed: false,
  };
  const body = block(p, within);
  if (body === null) return null;
  return { kind: 'describe', at: spanning(keyword.at, body.at), body };
}
