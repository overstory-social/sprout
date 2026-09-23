// `without changed :lit from sprout.LightSource` — a member a composed
// kind contributes, left out (the spec's Suppressing a contribution):
// `on :m`, `changed :p`, a guard, or `as <role> for <verb>`, and the kind
// that declares it. The line never takes the body's next member for what
// it names, so a `without` left unfinished leaves that member to be read.

import type { MemberRef, WithoutDeclaration } from '../ast.js';
import { writtenMember } from '../ast.js';
import type { Token } from '../lexer.js';
import { spanning, type Span } from '../../source/source.js';
import { kindName } from './composition.js';
import { isGuardName } from './guards.js';
import { punct, type Parser } from './parser.js';

/** How a `without` is written, for a remedy to show. */
const WITHOUT_EXAMPLE = '`without changed :lit from sprout.LightSource`';

/**
 * `without changed :lit from sprout.LightSource` — a member a composed
 * kind contributes, left out (the spec's Suppressing a contribution).
 * `startsMember` says where the body's next member starts, so that one written after a
 * `without` with nothing in it is left for the body to read.
 */
export function without(
  p: Parser,
  startsMember: (token: Token) => boolean,
): WithoutDeclaration | null {
  const keyword = p.next();
  const member = memberNamed(p, keyword.at, startsMember);
  if (member === null) return null;
  const written = `without ${writtenMember(member)}`;

  const from = p.take('name', 'from');
  if (from === null) {
    p.diagnostics.refuse(
      endOf(p, member.at),
      `\`${written}\` does not say which kind it comes from.`,
      `Write \`from\` and the kind that declares it: \`${written} from <Kind>\`, as in ${WITHOUT_EXAMPLE}.`,
    );
    return null;
  }
  const first = p.peek();
  if (first.kind !== 'kind' && !(first.kind === 'name' && punct(p.peek(1), '.'))) {
    p.diagnostics.refuse(
      endsHere(p, startsMember) ? endOf(p, from.at) : first.at,
      `After \`from\` comes the kind that declares \`${writtenMember(member)}\`.`,
      `Name it as it is composed, with its capital: ${WITHOUT_EXAMPLE}.`,
    );
    return null;
  }
  const source = kindName(p);
  if (source === null) return null;
  return { kind: 'without', at: spanning(keyword.at, source.at), member, source };
}

/**
 * The member a `without` names: `on :m`, `changed :p`, a guard, or `as
 * <role> for <verb>`. Null having said why.
 */
