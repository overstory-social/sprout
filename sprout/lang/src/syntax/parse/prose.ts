// Prose, read: a passage's body and a line in quotes, as the blocks and
// slots they hold (the spec's Prose › Passages, Slots, Conditionals and
// loops; Chance › The forms). `prose-scan.ts` cuts the words from the
// tags and `prose-tags.ts` reads each tag; this puts them together, each
// `{if}`, `{for}` and `{one of}` around what it guards up to its close.
//
// Reading recovers as the source parser does: a tag that cannot be read
// costs itself; a close, `{else}` or `{or}` that no open block takes is
// refused and stepped over; and a block a close for an enclosing block
// reaches first is refused as never closed and ended there, so the words
// around every mistake are still read and each mistake is said once. A
// `{one of}` holds its choices, each ended by an `{or}` written directly
// inside it or by its `{/one of}`; one with a single choice is warned
// about, since it says the same words every time (the spec's The
// compiler › What it warns about).

import type { Prose, ProseFor, ProseIf, ProseOneOf, ProsePiece } from '../ast-prose.js';
import { DEEPEST, type Parser } from './parser.js';
import { spanning, type Span } from '../../source/source.js';
import { scanProse, type Scanned } from './prose-scan.js';
import { readTag, type Closes, type Tag } from './prose-tags.js';

/** Prose from `start` to `end` of the file `p` reads. */
export function readProse(p: Parser, start: number, end: number): Prose {
  const scanned = scanProse(p.source, start, end, p.diagnostics);
  const reader: Reader = { p, scanned, at: 0, open: [], tooDeep: false, pending: null };
  const pieces = sequence(reader);
  return { kind: 'prose', at: p.source.span(start, end), pieces };
}

/** Which part of which block reading is inside. */
type Open = 'if' | 'else' | 'for' | 'one of';

/** Where reading has got to in one run of prose. */
interface Reader {
  readonly p: Parser;
  readonly scanned: readonly Scanned[];
  at: number;
  /** The blocks open around where reading is, innermost last. */
  readonly open: Open[];
  /** Whether the nesting bound was said, so it is said once. */
  tooDeep: boolean;
  /** A close or an `{else}` a run stopped at, for the block around it to take. */
  pending: Tag | null;
}

/** Whether a close for `closes` is one an open block takes. */
function closedByOpen(r: Reader, closes: Closes): boolean {
  return r.open.some((open) =>
    closes === 'if' ? open === 'if' || open === 'else' : open === closes,
  );
}

/**
 * Pieces up to the end of the prose, or up to a close, an `{else}` or an
 * `{or}` an open block takes, which is left in `pending` for it.
 */
function sequence(r: Reader): ProsePiece[] {
  const pieces: ProsePiece[] = [];
  while (r.at < r.scanned.length) {
    const item = r.scanned[r.at]!;
    r.at += 1;
    if (item.item === 'piece') {
      pieces.push(item.piece);
      continue;
    }
    const tag = item.refused ? null : readTag(r.p, item);
    if (tag === null) continue;
    switch (tag.tag) {
      case 'slot':
        pieces.push({ kind: 'prose-slot', at: tag.at, expr: tag.expr });
        break;
      case 'if': {
        const read = nested(r, 'if', tag.at, () => ifBlock(r, tag.at, tag.condition));
        if (read !== null) pieces.push(read);
        break;
      }
      case 'for': {
        const read = nested(r, 'for', tag.at, () => forBlock(r, tag));
        if (read !== null) pieces.push(read);
        break;
      }
      case 'broken':
        // Its opening has been refused: its block is read, so its close
        // is its own, and left out.
        if (tag.opens === 'if') nested(r, 'if', tag.at, () => ifBlock(r, tag.at, null));
        else if (tag.opens === 'for') {
          nested(r, 'for', tag.at, () => {
            run(r, tag.at);
            closeOf(r, tag.at, 'for');
          });
        } else if (r.open.at(-1) === 'if') {
          r.pending = tag;
          return pieces;
        }
        break;
      case 'close':
        if (closedByOpen(r, tag.closes)) {
          r.pending = tag;
          return pieces;
        }
        r.p.diagnostics.refuse(
          tag.at,
          `\`{/${tag.closes}}\` closes no \`{${tag.closes}}\`.`,
          'Take it out, or open the block it closes before it.',
        );
        break;
      case 'else':
      case 'else-if': {
        const inside = r.open.at(-1);
        if (inside === 'if') {
          r.pending = tag;
          return pieces;
        }
        if (inside === 'else') {
          r.p.diagnostics.refuse(
            tag.at,
            'An `{if}` has one `{else}`, and it comes last.',
            'Make the earlier one `{else if …}`, or take one of them out.',
          );
        } else {
          r.p.diagnostics.refuse(
            tag.at,
            '`{else}` belongs inside an `{if}`.',
            'Write it between `{if …}` and the `{/if}` that closes it.',
          );
        }
        break;
      }
      case 'one-of': {
        const read = nested(r, 'one of', tag.at, () => oneOfBlock(r, tag.at));
        if (read !== null) pieces.push(read);
        break;
      }
      case 'or':
        if (r.open.at(-1) === 'one of') {
          r.pending = tag;
          return pieces;
        }
        r.p.diagnostics.refuse(
          tag.at,
          '`{or}` separates the choices of a `{one of}`, directly inside it.',
          'Write it between `{one of}` and the `{/one of}` that closes it, outside any `{if}` or `{for}` in the choice.',
        );
        break;
    }
    // A block inside ended at a close that is for a block around this
    // one, which it left waiting: this run ends there too.
    if (r.pending !== null) return pieces;
  }
  return pieces;
}

