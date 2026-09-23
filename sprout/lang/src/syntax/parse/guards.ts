// `depart (to) { … }`, `release (item, to) { … }` and `accept (item,
// from) { … }`, as a kind, an object or the world writes one (the spec's
// Movement and consent › The three roles).
//
// A guard is its word, its parameters in brackets and a block. The
// parameters are positional: `depart` takes one, the others two, and the
// names are the author's. A guard whose parameters are wrong still has
// its block read, so what is wrong inside it is said too, and is then
// dropped. What the statements may do in a guard is the checker's.

import { GUARD_NAMES, type GuardDeclaration, type GuardName, type Ident } from '../ast.js';
import type { Token } from '../lexer.js';
import { isReserved } from '../reserved.js';
import { spanning, type Span } from '../../source/source.js';
import { punct, type Parser } from './parser.js';
import { block, type Enclosing } from './statements.js';

/** Whether a word is one of the three guards. */
export function isGuardName(word: string): word is GuardName {
  return (GUARD_NAMES as readonly string[]).includes(word);
}

/** How each guard is written, and what its parameters name, for a refusal to show. */
const SHAPES: Readonly<Record<GuardName, { written: string; names: string; count: number }>> = {
  depart: { written: 'depart (to)', names: 'where the thing is going', count: 1 },
  release: { written: 'release (item, to)', names: 'the thing and where it goes', count: 2 },
  accept: { written: 'accept (item, from)', names: 'the thing and where it comes from', count: 2 },
};

/**
 * The spec's own guards name their parameters `to` and `from`, which are
 * words of the language; those two may name one, and no other word of
 * the language may.
 */
const PARAMETER_WORDS: ReadonlySet<string> = new Set(['to', 'from']);

/**
 * A guard, its word next. `owner` names the body it is in, for a remedy;
 * `startsMember` says where that body's next member starts, which ends a
 * guard never closed. Null having said why.
 */
export function guard(
  p: Parser,
  owner: string,
  startsMember: (token: Token) => boolean,
): GuardDeclaration | null {
  const keyword = p.next();
  const name = keyword.text as GuardName;
  const read = guardParameters(p, keyword, name, startsMember);
  if (!p.at('punct', '{')) {
    if (read !== null) {
      p.diagnostics.refuse(
        p.source.span(read.close.at.end),
        `What \`${name}\` decides goes in braces.`,
        `Write \`${SHAPES[name].written} { … }\`, ending in \`allow\` or \`refuse\` where it decides.`,
      );
    }
    return null;
  }
  const within: Enclosing = { owner, within: name, enclosed: true, startsMember, unclosed: false };
  const body = block(p, within);
  if (body === null || read === null) return null;
  return {
    kind: 'guard',
    at: spanning(keyword.at, body.at),
    guard: name,
    parameters: read.parameters,
    body,
  };
}

/**
 * `(item, to)` — the names in brackets, as many as the guard takes, and
 * the bracket that closes them. Null having said why, with the brackets
 * and what they hold stepped over.
 */
function guardParameters(
  p: Parser,
  keyword: Token,
  name: GuardName,
  startsMember: (token: Token) => boolean,
): { parameters: Ident[]; close: Token } | null {
  const shape = SHAPES[name];
  const refuse = (at: Span): null => {
    p.diagnostics.refuse(
      at,
      `\`${name}\` names ${shape.names}: ${shape.count === 1 ? 'one name' : 'two names'} in brackets.`,
      `Write \`${shape.written} { … }\`.`,
    );
    return null;
  };

  const open = p.take('punct', '(');
  if (open === null) return refuse(p.done ? p.source.span(keyword.at.end) : p.peek().at);

  // Where the brackets close, before anything is taken: a `)` never
  // written takes nothing past the guard's own `{`, or the body's next
  // member.
  let close = 0;
  for (;;) {
    const token = p.peek(close);
    if (punct(token, ')')) break;
    const stop =
      token.kind === 'end' ||
      punct(token, '{') ||
      punct(token, '}') ||
      p.atDeclarationStart(close) ||
      startsMember(token);
    if (stop) {
      const at = token.kind === 'end' ? p.source.endSpan : token.at;
      for (let i = 0; i < close; i++) p.next();
      p.diagnostics.refuse(
        at,
        `The brackets after \`${name}\` are never closed.`,
        `Write \`${shape.written} { … }\`.`,
      );
      return null;
    }
    close += 1;
  }

  const inside: Token[] = [];
  for (let i = 0; i < close; i++) inside.push(p.next());
  const closer = p.next();

  // `name` and `,` in turn, and nothing else.
  const names: Token[] = [];
  for (const [i, token] of inside.entries()) {
    const wanted = i % 2 === 0 ? 'name' : 'comma';
    if (wanted === 'comma' ? punct(token, ',') : token.kind === 'name') {
      if (wanted === 'name') names.push(token);
      continue;
    }
    return refuse(token.at);
  }
  if (inside.length > 0 && punct(inside.at(-1)!, ',')) return refuse(inside.at(-1)!.at);
  if (names.length > shape.count) return refuse(names[shape.count]!.at);
  if (names.length < shape.count) return refuse(closer.at);

  const reserved = names.find((one) => isReserved(one.text) && !PARAMETER_WORDS.has(one.text));
  if (reserved !== undefined) {
    p.diagnostics.refuse(
      reserved.at,
      `\`${reserved.text}\` is a word of the language, so it cannot name what \`${name}\` is given.`,
      `Choose another name, as in \`${shape.written} { … }\`.`,
    );
    return null;
  }
  return { parameters: names.map((one) => p.ident(one)), close: closer };
}
