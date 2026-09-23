// `send oak_door :unlock_attempt`, `send from :unlock_failed with 2` and
// `broadcast :illuminating with true`, read (the spec's Events, messages
// and the bus › Sending). A `send` names who it is sent to, a binding or
// an identifier or a dotted path to one; both name the message with its
// colon, and `with` and a value where it carries one. What the message
// is and what it carries are the checker's.
//
// A refused one costs only itself: a word the next statement or the
// body's next member starts with, or a property's name starting a line,
// is never taken for any part of it.

import type { BroadcastStatement, Expr, Ident, SendStatement } from '../ast.js';
import { writtenPath } from '../ast.js';
import type { Token } from '../lexer.js';
import { spanning, type Span } from '../../source/source.js';
import { expression } from './expressions.js';
import { punct, type Parser } from './parser.js';
import { objectPath } from './paths.js';
import {
  firstOnItsLine,
  notAStatement,
  onItsOwn,
  startsNext,
  type Enclosing,
} from './statements.js';

/** `send oak_door :unlock_attempt`, `send from :unlock_failed with 2`. Null having said why. */
export function sendStatement(p: Parser, within: Enclosing = onItsOwn()): SendStatement | null {
  const keyword = p.take('name', 'send');
  if (keyword === null) {
    notAStatement(p, p.peek());
    return null;
  }
  const head = p.peek();
  if (head.kind !== 'name' || startsNext(p, within, head) || p.atDeclarationStart()) {
    const stray = head.kind === 'kind' || head.kind === 'integer' || head.kind === 'string';
    if (stray) p.next();
    p.diagnostics.refuse(
      stray ? head.at : p.source.span(keyword.at.end),
      head.kind === 'kind'
        ? `\`${head.text}\` starts with a capital, so it is not the name of anything here.`
        : '`send` does not say what to send the message to.',
      'Write the thing and the message, as in `send oak_door :unlock_attempt`.',
    );
    return null;
  }
  p.next();
  const target = objectPath(p, head);
  if (target === null) return null;
  const message = messageOf(p, within, target.at, `send ${writtenPath(target)}`);
  if (message === null) return null;
  const value = carried(p, within, `send ${writtenPath(target)} :${message.text}`);
  if (value === undefined) return null;
  return {
    kind: 'send',
    at: spanning(keyword.at, (value ?? message).at),
    target,
    message,
    value,
  };
}

/** `broadcast :illuminating with true`. Null having said why. */
export function broadcastStatement(
  p: Parser,
  within: Enclosing = onItsOwn(),
): BroadcastStatement | null {
  const keyword = p.take('name', 'broadcast');
  if (keyword === null) {
    notAStatement(p, p.peek());
    return null;
  }
  const message = messageOf(p, within, keyword.at, 'broadcast');
  if (message === null) return null;
  const value = carried(p, within, `broadcast :${message.text}`);
  if (value === undefined) return null;
  return { kind: 'broadcast', at: spanning(keyword.at, (value ?? message).at), message, value };
}

/**
 * The message after `written`, which ended at `after`: a symbol on the
 * same line, since one starting a line is the body's next property. Null
 * having said why.
 */
function messageOf(p: Parser, within: Enclosing, after: Span, written: string): Ident | null {
  const token = p.peek();
  if (token.kind === 'symbol' && !firstOnItsLine(p, token)) return p.ident(p.next());
  const bare = token.kind === 'name' && !startsNext(p, within, token) && !p.atDeclarationStart();
  if (bare) p.next();
  p.diagnostics.refuse(
    bare ? token.at : p.source.span(after.end),
    `\`${written}\` does not say which message.`,
    bare
      ? `A message is written with its colon: \`${written} :${token.text}\`.`
      : `Write the message with its colon, as in \`${written} :unlock_attempt\`.`,
  );
  return null;
}

/**
 * What `with` gives the message, null where no `with` is written, or
 * undefined where one is and nothing readable follows it, having said so.
 */
function carried(p: Parser, within: Enclosing, written: string): Expr | null | undefined {
  const word = p.take('name', 'with');
  if (word === null) return null;
  const next: Token = p.peek();
  const nothing =
    p.done ||
    punct(next, '}') ||
    startsNext(p, within, next) ||
    p.atDeclarationStart() ||
    (next.kind === 'symbol' && firstOnItsLine(p, next));
  if (nothing) {
    p.diagnostics.refuse(
      p.source.span(word.at.end),
      `\`with\` is followed by the value \`${written}\` carries.`,
      `Write the value after it, as in \`${written} with true\`.`,
    );
    return undefined;
  }
  return expression(p) ?? undefined;
}
