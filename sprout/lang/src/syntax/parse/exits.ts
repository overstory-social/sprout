// A grammar block's ways out: `exit north "deeper into the dark" ->
// maze_hall when (!self.get(:lit))` and `link north "the way on"` (the
// spec's Verbs › Exits, An exit may be conditional, Links). An exit is
// its word, a direction, a label in quotes, `->` and where it leads, and
// optionally `when` and a condition in brackets; a link is its word, a
// direction and a label. Which words are directions, what the condition
// may read and where the path leads are for the tiers after this one.
//
// A line that could not be read is refused once and stepped over to the
// block's next line, so one bad exit costs that exit and nothing beside it.

import type { Ident, ObjectPath } from '../ast.js';
import type { GrammarExit, GrammarLabel, GrammarLink } from '../ast-grammar.js';
import type { Token } from '../lexer.js';
import { spanning, type Span } from '../../source/source.js';
import { expression } from './expressions.js';
import { punct, type Parser } from './parser.js';
import { objectPath } from './paths.js';
import { skipBracketed, stepPast } from './recovery.js';

/** How each line is written, for a remedy. */
const EXIT_EXAMPLE = '`exit north "out to the yard" -> yard`';
const LINK_EXAMPLE = '`link north "deeper into the dark"`';

/**
 * Where a line's reading stops: `atLineEnd` says where the block's next
 * line, its close or what ends it starts, which a line never reads into.
 */
export interface LineEnds {
  readonly atLineEnd: (p: Parser) => boolean;
}

/** An `exit` line, its word next; null having said why and stepped over the rest of it. */
export function exitLine(p: Parser, ends: LineEnds): GrammarExit | null {
  const keyword = p.next();
  const direction = directionAfter(p, keyword, 'exit', EXIT_EXAMPLE, ends);
  if (direction === null) return abandon(p, ends);
  const label = labelAfter(p, direction.at, 'exit', `exit ${direction.text}`, ends);
  if (label === null) return abandon(p, ends);
  const arrow = p.take('punct', '->');
  if (arrow === null) {
    // A name where the arrow belongs is most likely the place, written without it.
    const place = p.peek().kind === 'name' && !ends.atLineEnd(p) ? p.peek().text : 'yard';
    refuseAt(
      p,
      label.at,
      ends,
      `An exit says where it leads after its label, with \`->\`.`,
      `Write \`exit ${direction.text} "${label.text}" -> ${place}\`, naming the place it leads to.`,
    );
    return abandon(p, ends);
  }
  const destination = destinationAfter(p, arrow, direction, label, ends);
  if (destination === null) return abandon(p, ends);
  const written = `exit ${direction.text} "${label.text}" -> ${destination.parts.map((part) => part.text).join('.')}`;
  const line = (end: Span, when: GrammarExit['when']): GrammarExit => ({
    kind: 'grammar-exit',
    at: spanning(keyword.at, end),
    direction,
    label,
    destination,
    when,
  });
  const word = p.peek();
  if (!(word.kind === 'name' && word.text === 'when')) return line(destination.at, null);
  p.next();
  const condition = conditionAfter(p, word, written);
  if (condition === null) return abandon(p, ends);
  return line(condition.close, condition.when);
}

/** A `link` line, its word next; null having said why and stepped over the rest of it. */
export function linkLine(p: Parser, ends: LineEnds): GrammarLink | null {
  const keyword = p.next();
  const direction = directionAfter(p, keyword, 'link', LINK_EXAMPLE, ends);
  if (direction === null) return abandon(p, ends);
  const label = labelAfter(p, direction.at, 'link', `link ${direction.text}`, ends);
  if (label === null) return abandon(p, ends);
  if (p.at('punct', '->')) {
    p.diagnostics.refuse(
      p.peek().at,
      'A link leads nowhere until the world connects it, so it names no place.',
      `Write \`link ${direction.text} "${label.text}"\`, and \`connect ${direction.text} to …\` where the place is made; or write an \`exit\` for a place written in source.`,
    );
    return abandon(p, ends);
  }
  return { kind: 'grammar-link', at: spanning(keyword.at, label.at), direction, label };
}

/** The direction after a line's word, a name; null having said why. */
function directionAfter(
  p: Parser,
  keyword: Token,
  word: 'exit' | 'link',
  example: string,
  ends: LineEnds,
): Ident | null {
  const next = p.peek();
  if (next.kind === 'name' && !ends.atLineEnd(p)) return p.ident(p.next());
  if (next.kind === 'kind') {
    p.next();
    p.diagnostics.refuse(
      next.at,
      `\`${next.text}\` starts with a capital, and a direction is written in lower case.`,
      `Write \`${word} ${next.text.toLowerCase()} …\`, as in ${example}.`,
    );
    return null;
  }
  refuseAt(
    p,
    keyword.at,
    ends,
    `\`${word}\` is followed by the direction it leads in, then its label in quotes.`,
    `Write ${example}.`,
  );
  return null;
}

/** The label in quotes after a line's direction; null having said why. */
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
      : `Write the label after the direction, as in \`${written} "deeper into the dark"\`.`,
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
  if (head.kind === 'name' && head.text !== 'when' && !ends.atLineEnd(p)) {
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