function memberNamed(
  p: Parser,
  keyword: Span,
  startsMember: (token: Token) => boolean,
): MemberRef | null {
  const token = p.peek();
  // `on :stir` with its brackets or braces after it is the next member,
  // a handler as written, and not what this line leaves out.
  const written = punct(p.peek(2), '(') || punct(p.peek(2), '{');
  if (token.kind === 'name' && (token.text === 'on' || token.text === 'changed') && !written) {
    p.next();
    const named = namePart(p, 'symbol', startsMember);
    if (named === null) {
      const handler = token.text === 'on';
      p.diagnostics.refuse(
        endsHere(p, startsMember) ? endOf(p, token.at) : p.peek().at,
        handler
          ? '`on` names the message a handler answers, with its colon.'
          : '`changed` names the property a hook watches, with its colon.',
        handler
          ? 'Write `without on :<message> from <Kind>`, as in `without on :stir from Bellows`.'
          : `Write \`without changed :<property> from <Kind>\`, as in ${WITHOUT_EXAMPLE}.`,
      );
      return null;
    }
    const at = spanning(token.at, named.at);
    return token.text === 'on'
      ? { kind: 'handler-ref', at, message: p.ident(named) }
      : { kind: 'hook-ref', at, property: p.ident(named) };
  }
  // A guard's word with its brackets after it is the next member, a
  // guard as written, and not what this line leaves out.
  if (token.kind === 'name' && isGuardName(token.text) && !punct(p.peek(1), '(')) {
    p.next();
    return { kind: 'guard-ref', at: token.at, guard: token.text };
  }
  // `as <role> for <verb>` with its brace after it is the next member, a
  // play as written, and not what this line leaves out.
  if (token.kind === 'name' && token.text === 'as' && !playFollows(p)) {
    p.next();
    const role = namePart(p, 'name', startsMember);
    const said = role === null ? null : p.take('name', 'for');
    const verb = said === null ? null : namePart(p, 'name', startsMember);
    if (role === null || verb === null) {
      p.diagnostics.refuse(
        endsHere(p, startsMember) ? endOf(p, (said ?? role ?? token).at) : p.peek().at,
        '`as` names a role and the verb it plays it for.',
        'Write `without as <role> for <verb> from <Kind>`, as in `without as target for unlock from Lock`.',
      );
      return null;
    }
    return {
      kind: 'role-ref',
      at: spanning(token.at, verb.at),
      role: p.ident(role),
      verb: p.ident(verb),
    };
  }

  // An exclusive member is replaced by writing one's own (How members
  // combine), so there is nothing for `without` to do with a passage.
  if (token.kind === 'name' && token.text === 'passage') {
    const after = p.peek(1);
    const named =
      after.kind === 'name' && after.text !== 'default' && after.text !== 'from'
        ? after.text
        : '<name>';
    p.diagnostics.refuse(
      token.at,
      '`without` does not leave out a passage.',
      `Write your own \`passage ${named} { … }\` in this body instead: a body's own passage is the one that applies.`,
    );
    p.next();
    return null;
  }

  // Nothing where the member goes: the body's next member, its brace, or
  // `from` straight after the word.
  const beforeFrom = p.peek(1).kind === 'name' && p.peek(1).text === 'from';
  if (
    (token.kind === 'name' && token.text === 'from') ||
    (endsHere(p, startsMember) && !beforeFrom)
  ) {
    p.diagnostics.refuse(
      keyword,
      '`without` does not say what to leave out.',
      `Name a handler, a hook, a guard or a role, and the kind it comes from: ${WITHOUT_EXAMPLE}.`,
    );
    return null;
  }
  p.diagnostics.refuse(
    token.at,
    `\`without\` names a handler, a hook, a guard or a role, not ${p.describe(token)}.`,
    token.kind === 'symbol'
      ? `A handler is written \`on :${token.text}\` and a hook \`changed :${token.text}\`, as in ${WITHOUT_EXAMPLE}.`
      : `Write one as it is declared: \`on :<message>\`, \`changed :<property>\`, \`depart\`, \`release\`, \`accept\` or \`as <role> for <verb>\`, as in ${WITHOUT_EXAMPLE}.`,
  );
  // A member word written in its place is part of this line, not the
  // next member, so the body does not read it again.
  if (startsMember(token)) p.next();
  return null;
}

/** Whether `as <role> for <verb> {` is written from here: a play, not a member named. */
function playFollows(p: Parser): boolean {
  const word = (ahead: number): boolean => {
    const token = p.peek(ahead);
    return token.kind === 'name' || token.kind === 'kind';
  };
  return (
    word(1) &&
    p.peek(2).kind === 'name' &&
    p.peek(2).text === 'for' &&
    word(3) &&
    punct(p.peek(4), '{')
  );
}

/**
 * The name a member form writes next, `:lit` after `changed` or `target`
 * after `as`, or null. A word that begins the body's next member is taken
 * only where `from` follows it, so a `without` left unfinished does not
 * take the line after it: `without changed` over `:open true` leaves the
 * property to be read.
 */
function namePart(
  p: Parser,
  kind: 'symbol' | 'name',
  startsMember: (token: Token) => boolean,
): Token | null {
  const token = p.peek();
  if (token.kind !== kind || (kind === 'name' && (token.text === 'from' || token.text === 'for'))) {
    return null;
  }
  const next = p.peek(1);
  const fromFollows = next.kind === 'name' && next.text === 'from';
  if (startsMember(token) && !fromFollows && !endsAfter(p, startsMember)) {
    return null;
  }
  return p.next();
}

/**
 * Whether the token after the next one ends a member: the body's brace,
 * the end of the file, or the start of another member.
 */
function endsAfter(p: Parser, startsMember: (token: Token) => boolean): boolean {
  const after = p.peek(1);
  return punct(after, '}') || after.kind === 'end' || startsMember(after);
}

/**
 * Whether what comes next is not part of this member: the body's brace,
 * the end of the file, a declaration, or the next member.
 */
function endsHere(p: Parser, startsMember: (token: Token) => boolean): boolean {
  const token = p.peek();
  return punct(token, '}') || p.done || p.atDeclarationStart() || startsMember(token);
}

/** The zero-width span just after something, where what should follow it is missing. */
function endOf(p: Parser, at: Span): Span {
  return p.source.span(at.end, at.end);
}
