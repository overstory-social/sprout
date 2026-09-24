// What one tag in prose says (the spec's Prose › Slots, Conditionals and
// loops): a slot, `{if c}`, `{else}`, `{else if c}`, `{for x in c}`,
// `{for x: Kind in c}`, `{for x of l}`, or a close. What a slot or a
// condition says is an expression, read by the expression reader over
// that stretch of the file alone, so its spans are the file's and
// `$first` and the rest are names there. A condition takes no
// parentheses: the braces already delimit it.
//
// A tag that cannot be read is refused once, having said what to write,
// and costs itself and nothing after it: a slot comes back null, and a
// block's opening comes back broken, still opening the block it began.

import type { Expr, Ident, KindExpr } from '../ast.js';
import { isReserved } from '../reserved.js';
import type { Span } from '../../source/source.js';
import { kindName } from './composition.js';
import { expression } from './expressions.js';
import { Parser, punct } from './parser.js';

/** A tag, read. */
export type Tag =
  | { readonly tag: 'slot'; readonly at: Span; readonly expr: Expr }
  | { readonly tag: 'if'; readonly at: Span; readonly condition: Expr }
  | { readonly tag: 'else-if'; readonly at: Span; readonly condition: Expr }
  | { readonly tag: 'else'; readonly at: Span }
  | {
      readonly tag: 'for';
      readonly at: Span;
      readonly variable: Ident;
      readonly filter: KindExpr | null;
      readonly walks: 'in' | 'of';
      readonly over: Expr;
    }
  | { readonly tag: 'close'; readonly at: Span; readonly closes: 'if' | 'for' }
  /** `{one of}`, `{or}` or `{/one of}`, which choose at random under Chance. */
  | { readonly tag: 'chance'; readonly at: Span; readonly written: string }
  /**
   * An `{if …}`, `{else if …}` or `{for …}` whose header was refused: it
   * still opens its block, so its close is its own and not a stray.
   */
  | { readonly tag: 'broken'; readonly at: Span; readonly opens: 'if' | 'else' | 'for' };

/** A tag as the scan found it: the whole of it, and where its inside starts and ends. */
export interface TagSpan {
  readonly at: Span;
  readonly start: number;
  readonly end: number;
}

const LOWER_WORD = /^[a-z$][a-z0-9_]*/;

/** The tag `span` holds, or null having said why it cannot be read. */
export function readTag(p: Parser, span: TagSpan): Tag | null {
  const { at } = span;
  const text = p.source.text;
  const inside = text.slice(span.start, span.end);
  const lead = inside.length - inside.trimStart().length;
  const trimmed = inside.trim();
  const from = span.start + lead;
  if (trimmed.length === 0) {
    p.diagnostics.refuse(
      at,
      'This slot is empty.',
      'Write what it renders between the braces, as in `{self}`, or \\{ for a brace that is only a character.',
    );
    return null;
  }

  if (trimmed.startsWith('/')) {
    const closes = trimmed.slice(1).trim().replace(/\s+/g, ' ');
    if (closes === 'if' || closes === 'for') return { tag: 'close', at, closes };
    if (closes === 'one of') return { tag: 'chance', at, written: '{/one of}' };
    p.diagnostics.refuse(
      at,
      `\`{${trimmed}}\` closes nothing a passage opens.`,
      "A passage's blocks close with `{/if}` and `{/for}`.",
    );
    return null;
  }

  const word = LOWER_WORD.exec(trimmed)?.[0] ?? '';
  const after = from + word.length;
  const rest = text.slice(after, span.end).trim();
  const wordAlone = rest.length === 0 || /^\s/.test(text.slice(after, span.end));
  if (wordAlone && word === 'if') {
    const condition = conditionOf(p, at, after, span.end, '{if}');
    return condition === null ? { tag: 'broken', at, opens: 'if' } : { tag: 'if', at, condition };
  }
  if (wordAlone && word === 'else') return elseTag(p, span, after);
  if (wordAlone && word === 'for') return forTag(p, span, after);
  if (word === 'or' && rest.length === 0) return { tag: 'chance', at, written: '{or}' };
  if (word === 'one' && rest.replace(/\s+/g, ' ') === 'of') {
    return { tag: 'chance', at, written: '{one of}' };
  }

  const expr = expressionIn(p, from, span.end);
  return expr === null ? null : { tag: 'slot', at, expr };
}

