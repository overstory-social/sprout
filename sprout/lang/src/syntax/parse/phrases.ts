// A verb's phrase, `"unlock [target] with [tool]"`, split into its runs
// of words and its slots (the spec's Verbs › Declaring a verb, Slots).
//
// The lexer hands a phrase over as one `string` token whose text is what
// the quotes mean, after escapes. Each part is spanned on the source
// between the quotes, walking the escapes as the lexer does, so a slot's
// span is exact however many escapes stand before it. Which role a slot
// names is the first tier's to check (`declare/verbs.ts`); matching a
// typed command against a phrase is B27's.

import type { PhraseDeclaration, PhrasePart } from '../ast.js';
import type { Token } from '../lexer.js';
import type { Span } from '../../source/source.js';
import type { Parser } from './parser.js';

/** One character of what a phrase means, and the source it was written as. */
interface Meant {
  readonly ch: string;
  readonly start: number;
  readonly end: number;
}

/** A role's name as a slot writes it. */
const ROLE_NAME = /^[a-z][a-z0-9_]*$/;

/** What an author who capitalised a slot meant. */
const CAPITALISED = /^[A-Z][A-Za-z0-9_]*$/;

/**
 * The phrase in the string token next, read into parts. Null where a
 * slot in it was refused, having said why: a phrase with a slot that
 * cannot be read costs that phrase and nothing else.
 */
export function phrase(p: Parser): PhraseDeclaration | null {
  const token = p.next();
  const chars = meantOf(p, token);
  const parts: PhrasePart[] = [];
  let refused = false;
  let run: Meant[] = [];

  const flush = (): void => {
    const words = wordsOf(p, run);
    if (words !== null) parts.push(words);
    run = [];
  };
  const refuse = (at: Span, message: string, remedy: string): void => {
    p.diagnostics.refuse(at, message, remedy);
    refused = true;
  };

  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]!;
    if (c.ch === ']') {
      refuse(
        p.source.span(c.start, c.end),
        'This `]` closes no slot.',
        'A slot opens with [ and closes with ], as in `"take [target]"`. Take this one out, or add the [ it closes.',
      );
      continue;
    }
    if (c.ch !== '[') {
      run.push(c);
      continue;
    }
    flush();
    const close = chars.findIndex((d, at) => at > i && d.ch === ']');
    if (close < 0) {
      const named = /^[a-z][a-z0-9_]*/.exec(textOfChars(chars.slice(i + 1)))?.[0] ?? 'target';
      refuse(
        p.source.span(c.start, c.end),
        'This slot is never closed.',
        `Add a ] after the role's name: \`[${named}]\`.`,
      );
      break;
    }
    const inside = chars.slice(i + 1, close);
    const written = textOfChars(inside);
    const slotAt = p.source.span(c.start, chars[close]!.end);
    i = close;
    if (written.trim() === '') {
      refuse(
        slotAt,
        `\`[${written}]\` names no role.`,
        'A slot holds the name of one of the verb\'s roles, as in `"take [target]"`.',
      );
    } else if (ROLE_NAME.test(written)) {
      parts.push({
        kind: 'phrase-slot',
        at: slotAt,
        role: {
          kind: 'ident',
          at: p.source.span(inside[0]!.start, inside.at(-1)!.end),
          text: written,
        },
      });
    } else if (CAPITALISED.test(written)) {
      refuse(
        slotAt,
        `A slot names a role in lower case, and \`${written}\` starts with a capital.`,
        `Write \`[${lowerCase(written)}]\`.`,
      );
    } else {
      refuse(
        slotAt,
        `\`[${written}]\` is not the name of a role.`,
        "A slot holds one role's name and nothing else, as in `[target]`; the words around it go outside the brackets.",
      );
    }
  }
  flush();

  if (refused) return null;
  return { kind: 'phrase', at: token.at, text: token.text, parts };
}

/**
 * What a string token means, one character at a time, each with the
 * source it was written as: an escape is one character written as two.
 * The walk is the lexer's own, so the characters joined are its `text`.
 */
export function meantOf(p: Parser, token: Token): Meant[] {
  const source = p.source.text;
  const chars: Meant[] = [];
  let i = token.at.start + 1;
  while (i < token.at.end) {
    const ch = source[i]!;
    if (ch === '"') break;
    if (ch !== '\\') {
      chars.push({ ch, start: i, end: i + 1 });
      i += 1;
      continue;
    }
    const escape = source[i + 1] ?? '';
    const end = Math.min(i + 2, token.at.end);
    if (escape !== '') chars.push({ ch: escape === 'n' ? '\n' : escape, start: i, end });
    i += 2;
  }
  return chars;
}

/** A run of characters between slots as a part, trimmed; null where it holds only spaces. */
function wordsOf(p: Parser, run: readonly Meant[]): PhrasePart | null {
  let first = 0;
  let last = run.length - 1;
  while (first <= last && /\s/.test(run[first]!.ch)) first += 1;
  while (last >= first && /\s/.test(run[last]!.ch)) last -= 1;
  if (first > last) return null;
  const kept = run.slice(first, last + 1);
  return {
    kind: 'phrase-words',
    at: p.source.span(kept[0]!.start, kept.at(-1)!.end),
    text: textOfChars(kept).replace(/\s+/g, ' '),
  };
}

function textOfChars(chars: readonly Meant[]): string {
  return chars.map((c) => c.ch).join('');
}

/** `Target` as a role would be written, `target`; `MagicWord`, `magic_word`. */
export function lowerCase(name: string): string {
  return name.replace(/(?<=[a-z0-9])([A-Z])/g, '_$1').toLowerCase();
}
