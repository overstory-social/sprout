// `as target for unlock { permit { … } do { … } }` and `as actor for take
// { … }`, as a kind, an object or the world writes one (the spec's Verbs ›
// Playing a role, The actor's own part, A role-player narrows its own
// options).
//
// A play is its head, `as <role> for <verb>`, and a body in braces that
// holds, in any order, the `from` lines that narrow a value role, one
// `permit` and one `do`, each read by the statement reader. Which verb and
// which role the head names, and what the blocks may do, are the second
// tier's. A play that says nothing is refused here, since that much is
// visible in what was written.

import type {
  Block,
  FromDeclaration,
  IntegerLiteral,
  IntegerRange,
  PlayDeclaration,
  RoleRef,
} from '../ast.js';
import type { Token } from '../lexer.js';
import { spanning, type Span } from '../../source/source.js';
import { punct, type Parser } from './parser.js';
import { block, type Enclosing } from './statements.js';

/** How a play is written, for a remedy to show. */
const EXAMPLE = '`as target for unlock { permit { … } do { … } }`';

/**
 * A play, its `as` next. `owner` names the body it is in, for a remedy;
 * `startsMember` says where that body's next member starts, which ends a
 * play never closed. Null having said why.
 */
export function play(
  p: Parser,
  owner: string,
  startsMember: (token: Token) => boolean,
): PlayDeclaration | null {
  const keyword = p.next();
  const head = playHead(p, keyword, startsMember);
  if (head === null) {
    // What is left of the head, and the braces after it, are this play's,
    // and are stepped over with it rather than read as members.
    stepOverHead(p, startsMember);
    return null;
  }
  const written = `as ${head.role.text} for ${head.verb.text}`;
  const open = p.take('punct', '{');
  if (open === null) {
    p.diagnostics.refuse(
      p.source.span(head.at.end),
      `What \`${written}\` does goes in braces.`,
      `Write \`${written} { permit { … } do { … } }\`, with a \`permit\`, a \`do\`, or both.`,
    );
    return null;
  }

  const narrows: FromDeclaration[] = [];
  let permit: Block | null = null;
  let effect: Block | null = null;
  let whole = true;
  for (;;) {
    const close = p.take('punct', '}');
    if (close !== null) {
      if (!whole) return null;
      if (permit === null && effect === null) {
        p.diagnostics.refuse(
          head.at,
          `\`${written}\` says nothing: write a \`permit { … }\`, a \`do { … }\`, or both.`,
          `A \`permit\` decides whether it may happen and a \`do\` says what happens, as in ${EXAMPLE}.`,
        );
        return null;
      }
      return {
        kind: 'play',
        at: spanning(keyword.at, close.at),
        head,
        narrows,
        permit,
        do: effect,
      };
    }
    // The file's end or the next declaration is the enclosing body's to
    // say; the body's next member is this play's.
    if (p.done || p.atDeclarationStart()) return null;
    const token = p.peek();
    if (startsMember(token)) {
      p.diagnostics.refuse(
        token.at,
        `\`${written}\` is never closed.`,
        `Add a } after what it holds. Every { inside it, after a \`permit\`, a \`do\`, an \`if\` or an \`else\`, needs its own }.`,
      );
      return null;
    }

    if (token.kind === 'name' && (token.text === 'permit' || token.text === 'do')) {
      const word = p.next();
      if (!p.at('punct', '{')) {
        p.diagnostics.refuse(
          p.done ? p.source.endSpan : p.peek().at,
          `What \`${word.text}\` ${word.text === 'permit' ? 'decides' : 'does'} goes in braces.`,
          `Write \`${word.text} { … }\` inside \`${written}\`.`,
        );
        whole = false;
        stepToNextPart(p, startsMember);
        continue;
      }
      const within: Enclosing = {
        owner,
        within: word.text,
        enclosed: true,
        startsMember,
        unclosed: false,
      };
      const read = block(p, within);
      if (within.unclosed) return null;
      if (read === null) {
        whole = false;
        continue;
      }
      const before = word.text === 'permit' ? permit : effect;
      if (before !== null) {
        p.diagnostics.refuse(
          word.at,
          `\`${written}\` has two \`${word.text}\`s.`,
          word.text === 'permit'
            ? 'Keep one, and write what both decide in it with `if` and `else if`.'
            : 'Keep one, and write what both do in it.',
        );
        whole = false;
        continue;
      }
      if (word.text === 'permit') permit = read;
      else effect = read;
      continue;
    }

    if (token.kind === 'name' && p.peek(1).kind === 'name' && p.peek(1).text === 'from') {
      const narrowing = fromLine(p);
      if (narrowing === null) whole = false;
      else narrows.push(narrowing);
      continue;
    }

    p.diagnostics.refuse(
      token.at,
      `\`${written}\` holds a \`permit\`, a \`do\` and \`<role> from …\` lines, not ${p.describe(token)}.`,
      `Write it as ${EXAMPLE}.`,
    );
    whole = false;
    stepOverStray(p);
  }
}

