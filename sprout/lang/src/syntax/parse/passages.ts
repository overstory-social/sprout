// `passage greeting { … }` and `passage taken default { You take
// {target}. }`, as a kind, an object or the world writes one (the spec's
// Prose › Passages; Kinds › How members combine for `default`).
//
// The lexer hands the body over as one `passage-body` token: this reads
// the header, and `prose.ts` what the body says. A header that cannot be read costs its own passage and nothing after
// it. The lexer opens a body only after a header whose words all stand
// on the line of its `passage`, so what is taken with a broken header is
// the body written for it, and a header left without braces never takes
// the next member's.

import type { PassageDeclaration } from '../ast.js';
import { HEADER_KINDS, HEADER_WORDS, type Token } from '../lexer.js';
import type { Node } from '../../source/nodes.js';
import { spanning, type Span } from '../../source/source.js';
import type { Parser } from './parser.js';
import type { MemberReaders } from './bodies.js';
import { readProse } from './prose.js';

/** A header's shape, for a remedy to show. */
const written = (name: string, yields = false): string =>
  `\`passage ${name}${yields ? ' default' : ''} { … }\``;

/**
 * `passage <name> [default] { … }`. Null having said why, with the header
 * and the body written for it stepped over.
 */
export function passage<M>(p: Parser, readers: MemberReaders<M>): PassageDeclaration | null {
  const keyword = p.next();
  const onItsLine = (token: Token): boolean =>
    !p.source.text.slice(keyword.at.end, token.at.start).includes('\n');

  // The words before the body, where the lexer found one for this header:
  // as it does, stopping at another `passage` or at the end of the line.
  const words: Token[] = [];
  let body: Token | null = null;
  for (let ahead = 0; ahead <= HEADER_WORDS; ahead++) {
    const token = p.peek(ahead);
    if (token.kind === 'passage-body') {
      body = token;
      break;
    }
    if (!HEADER_KINDS.has(token.kind) || token.text === 'passage' || !onItsLine(token)) break;
    words.push(token);
  }
  if (body === null) return withoutBody(p, keyword, readers, onItsLine);

  const take = (): void => {
    for (let i = 0; i <= words.length; i++) p.next();
  };
  const refuse = (at: Span, message: string, remedy: string): null => {
    p.diagnostics.refuse(at, message, remedy);
    take();
    return null;
  };

  const [first, ...rest] = words;
  if (first === undefined) {
    return refuse(
      p.source.span(body.at.start, body.at.start),
      'A passage needs a name.',
      `A passage's name is a lower-case word before its braces: ${written('greeting')}.`,
    );
  }
  if (isDefault(first)) {
    const next = rest[0];
    if (next !== undefined && next.kind === 'name') {
      return refuse(
        first.at,
        "`default` comes after a passage's name.",
        `Write ${written(next.text, true)}.`,
      );
    }
    return refuse(
      first.at,
      'A passage needs a name.',
      `A passage's name comes before \`default\`: ${written('greeting', true)}.`,
    );
  }
  if (first.kind !== 'name') return refuse(first.at, ...notAName(p, first));

  let stray = rest;
  const yields = stray[0] !== undefined && isDefault(stray[0]);
  if (yields) stray = stray.slice(1);
  const extra = stray[0];
  if (extra !== undefined) {
    // A word straight after a character the lexer refused is what is left
    // of the word it broke, and that has been said.
    if (extra.afterRefusal) {
      take();
      return null;
    }
    return refuse(
      extra.at,
      `Only \`default\` may stand between a passage's name and its braces, not ${p.describe(extra)}.`,
      `A passage is written ${written(first.text)}, with \`default\` after the name where any other passage of that name should replace it: ${written(first.text, true)}.`,
    );
  }

  take();
  // A body never closed took the rest of the file, which has been said,
  // and what it holds is not read as its words.
  const start = body.at.start + 1;
  const prose = p.swallowedRest
    ? { kind: 'prose' as const, at: p.source.span(start, start), pieces: [] }
    : readProse(p, start, start + body.text.length);
  return {
    kind: 'passage',
    at: spanning(keyword.at, body.at),
    name: p.ident(first),
    yields,
    body: { kind: 'passage-body', at: body.at, text: body.text, prose },
  };
}

/** Whether a member is a passage: `passage` is no other node's kind. */
export function isPassage(member: Node): member is PassageDeclaration {
  return member.kind === 'passage';
}

/** Whether a word is `default`, which a header writes after the name. */
function isDefault(token: Token): boolean {
  return token.kind === 'name' && token.text === 'default';
}

/** What is wrong with a word written where a passage's name goes, and what to write. */
function notAName(p: Parser, token: Token): [message: string, remedy: string] {
  switch (token.kind) {
    case 'kind':
      return [
        `A passage's name starts with a lower-case letter, and \`${token.text}\` starts with a capital.`,
        `Write ${written(lowerCase(token.text))}.`,
      ];
    case 'string':
      return [
        "A passage's name is not written in quotes.",
        `Write it as a bare lower-case word: ${written(/^[a-z][a-z0-9_]*$/.test(token.text) ? token.text : 'greeting')}.`,
      ];
    case 'symbol':
      return [
        "A passage's name has no colon before it.",
        `Write ${written(token.text)}; a colon is how a property or a message is named.`,
      ];
    default:
      return [
        `${p.describe(token)} cannot name a passage.`,
        `A passage's name is a lower-case word: ${written('greeting')}.`,
      ];
  }
}

/** `Greeting` as a passage's name would be written, `greeting`; `MagicWord`, `magic_word`. */
function lowerCase(name: string): string {
  return name.replace(/(?<=[a-z0-9])([A-Z])/g, '_$1').toLowerCase();
}

/**
 * A header with no body after it. Its name and `default` are taken where
 * they are written on its own line, and nothing that begins a member is,
 * so the next member is read as the author wrote it.
 */
function withoutBody<M>(
  p: Parser,
  keyword: Token,
  readers: MemberReaders<M>,
  onItsLine: (token: Token) => boolean,
): null {
  const startsMember = (token: Token): boolean =>
    token.kind === 'symbol' || (token.kind === 'name' && readers.has(token.text));
  const name = p.peek();
  if (name.kind !== 'name' || isDefault(name) || startsMember(name) || !onItsLine(name)) {
    p.diagnostics.refuse(
      p.source.span(keyword.at.end, keyword.at.end),
      'A passage needs a name, and its words in braces.',
      `Write ${written('greeting')}, with the passage's words between the braces.`,
    );
    return null;
  }
  p.next();
  let last = name;
  if (isDefault(p.peek()) && onItsLine(p.peek())) last = p.next();
  p.diagnostics.refuse(
    p.source.span(last.at.end, last.at.end),
    `The passage \`${name.text}\` has no braces.`,
    `A passage holds its words in braces, even when it has few: ${written(name.text, last !== name)}.`,
  );
  return null;
}
