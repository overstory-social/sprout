// A grammar block's ways out: `exit north "deeper into the dark" ->
// maze_hall when (!self.get(:lit))`, `exit down "down" -> maze_9 say "You
// won't be able to get back up."`, `exit west "west" refuse "You would
// need a machete."` and `link onward "the way on"` (the spec's Verbs ›
// Exits, An exit may be conditional, Links). An exit is its word, a
// direction, a label in quotes, then `->`, where it leads and optionally
// `say` and what it says as it is taken, or `refuse` and what it says;
// then, last, optionally `when` and a condition in brackets. A link is
// its word, its name and a label. Which words are directions, which may
// name a link, what the condition and the words may read and where the
// path leads are for the tiers after this one.
//
// A line that could not be read is refused once and stepped over to the
// block's next line, so one bad exit costs that exit and nothing beside it.

import { writtenPath, type Ident, type ObjectPath } from '../ast.js';
import type {
  GrammarExit,
  GrammarLabel,
  GrammarLink,
  GrammarRefusal,
  GrammarSaying,
} from '../ast-grammar.js';
import type { Token } from '../lexer.js';
import { spanning, type Span } from '../../source/source.js';
import { expression } from './expressions.js';
import { punct, type Parser } from './parser.js';
import { objectPath } from './paths.js';
import { skipBracketed, stepPast } from './recovery.js';
import { refusal, saying } from './speech.js';
import type { Enclosing } from './statements.js';

/** How each line is written, for a remedy. */
const EXIT_EXAMPLE = '`exit north "out to the yard" -> yard`';
const LINK_EXAMPLE = '`link onward "deeper into the dark"`';

/**
 * Where a line's reading stops: `atLineEnd` says where the block's next
 * line, its close or what ends it starts, which a line never reads into.
 */
export interface LineEnds {
  readonly atLineEnd: (p: Parser) => boolean;
  /** Whether a token starts the block's next line, or the body's next member. */
  readonly startsLine: (token: Token) => boolean;
}

/** An `exit` line, its word next; null having said why and stepped over the rest of it. */
export function exitLine(p: Parser, ends: LineEnds): GrammarExit | null {
  const keyword = p.next();
  const direction = wordAfter(p, keyword, 'exit', EXIT_EXAMPLE, ends);
  if (direction === null) return abandon(p, ends);
  const label = labelAfter(p, direction.at, 'exit', `exit ${direction.text}`, ends);
  if (label === null) return abandon(p, ends);
  const refusing = p.peek();
  if (refusing.kind === 'name' && refusing.text === 'refuse' && !ends.atLineEnd(p)) {
    p.next();
    const said = refusal(p, refusing, wordsWithin(ends));
    if (said === null) return abandon(p, ends);
    const refused: GrammarRefusal = {
      kind: 'grammar-refusal',
      at: spanning(refusing.at, said.at),
      said,
    };
    const written = `exit ${direction.text} "${label.text}" refuse ${shownWords(said)}`;
    return guarded(p, { keyword, direction, label, leads: refused, says: null }, written, ends);
  }
  const arrow = p.take('punct', '->');
  if (arrow === null) {
    // A name where the arrow belongs is most likely the place, written without it.
    const place = p.peek().kind === 'name' && !ends.atLineEnd(p) ? p.peek().text : 'yard';
    refuseAt(
      p,
      label.at,
      ends,
      `An exit says where it leads after its label, with \`->\`.`,
      `Write \`exit ${direction.text} "${label.text}" -> ${place}\`, naming the place it leads to; or \`exit ${direction.text} "${label.text}" refuse "…"\` for a way that does not go.`,
    );
    return abandon(p, ends);
  }
  const destination = destinationAfter(p, arrow, direction, label, ends);
  if (destination === null) return abandon(p, ends);
  let written = `exit ${direction.text} "${label.text}" -> ${writtenPath(destination)}`;
  let says: GrammarSaying | null = null;
  const word = p.peek();
  if (word.kind === 'name' && word.text === 'say' && !ends.atLineEnd(p)) {
    p.next();
    const said = saying(p, word, wordsWithin(ends));
    if (said === null) return abandon(p, ends);
    says = { kind: 'grammar-saying', at: spanning(word.at, said.at), said };
    written = `${written} say ${shownWords(said)}`;
  }
  return guarded(p, { keyword, direction, label, leads: destination, says }, written, ends);
}

