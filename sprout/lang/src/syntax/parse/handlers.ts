// `on :illuminating (from, value) { … }` and `changed :lit (was) { … }`,
// as a kind, an object or the world writes one (the spec's Events,
// messages and the bus › Receiving).
//
// A handler is `on`, the message with its colon, its parameters in
// brackets where it names any, and a block; a hook is `changed`, the
// property, and the same. Parameters are positional and named as the
// author chose, `_` leaving one unnamed; how many a message passes, and
// what each is, is the checker's. A head that is wrong still has its
// block read, so what is wrong inside it is said too, and is then dropped.

import type { Ident } from '../ast.js';
import type { HandlerDeclaration, HookDeclaration, Parameters } from '../ast-events.js';
import type { Token } from '../lexer.js';
import { isReserved } from '../reserved.js';
import { spanning, type Span } from '../../source/source.js';
import { punct, type Parser } from './parser.js';
import { block, firstOnItsLine, type Enclosing } from './statements.js';

/** The two forms, as a remedy writes each. */
const FORMS = {
  on: {
    names: 'the message a handler answers',
    example: 'on :stir { … }',
    parameters: 'on :pong (_, value) { … }',
    what: 'message',
  },
  changed: {
    names: 'the property a hook watches',
    example: 'changed :lit (was) { … }',
    parameters: 'changed :lit (was) { … }',
    what: 'property',
  },
} as const;

/**
 * The spec's own handlers name parameters `from` and `to`, which are
 * words of the language; those two may name one, and no other word of
 * the language may.
 */
const PARAMETER_WORDS: ReadonlySet<string> = new Set(['to', 'from']);

/**
 * A handler, its `on` next. `owner` names the body it is in, for a
 * remedy; `startsMember` says where that body's next member starts,
 * which ends one never closed. Null having said why.
 */
export function handler(
  p: Parser,
  owner: string,
  startsMember: (token: Token) => boolean,
): HandlerDeclaration | null {
  const read = headed(p, 'on', owner, startsMember);
  if (read === null) return null;
  return {
    kind: 'handler',
    at: read.at,
    message: read.name,
    parameters: read.parameters,
    body: read.body,
  };
}

/** A hook, its `changed` next; as `handler`. */
export function hook(
  p: Parser,
  owner: string,
  startsMember: (token: Token) => boolean,
): HookDeclaration | null {
  const read = headed(p, 'changed', owner, startsMember);
  if (read === null) return null;
  return {
    kind: 'hook',
    at: read.at,
    property: read.name,
    parameters: read.parameters,
    body: read.body,
  };
}

/** What `on` and `changed` share: a symbol, parameters where written, and a block. */
function headed(
  p: Parser,
  word: keyof typeof FORMS,
  owner: string,
  startsMember: (token: Token) => boolean,
): { at: Span; name: Ident; parameters: Parameters; body: HandlerDeclaration['body'] } | null {
  const form = FORMS[word];
  const keyword = p.next();
  // A symbol starting a line of its own is the body's next property, not
  // what this names.
  const named = p.at('symbol') && !firstOnItsLine(p, p.peek()) ? p.next() : null;
  if (named === null) {
    const token = p.peek();
    // A word standing where the colon was left off is taken with the
    // refusal; the body's next member, its brace or a block is not.
    const missing =
      p.done ||
      punct(token, '}') ||
      punct(token, '{') ||
      punct(token, '(') ||
      p.atDeclarationStart() ||
      startsMember(token);
    if (!missing && token.kind !== 'punct') p.next();
    p.diagnostics.refuse(
      missing ? p.source.span(keyword.at.end) : token.at,
      `\`${word}\` names ${form.names}, with its colon.`,
      token.kind === 'name' && !missing
        ? `Write \`${word} :${token.text}\`, as in \`${form.example}\`.`
        : `Write \`${word} :<${form.what}> { … }\`, as in \`${form.example}\`.`,
    );
    stepOverRest(p, owner, word, startsMember);
    return null;
  }
  const written = `${word} :${named.text}`;
  let end = named.at.end;
  let parameters: Parameters | null = [];
  if (p.at('punct', '(')) {
    const read = parameterList(p, written, form.parameters, startsMember);
    parameters = read?.parameters ?? null;
    if (read !== null) end = read.close.at.end;
  }
  if (!p.at('punct', '{')) {
    if (parameters !== null) {
      p.diagnostics.refuse(
        p.source.span(end),
        `What \`${written}\` does goes in braces.`,
        `Write \`${written} { … }\`.`,
      );
    }
    return null;
  }
  const within: Enclosing = {
    owner,
    within: written,
    enclosed: true,
    startsMember,
    unclosed: false,
  };
  const body = block(p, within);
  if (body === null || parameters === null) return null;
  return { at: spanning(keyword.at, body.at), name: p.ident(named), parameters, body };
}

/** After a head that could not be read, its brackets and block, so neither is read as members. */
function stepOverRest(
  p: Parser,
  owner: string,
  word: string,
  startsMember: (token: Token) => boolean,
): void {
  if (p.at('punct', '(')) parameterList(p, word, '', startsMember, true);
  if (p.at('punct', '{')) {
    block(p, { owner, within: word, enclosed: true, startsMember, unclosed: false });
  }
}

/**
 * `(from, value)` — names or `_`, one comma between each, the `(` next.
 * Null having said why, with the brackets and what they hold stepped
 * over; `quiet` steps over them saying nothing, after a head already refused.
 */
function parameterList(
  p: Parser,
  written: string,
  example: string,
  startsMember: (token: Token) => boolean,
  quiet = false,
): { parameters: Parameters; close: Token } | null {
  const open = p.next();
  // Where the brackets close, before anything is taken: a `)` never
  // written takes nothing past the block's `{`, or the body's next member.
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
      for (let i = 0; i < close; i++) p.next();
      if (!quiet) {
        p.diagnostics.refuse(
          token.kind === 'end' ? p.source.endSpan : token.at,
          `The brackets after \`${written}\` are never closed.`,
          `Add a ) after its parameters, as in \`${example}\`.`,
        );
      }
      return null;
    }
    close += 1;
  }
  const inside: Token[] = [];
  for (let i = 0; i < close; i++) inside.push(p.next());
  const closer = p.next();
  if (quiet) return null;

  const refuse = (at: Span): null => {
    p.diagnostics.refuse(
      at,
      `\`${written}\` names its parameters in brackets, a comma between each.`,
      `Write names in lower case, or \`_\` for one left unnamed, as in \`${example}\`.`,
    );
    return null;
  };
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
  if (names.length === 0) return refuse(spanning(open.at, closer.at));

  const reserved = names.find((one) => isReserved(one.text) && !PARAMETER_WORDS.has(one.text));
  if (reserved !== undefined) {
    p.diagnostics.refuse(
      reserved.at,
      `\`${reserved.text}\` is a word of the language, so it cannot name a parameter.`,
      `Choose another name, or write \`_\` to leave it unnamed, as in \`${example}\`.`,
    );
    return null;
  }
  return {
    parameters: names.map((one) => (one.text === '_' ? null : p.ident(one))),
    close: closer,
  };
}