/**
 * `as target for unlock` — the role, a lower-case word or `actor`, and the
 * verb, a lower-case word. Null having said why.
 */
function playHead(
  p: Parser,
  keyword: Token,
  startsMember: (token: Token) => boolean,
): RoleRef | null {
  const role = headWord(p, keyword.at, 'role', startsMember);
  if (role === null) return null;
  const said = p.take('name', 'for');
  if (said === null) {
    p.diagnostics.refuse(
      p.at('punct', '{') || p.done ? p.source.span(role.at.end) : p.peek().at,
      `\`as ${role.text}\` does not say which verb it is played for.`,
      `Write \`for\` and the verb: \`as ${role.text} for <verb> { … }\`, as in ${EXAMPLE}.`,
    );
    return null;
  }
  const verb = headWord(p, said.at, 'verb', startsMember);
  if (verb === null) return null;
  return {
    kind: 'role-ref',
    at: spanning(keyword.at, verb.at),
    role: p.ident(role),
    verb: p.ident(verb),
  };
}

/**
 * The role or the verb in a head, after `before`, or null having said why.
 * A word that starts the body's next member is that member's, and is
 * never a role or a verb, since neither may take a word of the language.
 */
function headWord(
  p: Parser,
  before: Span,
  what: 'role' | 'verb',
  startsMember: (token: Token) => boolean,
): Token | null {
  const token = p.peek();
  const example =
    what === 'role'
      ? '`as <role> for <verb> { … }`, as in `as target for unlock { … }`'
      : '`as <role> for <verb> { … }`, as in `as tool for unlock { … }`';
  if (token.kind === 'kind') {
    p.next();
    const lower = token.text.charAt(0).toLowerCase() + token.text.slice(1);
    p.diagnostics.refuse(
      token.at,
      `A ${what} is named in lower case, and \`${token.text}\` starts with a capital.`,
      `Write \`${lower}\`, as the verb declares it.`,
    );
    return null;
  }
  if (token.kind === 'name' && token.text !== 'for' && !startsMember(token)) return p.next();
  p.diagnostics.refuse(
    token.kind === 'name' || punct(token, '{') || token.kind === 'end'
      ? p.source.span(before.end)
      : token.at,
    what === 'role' ? '`as` names the role this plays.' : '`for` names the verb the role is in.',
    `Write ${example}.`,
  );
  return null;
}

/**
 * `topic from :knows` or `dial from 1 to 12`, the role's name next. Null
 * having said why, with the rest of the line stepped over.
 */