/**
 * Where an exit's words stop: at the block's next line, or at `when`,
 * the guard after them, which is never a passage's name.
 */
function wordsWithin(ends: LineEnds): Enclosing {
  return {
    owner: null,
    within: 'exit',
    enclosed: true,
    startsMember: (token) =>
      ends.startsLine(token) || (token.kind === 'name' && token.text === 'when'),
    unclosed: false,
  };
}

/** An exit's words as a remedy shows them: a passage by its name, words in quotes elided. */
function shownWords(said: GrammarSaying['said']): string {
  return said.kind === 'prose-literal' ? '"…"' : said.text;
}

/** An exit as read up to its `when`. */
interface ExitHead {
  readonly keyword: Token;
  readonly direction: Ident;
  readonly label: GrammarLabel;
  readonly leads: GrammarExit['leads'];
  readonly says: GrammarSaying | null;
}

/**
 * The exit `head` is, with the `when` after it where one is written;
 * null having said why and stepped over the rest. `written` is the line
 * as read so far, for a remedy.
 */
function guarded(p: Parser, head: ExitHead, written: string, ends: LineEnds): GrammarExit | null {
  const { keyword, ...line } = head;
  let end = (line.says ?? line.leads).at;
  let when: GrammarExit['when'] = null;
  const word = p.peek();
  if (word.kind === 'name' && word.text === 'when') {
    p.next();
    const condition = conditionAfter(p, word, written);
    if (condition === null) return abandon(p, ends);
    when = condition.when;
    end = condition.close;
  }
  if (strayedSay(p, head, written, ends)) return abandon(p, ends);
  return { kind: 'grammar-exit', at: spanning(keyword.at, end), ...line, when };
}

/**
 * Whether a `say` stands where an exit's words may not: on one that
 * refuses, a second time, or after its `when`; refused where it stands.
 */
function strayedSay(p: Parser, head: ExitHead, written: string, ends: LineEnds): boolean {
  const word = p.peek();
  if (!(word.kind === 'name' && word.text === 'say') || ends.atLineEnd(p)) return false;
  const exit = `exit ${head.direction.text} "${head.label.text}"`;
  if (head.leads.kind === 'grammar-refusal') {
    p.diagnostics.refuse(
      word.at,
      'An exit that refuses says only its refusal, since nobody goes that way.',
      `Put the words in the refusal, or lead the exit somewhere and say them as it is taken, as in \`${exit} -> yard say "…"\`.`,
    );
  } else if (head.says !== null) {
    p.diagnostics.refuse(
      word.at,
      'This exit already says something as it is taken, and an exit says one thing.',
      `Put all the words in one \`say\`, or in a passage it names, as in \`${exit} -> ${writtenPath(head.leads)} say taken\`.`,
    );
  } else {
    p.diagnostics.refuse(
      word.at,
      "An exit's `say` comes before its `when`.",
      `Write the words after where it leads, as in \`${written} say "…" when (…)\`.`,
    );
  }
  return true;
}

/** A `link` line, its word next; null having said why and stepped over the rest of it. */
export function linkLine(p: Parser, ends: LineEnds): GrammarLink | null {
  const keyword = p.next();
  const name = wordAfter(p, keyword, 'link', LINK_EXAMPLE, ends);
  if (name === null) return abandon(p, ends);
  const label = labelAfter(p, name.at, 'link', `link ${name.text}`, ends);
  if (label === null) return abandon(p, ends);
  if (p.at('punct', '->')) {
    p.diagnostics.refuse(
      p.peek().at,
      'A link leads nowhere until the world connects it, so it names no place.',
      `Write \`link ${name.text} "${label.text}"\`, and \`connect ${name.text} to …\` where the place is made; or write an \`exit\` for a place written in source.`,
    );
    return abandon(p, ends);
  }
  return { kind: 'grammar-link', at: spanning(keyword.at, label.at), name, label };
}

/** The direction after `exit`, or the name after `link`: a name; null having said why. */
function wordAfter(
  p: Parser,
  keyword: Token,
  word: 'exit' | 'link',
  example: string,
  ends: LineEnds,
): Ident | null {
  const next = p.peek();
  if (next.kind === 'name' && !ends.atLineEnd(p)) return p.ident(p.next());
  const what = word === 'exit' ? 'a direction' : "a link's name";
  if (next.kind === 'kind') {
    p.next();
    p.diagnostics.refuse(
      next.at,
      `\`${next.text}\` starts with a capital, and ${what} is written in lower case.`,
      `Write \`${word} ${next.text.toLowerCase()} …\`, as in ${example}.`,
    );
    return null;
  }
  refuseAt(
    p,
    keyword.at,
    ends,
    word === 'exit'
      ? '`exit` is followed by the direction it leads in, then its label in quotes.'
      : '`link` is followed by its name, a word of your own, then its label in quotes.',
    `Write ${example}.`,
  );
  return null;
}

