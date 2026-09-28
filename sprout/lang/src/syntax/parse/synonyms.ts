// Synonyms (the spec's Parsing › Synonyms): a verb's own line, `synonyms
// "unseal", "prise open"`, and a world's or an object's, `synonyms open:
// "jimmy"`. Each synonym is words in quotes, the next after a comma.
// `synonyms` is read as syntax only where a member or a verb's line may
// start, and is no reserved word. What each synonym gives a verb is
// checked as its file is read and across the bundle (`declare/synonyms.ts`).

import type { Ident } from '../ast.js';
import type { SynonymsDeclaration, SynonymWords } from '../ast-verbs.js';
import type { Token } from '../lexer.js';
import { spanning } from '../../source/source.js';
import { punct, type Parser } from './parser.js';
import { phrase } from './phrases.js';

/** How a verb's own synonyms are written, for a remedy to show. */
const OWN = '`synonyms "unseal", "prise open"`';

/** How a world's or an object's synonyms are written, for a remedy to show. */
const SCOPED = '`synonyms open: "jimmy"`';

/**
 * The synonyms after `keyword`, each in quotes, the next after a comma.
 * Null where the first is not written, having said why; one that cannot
 * be read costs itself.
 */
export function synonymList(
  p: Parser,
  keyword: Token,
  example: string = OWN,
): SynonymWords[] | null {
  if (!p.at('string')) {
    p.diagnostics.refuse(
      p.done ? keyword.at : p.peek().at,
      '`synonyms` needs the words, in quotes.',
      `Write each in quotes, a comma between two: ${example}.`,
    );
    return null;
  }
  const words: SynonymWords[] = [];
  for (;;) {
    const read = synonymWords(p);
    if (read !== null) words.push(read);
    const comma = p.take('punct', ',');
    if (comma === null || !p.at('string')) return words;
  }
}

/** One synonym, the string next. Null where it cannot be read, having said why. */
function synonymWords(p: Parser): SynonymWords | null {
  const read = phrase(p);
  if (read === null) return null;
  const slot = read.parts.find((part) => part.kind === 'phrase-slot');
  if (slot !== undefined) {
    p.diagnostics.refuse(
      slot.at,
      'A synonym is the words a visitor types in place of the verb’s name, and holds no slot.',
      `Write the words alone, as in ${OWN}; the verb's phrases say where its roles go.`,
    );
    return null;
  }
  if (read.parts.length === 0) {
    p.diagnostics.refuse(
      read.at,
      'This synonym has no words in it.',
      `Write the words a visitor types, as in ${OWN}, or take it out.`,
    );
    return null;
  }
  const text = read.parts.map((part) => (part.kind === 'phrase-words' ? part.text : '')).join(' ');
  return { kind: 'synonym', at: read.at, text };
}

/**
 * `synonyms open: "jimmy", "force"`, in a world's or an object's body, the
 * word `synonyms` next. Null where the verb or its words are not written,
 * having said why.
 */
export function synonymsMember(p: Parser): SynonymsDeclaration | null {
  const keyword = p.next();
  const name = p.peek();
  if (name.kind !== 'name' || !punct(p.peek(1), ':')) {
    p.diagnostics.refuse(
      name.kind === 'name' ? p.peek(1).at : name.at,
      '`synonyms` in a body names the verb they are for, then a colon.',
      `Write the verb, a colon and the words: ${SCOPED}.`,
    );
    return null;
  }
  p.next();
  p.next();
  const verb: Ident = p.ident(name);
  const words = synonymList(p, keyword, SCOPED);
  if (words === null) return null;
  const end = words.at(-1)?.at ?? verb.at;
  return { kind: 'synonyms', at: spanning(keyword.at, end), verb, words };
}
