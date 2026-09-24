// The statements that put words in front of a reader, and the words they
// take (the spec's Prose; Other people › Who hears it): `say`, `tell`,
// `tell <x>` and `text`, each followed by words in quotes, a one-line
// passage, or a passage's name; `refuse` takes its words the same way.
// Words in quotes after `say`, `tell` or `text` are held to the host's cap
// on a literal line (Limits › Static caps), which a passage is not.
//
// `tell` names who is told only where a second word or words in quotes
// follow the first on its line, so `tell pulled` is a passage said to the
// place and `tell self pulled` the same passage said to `self`. Where each
// statement may stand is the checker's.

import type { Ident, ObjectPath } from '../ast.js';
import type { SayStatement, TellStatement, TextStatement } from '../ast-speech.js';
import { writtenPath } from '../ast.js';
import type { ProseLiteral } from '../ast-prose.js';
import type { Token } from '../lexer.js';
import { spanning, type Span } from '../../source/source.js';
import { punct, type Parser } from './parser.js';
import { objectPath } from './paths.js';
import { readProse } from './prose.js';
import { firstOnItsLine, startsNext, type Enclosing } from './statements.js';

/** The words a statement says: in quotes, or a passage's name. */
export type Said = ProseLiteral | Ident;

/** How each statement is shown written right, in quotes and by a passage's name. */
const EXAMPLES = {
  refuse: { quoted: '"No room here."', named: 'full' },
  say: { quoted: '"The bolt slides back."', named: 'taken' },
  tell: { quoted: '"{actor} pulls the lever."', named: 'pulled' },
  text: { quoted: '"A lever, waist high."', named: 'greeting' },
} as const;

type Word = keyof typeof EXAMPLES;

/** `say "The bolt slides back."` or `say taken`. */
export function sayStatement(p: Parser, within: Enclosing): SayStatement | null {
  const keyword = p.next();
  const said = capped(p, spoken(p, keyword.at, within, 'say', 'say'), 'say', 'say');
  return said === null ? null : { kind: 'say', at: spanning(keyword.at, said.at), said };
}

/** `text greeting` or `text "A lever, waist high."`. */
export function textStatement(p: Parser, within: Enclosing): TextStatement | null {
  const keyword = p.next();
  const said = capped(p, spoken(p, keyword.at, within, 'text', 'text'), 'text', 'text');
  return said === null ? null : { kind: 'text', at: spanning(keyword.at, said.at), said };
}

/**
 * `tell "…"` or `tell pulled`, to the place; `tell self "…"`, `tell item
 * pulled` or `tell kiln.shelf "…"`, to the one named. Null having said why.
 */
export function tellStatement(p: Parser, within: Enclosing): TellStatement | null {
  const keyword = p.next();
  let to: ObjectPath | null = null;
  const head = p.peek();
  if (namesWhoIsTold(p, within, head)) {
    p.next();
    to = objectPath(p, head);
    if (to === null) return null;
  }
  const lead = to === null ? 'tell' : `tell ${writtenPath(to)}`;
  const said = capped(p, spoken(p, (to ?? keyword).at, within, 'tell', lead), 'tell', lead);
  return said === null ? null : { kind: 'tell', at: spanning(keyword.at, said.at), to, said };
}

/**
 * Whether the word after `tell` names who is told rather than a passage:
 * a dot follows it, or the words follow it on its own line, in quotes, as
 * a passage's name, or written wrong. A word on a later line than `tell`,
 * or one the next statement or member starts with, is never one.
 */
function namesWhoIsTold(p: Parser, within: Enclosing, head: Token): boolean {
  if (head.kind !== 'name' || startsNext(p, within, head) || p.atDeclarationStart()) return false;
  if (firstOnItsLine(p, head)) return false;
  const next = p.peek(1);
  if (punct(next, '.')) return true;
  if (firstOnItsLine(p, next)) return false;
  if (next.kind === 'name') {
    if (startsNext(p, within, next)) return false;
    const after = p.peek(2);
    return !punct(after, '.') && !punct(after, '(');
  }
  // Anything else on the line but punctuation is the words, written right or wrong.
  return next.kind === 'string' || next.kind === 'integer' || next.kind === 'kind';
}

/**
 * Words in quotes held to the host's cap on a literal line, counted as
 * they mean, escapes read; refused, the statement is still kept.
 */
function capped(p: Parser, said: Said | null, word: Word, lead: string): Said | null {
  if (said === null) return null;
  const cap = p.caps.literalCharacters;
  if (said.kind === 'prose-literal' && [...said.value].length > cap) {
    p.diagnostics.refuse(
      said.at,
      `This line is ${[...said.value].length} characters long, and ${cap} is as long as a \`${word}\` in quotes may be.`,
      `Put the words in a passage, which has no length cap of its own, and say it by name, as in \`${lead} greeting\`.`,
    );
  }
  return said;
}

/** What `refuse` says: the words in quotes, or the name of a passage. */
export function refusal(p: Parser, keyword: Token, within: Enclosing): Said | null {
  return spoken(p, keyword.at, within, 'refuse', 'refuse');
}

/**
 * What a statement says, after `after`: the words in quotes, or the name
 * of a passage. A word that starts a statement, or a name read through a
 * dot, is not a passage's name, so the statement with nothing after it
 * never takes the next statement for one. `lead` is the statement as
 * written up to its words. Null having said why.
 */
function spoken(p: Parser, after: Span, within: Enclosing, word: Word, lead: string): Said | null {
  const token = p.peek();
  if (token.kind === 'string') {
    p.next();
    return proseLiteral(p, token);
  }
  // A word the next statement or member starts with, or a property's
  // name on a line of its own, is not this one's: it is left to be
  // read. Anything else standing where the words go is the words,
  // written wrong, and is taken with it.
  const ahead = startsNext(p, within, token);
  const read = token.kind === 'name' && !punct(p.peek(1), '.') && !punct(p.peek(1), '(');
  if (read && !ahead) {
    p.next();
    return p.ident(token);
  }
  const nothing =
    ahead ||
    p.done ||
    punct(token, '}') ||
    p.atDeclarationStart() ||
    (token.kind === 'name' && !read);
  if (!nothing && token.kind !== 'punct') p.next();
  const passage = within.owner === null ? 'a passage' : `a passage of \`${within.owner}\``;
  const { quoted, named } = EXAMPLES[word];
  p.diagnostics.refuse(
    nothing ? p.source.span(after.end) : token.at,
    word === 'refuse' ? '`refuse` says why.' : `\`${lead}\` says something.`,
    `Write the words in quotes, as in \`${lead} ${quoted}\`, or name ${passage}, as in \`${lead} ${named}\`.`,
  );
  return null;
}

/**
 * Words in quotes as a one-line passage, which carries slots (the spec's
 * Prose › Passages). A line never closed has been refused where it was
 * read, and its words are read to where it stops.
 */
function proseLiteral(p: Parser, token: Token): ProseLiteral {
  const { start, end } = token.at;
  const closed = end - start >= 2 && p.source.text[end - 1] === '"';
  const prose = readProse(p, start + 1, closed ? end - 1 : end);
  return { kind: 'prose-literal', at: token.at, value: token.text, prose };
}
