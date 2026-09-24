// Prose, read: a passage's body and a line in quotes, as the blocks and
// slots they hold (the spec's Prose › Passages, Slots, Conditionals and
// loops). `prose-scan.ts` cuts the words from the tags and `prose-tags.ts`
// reads each tag; this puts them together, each `{if}` and `{for}` around
// what it guards up to its close.
//
// Reading recovers as the source parser does: a tag that cannot be read
// costs itself; a close, `{else}` or `{or}` that no open block takes is
// refused and stepped over; and a block a close for an enclosing block
// reaches first is refused as never closed and ended there, so the words
// around every mistake are still read and each mistake is said once.
// `{one of}` is Chance's, which this compiler does not read; the choice
// it opens is refused once and stepped over to its `{/one of}`.

import type { Prose, ProseFor, ProseIf, ProsePiece } from '../ast-prose.js';
import { DEEPEST, type Parser } from './parser.js';
import { spanning, type Span } from '../../source/source.js';
import { scanProse, type Scanned } from './prose-scan.js';
import { readTag, type Tag } from './prose-tags.js';

/** Prose from `start` to `end` of the file `p` reads. */
export function readProse(p: Parser, start: number, end: number): Prose {
  const scanned = scanProse(p.source, start, end, p.diagnostics);
  const reader: Reader = { p, scanned, at: 0, open: [], tooDeep: false, pending: null };
  const pieces = sequence(reader);
  return { kind: 'prose', at: p.source.span(start, end), pieces };
}

/** Which part of which block reading is inside. */
type Open = 'if' | 'else' | 'for';

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
function closedByOpen(r: Reader, closes: 'if' | 'for'): boolean {
  return r.open.some((open) => (closes === 'for' ? open === 'for' : open !== 'for'));
}

/**
 * Pieces up to the end of the prose, or up to a close or an `{else}` an
 * open block takes, which is left in `pending` for it.
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
      case 'chance':
        refuseChance(r, tag.at, tag.written);
        if (tag.written === '{one of}') skipChoice(r);
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
function closeOf(r: Reader, opened: Span, closes: 'if' | 'for'): Span {
  const next = r.pending;
  if (next?.tag === 'close' && next.closes === closes) {
    r.pending = null;
    return next.at;
  }
  r.p.diagnostics.refuse(
    opened,
    `This \`{${closes}}\` is never closed.`,
    closes === 'if'
      ? 'Add `{/if}` where the words it guards end.'
      : 'Add `{/for}` where the words it repeats end.',
  );
  return opened;
}

/**
 * A block too deep to read, stepped over past the close that ends it,
 * each `{if}` and `{for}` inside it counted and nothing in it read.
 */
function skipBlock(r: Reader): void {
  let open = 1;
  while (r.at < r.scanned.length && open > 0) {
    const item = r.scanned[r.at]!;
    r.at += 1;
    if (item.item !== 'tag') continue;
    const inside = r.p.source.text.slice(item.start, item.end).trim();
    if (/^(if|for)(\s|$)/.test(inside)) open += 1;
    else if (/^\/\s*(if|for)\s*$/.test(inside)) open -= 1;
  }
}

/** The words of a `{one of}` already refused, stepped over to its `{/one of}`. */
function skipChoice(r: Reader): void {
  let open = 1;
  while (r.at < r.scanned.length && open > 0) {
    const item = r.scanned[r.at]!;
    r.at += 1;
    if (item.item !== 'tag') continue;
    const inside = r.p.source.text.slice(item.start, item.end).trim().replace(/\s+/g, ' ');
    if (inside === 'one of') open += 1;
    else if (inside === '/one of') open -= 1;
  }
}

function refuseChance(r: Reader, at: Span, written: string): void {
  r.p.diagnostics.refuse(
    at,
    `\`${written}\` is not something this compiler reads.`,
    "A passage's blocks are `{if …}` and `{for …}`. Write one line in place of the choice.",
  );
}