/**
 * A block read one deeper, or, where blocks nest past the reader's own
 * bound, refused once and stepped over to its close.
 */
function nested<T>(r: Reader, open: Open, at: Span, read: () => T): T | null {
  if (r.open.length + 1 > DEEPEST) {
    if (!r.tooDeep) {
      r.tooDeep = true;
      r.p.diagnostics.refuse(
        at,
        'This is nested too deep to read.',
        'Take some of the blocks out.',
      );
    }
    skipBlock(r);
    return null;
  }
  r.open.push(open);
  try {
    return read();
  } finally {
    r.open.pop();
  }
}

/**
 * `{if c}…`, through its `{else if}`s and `{else}`, to its `{/if}`. With
 * no condition, its opening was refused, and the block is read to be left out.
 */
function ifBlock(r: Reader, opened: Span, condition: ProseIf['condition'] | null): ProseIf | null {
  const then = run(r, opened);
  const next = r.pending;
  const link = (otherwise: ProseIf['otherwise'], closed: Span): ProseIf | null =>
    condition === null
      ? null
      : { kind: 'prose-if', at: spanning(opened, closed), condition, then, otherwise };

  if (next?.tag === 'else-if') {
    r.pending = null;
    // A chain is as long as its author wrote it, so each link counts
    // against the nesting bound as a block inside a block would.
    const chained = nested(r, 'if', next.at, () => ifBlock(r, next.at, next.condition));
    return link(chained ?? null, chained?.at ?? next.at);
  }
  if (next?.tag === 'else' || (next?.tag === 'broken' && next.opens === 'else')) {
    r.pending = null;
    r.open[r.open.length - 1] = 'else';
    const otherwise = run(r, next.at);
    return link(otherwise, closeOf(r, opened, 'if'));
  }
  return link(null, closeOf(r, opened, 'if'));
}

/** `{for …}` to its `{/for}`. */
function forBlock(r: Reader, tag: Extract<Tag, { tag: 'for' }>): ProseFor {
  const body = run(r, tag.at);
  const closed = closeOf(r, tag.at, 'for');
  return {
    kind: 'prose-for',
    at: spanning(tag.at, closed),
    variable: tag.variable,
    filter: tag.filter,
    walks: tag.walks,
    over: tag.over,
    body,
  };
}

/**
 * `{one of}` through each `{or}` to its `{/one of}`. One with a single
 * choice is warned about, and renders that choice.
 */
function oneOfBlock(r: Reader, opened: Span): ProseOneOf {
  const choices = [run(r, opened)];
  for (let next = r.pending; next?.tag === 'or'; next = r.pending) {
    r.pending = null;
    choices.push(run(r, next.at));
  }
  const closed = closeOf(r, opened, 'one of');
  if (choices.length === 1) {
    r.p.diagnostics.warn(
      opened,
      'This `{one of}` has one choice, so it says the same words every time.',
      'Write another choice after an `{or}`, or take out `{one of}` and `{/one of}` and keep the words.',
    );
  }
  return { kind: 'prose-one-of', at: spanning(opened, closed), opened, choices };
}

/** A block's inside, from the tag that opened it to what stops it. */
function run(r: Reader, opened: Span): Prose {
  const pieces = sequence(r);
  const last = pieces.at(-1)?.at ?? opened;
  return { kind: 'prose', at: spanning(opened, last), pieces };
}

/**
 * The `{/if}` or `{/for}` closing a block, taken where it is the one
 * waiting. Where it is not, the block is refused as never closed and
 * ended there, and what is waiting is left for the block around it.
 */
function closeOf(r: Reader, opened: Span, closes: Closes): Span {
  const next = r.pending;
  if (next?.tag === 'close' && next.closes === closes) {
    r.pending = null;
    return next.at;
  }
  r.p.diagnostics.refuse(opened, `This \`{${closes}}\` is never closed.`, NEVER_CLOSED[closes]);
  return opened;
}

/** What to write where a block is never closed. */
const NEVER_CLOSED: Readonly<Record<Closes, string>> = {
  if: 'Add `{/if}` where the words it guards end.',
  for: 'Add `{/for}` where the words it repeats end.',
  'one of': 'Add `{/one of}` where its last choice ends.',
};

/**
 * A block too deep to read, stepped over past the close that ends it,
 * each `{if}`, `{for}` and `{one of}` inside it counted and nothing in it read.
 */
function skipBlock(r: Reader): void {
  let open = 1;
  while (r.at < r.scanned.length && open > 0) {
    const item = r.scanned[r.at]!;
    r.at += 1;
    if (item.item !== 'tag') continue;
    const inside = r.p.source.text.slice(item.start, item.end).trim();
    if (/^((if|for)(\s|$)|one\s+of$)/.test(inside)) open += 1;
    else if (/^\/\s*(if|for|one\s+of)\s*$/.test(inside)) open -= 1;
  }
}