/** The label in quotes after an exit's direction or a link's name; null having said why. */
function labelAfter(
  p: Parser,
  after: Span,
  word: 'exit' | 'link',
  written: string,
  ends: LineEnds,
): GrammarLabel | null {
  const quoted = p.take('string');
  if (quoted !== null) return { kind: 'grammar-label', at: quoted.at, text: quoted.text };
  refuseAt(
    p,
    after,
    ends,
    `\`${written}\` is followed by its label in quotes: what a visitor reads, and may type, for the way out.`,
    word === 'exit'
      ? `Write the label after the direction, as in \`${written} "out to the yard" -> yard\`.`
      : `Write the label after the name, as in \`${written} "deeper into the dark"\`.`,
  );
  return null;
}

/** Where an exit leads, after its `->`: a name, or a dotted path to one; null having said why. */
function destinationAfter(
  p: Parser,
  arrow: Token,
  direction: Ident,
  label: GrammarLabel,
  ends: LineEnds,
): ObjectPath | null {
  const head = p.peek();
  // `say` and `when` follow the place, and never name it.
  const after = head.kind === 'name' && (head.text === 'say' || head.text === 'when');
  if (head.kind === 'name' && !after && !ends.atLineEnd(p)) {
    p.next();
    return objectPath(p, head);
  }
  refuseAt(
    p,
    arrow.at,
    ends,
    'After `->` comes the place the exit leads to.',
    `Name it in lower case, as in \`exit ${direction.text} "${label.text}" -> yard\`, or by its path, as in \`-> bedroom.wardrobe\`.`,
  );
  return null;
}

/** `(…)` after `when`, the word taken: the condition and where its bracket closes; null having said why. */
function conditionAfter(
  p: Parser,
  word: Token,
  written: string,
): { readonly when: NonNullable<GrammarExit['when']>; readonly close: Span } | null {
  const example = `${written} when (self.get(:open))`;
  const open = p.take('punct', '(');
  if (open === null) {
    p.diagnostics.refuse(
      p.source.span(word.at.end),
      "An exit's `when` is followed by its condition in brackets.",
      `Write \`${example}\`.`,
    );
    return null;
  }
  if (p.at('punct', ')')) {
    const close = p.next();
    p.diagnostics.refuse(
      spanning(open.at, close.at),
      "This exit's `when` says nothing inside its brackets.",
      `Write the condition it applies under, as in \`${example}\`, or leave \`when\` out.`,
    );
    return null;
  }
  if (!p.deeper(open.at)) {
    skipBracketed(p, ')');
    return null;
  }
  try {
    const when = expression(p);
    if (when === null) {
      skipBracketed(p, ')');
      return null;
    }
    const close = p.take('punct', ')');
    if (close === null) {
      p.diagnostics.refuse(
        p.done ? p.source.endSpan : p.peek().at,
        "The condition of this exit's `when` ends here, and its bracket is never closed.",
        'Add a ) after the condition.',
      );
      skipBracketed(p, ')');
      return null;
    }
    return { when, close: close.at };
  } finally {
    p.depth -= 1;
  }
}

/**
 * A refusal for what is missing after `after`: at the token written in
 * its place where one is, and just after `after` where the line ends.
 */
function refuseAt(p: Parser, after: Span, ends: LineEnds, message: string, remedy: string): void {
  const next = p.peek();
  const missing = p.done || ends.atLineEnd(p) || punct(next, '}');
  p.diagnostics.refuse(missing ? p.source.span(after.end) : next.at, message, remedy);
}

/** Step over the rest of a line refused, to the block's next line. */
function abandon(p: Parser, ends: LineEnds): null {
  while (!ends.atLineEnd(p)) stepOverToken(p);
  return null;
}

/**
 * Step past the token here, a bracketed run whole, so what a condition
 * holds, a property's colon among it, is never taken for the block's end.
 */
export function stepOverToken(p: Parser): void {
  if (p.at('punct', '(')) {
    p.next();
    skipBracketed(p, ')');
  } else stepPast(p);
}