function fromLine(p: Parser): FromDeclaration | null {
  const role = p.next();
  const from = p.next();
  const remedy = `Write \`${role.text} from :<property>\`, as in \`topic from :knows\`, or a range, as in \`${role.text} from 1 to 12\`.`;
  const token = p.peek();
  if (token.kind === 'symbol') {
    p.next();
    return {
      kind: 'from',
      at: spanning(role.at, token.at),
      role: p.ident(role),
      by: { kind: 'symbol-expr', at: token.at, name: p.ident(token) },
    };
  }
  const min = integerLiteral(p);
  if (min === null) {
    p.diagnostics.refuse(
      atOrAfter(p, from.at),
      `\`${role.text} from\` names the property that holds its options, or a range of numbers.`,
      remedy,
    );
    return null;
  }
  if (p.take('name', 'to') === null) {
    p.diagnostics.refuse(
      atOrAfter(p, min.at),
      `\`${role.text} from ${min.value}\` does not say where the range ends.`,
      `Write \`to\` and the highest number: \`${role.text} from ${min.value} to 12\`.`,
    );
    return null;
  }
  const max = integerLiteral(p);
  if (max === null) {
    p.diagnostics.refuse(
      atOrAfter(p, min.at),
      `\`${role.text} from ${min.value} to\` does not say where the range ends.`,
      `Write the highest number after \`to\`: \`${role.text} from ${min.value} to 12\`.`,
    );
    return null;
  }
  const range: IntegerRange = { kind: 'integer-range', at: spanning(min.at, max.at), min, max };
  return { kind: 'from', at: spanning(role.at, max.at), role: p.ident(role), by: range };
}

/** A whole number, with its sign where one is written; null, taking nothing, where none is here. */
function integerLiteral(p: Parser): IntegerLiteral | null {
  if (p.at('integer')) {
    const token = p.next();
    return { kind: 'integer', at: token.at, value: Number(token.text) };
  }
  if (punct(p.peek(), '-') && p.peek(1).kind === 'integer') {
    const sign = p.next();
    const token = p.next();
    return { kind: 'integer', at: spanning(sign.at, token.at), value: -Number(token.text) };
  }
  return null;
}

/** The token that is wrong, or just after what came before it where the line ended there. */
function atOrAfter(p: Parser, before: Span): Span {
  const token = p.peek();
  if (token.kind === 'end' || punct(token, '}') || punct(token, '{')) {
    return p.source.span(before.end);
  }
  if (token.kind === 'name' && (token.text === 'permit' || token.text === 'do')) {
    return p.source.span(before.end);
  }
  p.next();
  return token.at;
}

/**
 * What was written for a block left without braces, stepped over to the
 * next part of the play, its `}`, or the body's next member.
 */
function stepToNextPart(p: Parser, startsMember: (token: Token) => boolean): void {
  let depth = 0;
  while (!p.done && !p.atDeclarationStart()) {
    const token = p.peek();
    if (depth === 0) {
      if (punct(token, '}') || startsMember(token)) return;
      if (token.kind === 'name' && (token.text === 'permit' || token.text === 'do')) return;
      if (token.kind === 'name' && p.peek(1).kind === 'name' && p.peek(1).text === 'from') return;
    }
    if (punct(token, '{')) depth += 1;
    else if (punct(token, '}')) depth -= 1;
    p.next();
  }
}

/**
 * A word no play holds, stepped over with the brackets or braces written
 * after it, so what they hold is not read as the play's own.
 */
function stepOverStray(p: Parser): void {
  if (!p.at('punct', '{') && !p.at('punct', '(')) p.next();
  if (!p.at('punct', '{') && !p.at('punct', '(')) return;
  const open = p.peek().text;
  const close = open === '{' ? '}' : ')';
  let depth = 0;
  while (!p.done && !p.atDeclarationStart()) {
    const token = p.next();
    if (punct(token, open)) depth += 1;
    else if (punct(token, close) && --depth === 0) return;
  }
}

/**
 * The rest of a head that could not be read, and the braces after it,
 * stepped over whole up to the `}` that closes them; no further than the
 * body's next member or a declaration, where they never close.
 */
function stepOverHead(p: Parser, startsMember: (token: Token) => boolean): void {
  while (!p.done && !p.atDeclarationStart() && !p.at('punct', '{') && !p.at('punct', '}')) {
    if (startsMember(p.peek())) return;
    p.next();
  }
  let depth = 0;
  while (p.at('punct', '{') || (depth > 0 && !p.done && !p.atDeclarationStart())) {
    const token = p.peek();
    if (depth === 1 && startsMember(token)) return;
    p.next();
    if (punct(token, '{')) depth += 1;
    else if (punct(token, '}') && --depth === 0) return;
  }
}