/** `{else}`, or `{else if c}`. */
function elseTag(p: Parser, span: TagSpan, after: number): Tag | null {
  const { at } = span;
  const rest = p.source.text.slice(after, span.end);
  if (rest.trim().length === 0) return { tag: 'else', at };
  const lead = rest.length - rest.trimStart().length;
  const next = after + lead;
  const word = LOWER_WORD.exec(rest.trimStart())?.[0] ?? '';
  const beyond = p.source.text.slice(next + word.length, span.end);
  if (word === 'if' && (beyond.length === 0 || /^\s/.test(beyond))) {
    const condition = conditionOf(p, at, next + word.length, span.end, '{else if}');
    return condition === null
      ? { tag: 'broken', at, opens: 'else' }
      : { tag: 'else-if', at, condition };
  }
  p.diagnostics.refuse(
    at,
    '`{else}` is written alone, or as `{else if …}`.',
    'Write `{else}`, or `{else if <condition>}`.',
  );
  return { tag: 'broken', at, opens: 'else' };
}

/** The condition after `{if` or `{else if`, which must be written. */
function conditionOf(
  p: Parser,
  at: Span,
  start: number,
  end: number,
  written: string,
): Expr | null {
  if (p.source.text.slice(start, end).trim().length === 0) {
    p.diagnostics.refuse(
      at,
      `\`${written}\` needs a condition.`,
      'Write one after it, with no brackets, as in `{if self.get(:open)}`.',
    );
    return null;
  }
  return expressionIn(p, start, end);
}

/** What `{for` must be followed by, for a refusal of what was written instead. */
const FOR_FORMS =
  'Write `{for thing in self}`, `{for pot: Vessel in self}` or `{for key of self.get(:keys)}`.';

/** `{for x in c}`, `{for x: Kind in c}`, `{for x of l}`. */
function forTag(p: Parser, span: TagSpan, after: number): Tag | null {
  const { at } = span;
  const q = new Parser(p.source, p.diagnostics, p.readers, p.caps, {
    start: after,
    end: span.end,
  });
  const broken: Tag = { tag: 'broken', at, opens: 'for' };
  const malformed = (): Tag => {
    p.diagnostics.refuse(at, '`{for}` needs a name, `in` or `of`, and what it walks.', FOR_FORMS);
    return broken;
  };

  const named = q.peek();
  if (named.kind !== 'name') return malformed();
  q.next();
  if (named.text.startsWith('$') || isReserved(named.text)) {
    p.diagnostics.refuse(
      named.at,
      named.text.startsWith('$')
        ? `\`${named.text}\` is one of a loop's own names, so it cannot name what the loop walks.`
        : `\`${named.text}\` is a word of the language, so it cannot name what a loop walks.`,
      'Choose another word, as in `{for thing in self}`.',
    );
    return broken;
  }
  const variable = q.ident(named);

  let filter: KindExpr | null = null;
  if (punct(q.peek(), ':')) {
    q.next();
    filter = kindName(q);
    if (filter === null) return broken;
  }

  const walk = q.peek();
  if (walk.kind !== 'name' || (walk.text !== 'in' && walk.text !== 'of')) return malformed();
  q.next();
  const walks = walk.text;
  if (filter !== null && walks === 'of') {
    p.diagnostics.refuse(
      filter.at,
      'A kind picks out what a container holds, and `of` walks a list or a set role whole.',
      `Write \`{for ${variable.text}: ${written(filter)} in <container>}\`, or leave the kind out: \`{for ${variable.text} of <list>}\`.`,
    );
    return broken;
  }
  if (q.done) return malformed();
  const over = wholeExpression(q);
  return over === null ? broken : { tag: 'for', at, variable, filter, walks, over };
}

/** A kind as written. */
function written(kind: KindExpr): string {
  return kind.library === null ? kind.name.text : `${kind.library.text}.${kind.name.text}`;
}

/** One expression from `start` to `end` of the file, and nothing after it. */
export function expressionIn(p: Parser, start: number, end: number): Expr | null {
  return wholeExpression(new Parser(p.source, p.diagnostics, p.readers, p.caps, { start, end }));
}

/** One expression and the end of the stretch `q` reads, or null having said why not. */
function wholeExpression(q: Parser): Expr | null {
  const expr = expression(q);
  if (expr === null) return null;
  if (!q.done) {
    q.diagnostics.refuse(
      q.peek().at,
      'A slot renders one thing, and more is written after it.',
      'Write one reading in each slot, as in `{self.get(:mood)}`.',
    );
    return null;
  }
  return expr;
}
