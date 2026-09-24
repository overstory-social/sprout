// `connect onward to cell`, read (the spec's Verbs › Links, for space
// that does not exist yet): the word, the name of one of `self`'s links,
// `to`, and what it leads to. Which links `self` has, and that the
// destination is a binding holding a place, are the checker's.
//
// A refused one costs only itself: a word the next statement or the
// body's next member starts with is never taken for any part of it.

import type { ConnectStatement } from '../ast.js';
import { spanning } from '../../source/source.js';
import { punct, type Parser } from './parser.js';
import { objectPath } from './paths.js';
import { notAStatement, onItsOwn, startsNext, type Enclosing } from './statements.js';

const EXAMPLE = '`connect onward to cell`';

/** `connect onward to cell`. Null having said why. */
export function connectStatement(
  p: Parser,
  within: Enclosing = onItsOwn(),
): ConnectStatement | null {
  const keyword = p.take('name', 'connect');
  if (keyword === null) {
    notAStatement(p, p.peek());
    return null;
  }
  const head = p.peek();
  const gap = (token = p.peek()): boolean =>
    token.kind === 'end' ||
    punct(token, '}') ||
    p.atDeclarationStart() ||
    ((token.kind === 'name' || token.kind === 'symbol') && startsNext(p, within, token));
  if (head.kind !== 'name' || head.text === 'to' || gap(head)) {
    const stray = head.kind === 'kind' || head.kind === 'integer' || head.kind === 'string';
    if (stray) p.next();
    p.diagnostics.refuse(
      stray ? head.at : p.source.span(keyword.at.end),
      head.kind === 'kind'
        ? `\`${head.text}\` starts with a capital, and a link's name is written in lower case.`
        : '`connect` does not say which link it assigns.',
      `Name one of \`self\`'s links, and what it leads to, as in ${EXAMPLE}.`,
    );
    return null;
  }
  const link = p.ident(p.next());
  const to = p.take('name', 'to');
  if (to === null) {
    p.diagnostics.refuse(
      p.source.span(link.at.end),
      `\`connect ${link.text}\` does not say where the link leads.`,
      `Write \`to\` and the place: \`connect ${link.text} to cell\`.`,
    );
    return null;
  }
  const place = p.peek();
  if (place.kind !== 'name' || gap(place)) {
    const stray = place.kind === 'kind' || place.kind === 'integer' || place.kind === 'string';
    if (stray) p.next();
    p.diagnostics.refuse(
      stray ? place.at : p.source.span(to.at.end),
      `After \`to\` comes the place \`${link.text}\` leads to.`,
      `Name a binding that holds it, as in \`connect ${link.text} to cell\` after \`let cell = spawn …\`.`,
    );
    return null;
  }
  p.next();
  const destination = objectPath(p, place);
  if (destination === null) return null;
  return { kind: 'connect', at: spanning(keyword.at, destination.at), link, destination };
}
