// Prose, cut into words and tags (the spec's Prose › Passages, Slots;
// The compiler › Lexical rules): the first pass of reading a passage's
// body or a line in quotes, before any tag is read for what it says.
//
// Escapes resolve as they do in quoted text, `\{` to a brace and `\n` to
// a line break reflow keeps; a backslash before anything else was refused
// by the lexer, and its character is kept. A blank line is a paragraph
// break, cut out of the words where it was written. A tag is a `{` to its
// `}`, with quoted text inside it read as text; a tag inside a tag is
// refused once and taken with the outer one, so nothing after it shifts.
// A `{verbatim}` block is cut out whole to its `{/verbatim}`, its spaces,
// line breaks and blank lines kept (the spec's Prose › Verbatim).

import type { ProseNewline, ProseParagraph, ProseVerbatim, ProseWords } from '../ast-prose.js';
import type { Diagnostics } from '../../source/diagnostics.js';
import type { SourceFile, Span } from '../../source/source.js';

/** One thing prose is cut into: words, a break, or a tag still to be read. */
export type Scanned =
  | {
      readonly item: 'piece';
      readonly piece: ProseWords | ProseParagraph | ProseNewline | ProseVerbatim;
    }
  | {
      readonly item: 'tag';
      /** The tag, braces and all. */
      readonly at: Span;
      /** Where what is between its braces starts and ends in the file. */
      readonly start: number;
      readonly end: number;
      /** Whether a slot was opened inside it, which has been refused, and it is not read. */
      readonly refused: boolean;
    };

/** Prose from `start` to `end` of `source`, cut into words, breaks and tags. */
export function scanProse(
  source: SourceFile,
  start: number,
  end: number,
  diagnostics: Diagnostics,
): Scanned[] {
  const text = source.text;
  const scanned: Scanned[] = [];
  let words = '';
  let wordsStart = start;
  const flush = (at: number): void => {
    if (words.length > 0) {
      scanned.push({
        item: 'piece',
        piece: { kind: 'prose-words', at: source.span(wordsStart, at), text: words },
      });
    }
    words = '';
  };

  let i = start;
  while (i < end) {
    const ch = text[i]!;
    if (ch === '\\') {
      const escape = i + 1 < end ? text[i + 1]! : '';
      if (escape === 'n') {
        flush(i);
        scanned.push({
          item: 'piece',
          piece: { kind: 'prose-newline', at: source.span(i, i + 2) },
        });
        i += 2;
        wordsStart = i;
        continue;
      }
      // Anything else after a backslash was refused where the file was
      // read, and its character is kept, as quoted text keeps it.
      if (escape !== '' && escape !== '\n') words += escape;
      i += escape === '' || escape === '\n' ? 1 : 2;
      continue;
    }
    if (ch === '\n') {
      const blank = blankLineEnd(text, i, end);
      if (blank !== null) {
        flush(i);
        scanned.push({
          item: 'piece',
          piece: { kind: 'prose-paragraph', at: source.span(i, blank) },
        });
        i = blank;
        wordsStart = i;
        continue;
      }
    }
    if (ch === '{') {
      flush(i);
      const close = tagEnd(source, i, end, diagnostics);
      if (!close.refused && text.slice(i + 1, close.inner).trim() === 'verbatim') {
        const block = verbatimBlock(source, i, close.after, end, diagnostics);
        scanned.push({
          item: 'piece',
          piece: { kind: 'prose-verbatim', at: source.span(i, block.after), text: block.text },
        });
        i = block.after;
        wordsStart = i;
        continue;
      }
      scanned.push({
        item: 'tag',
        at: source.span(i, close.after),
        start: i + 1,
        end: close.inner,
        refused: close.refused,
      });
      i = close.after;
      wordsStart = i;
      continue;
    }
    words += ch;
    i += 1;
  }
  flush(end);
  return scanned;
}

/** `{/verbatim}`, with any spaces inside its braces. */
const VERBATIM_CLOSE = /^\{\s*\/\s*verbatim\s*\}/;

/**
 * The words of a `{verbatim}` block opened at `open`, whose inside starts
 * at `from`, and where reading resumes past its `{/verbatim}`. A line
 * break straight after the opening tag and one straight before the close
 * are the block's frame, not its words, and the indentation of the line
 * the opening tag stands on is taken off every line after it, so the
 * block can sit indented with the passage around it. A slot or a block
 * inside is refused: a verbatim block holds only its words.
 */
function verbatimBlock(
  source: SourceFile,
  open: number,
  from: number,
  end: number,
  diagnostics: Diagnostics,
): { readonly text: string; readonly after: number } {
  const text = source.text;
  let close = -1;
  let refused = false;
  for (let i = from; i < end; i++) {
    const ch = text[i]!;
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch !== '{') continue;
    const closing = VERBATIM_CLOSE.exec(text.slice(i, end));
    if (closing !== null) {
      close = i;
      break;
    }
    if (!refused) {
      refused = true;
      diagnostics.refuse(
        source.span(i, i + 1),
        'A `{verbatim}` block holds only its words, laid out as written, so it holds no slot.',
        'Write \\{ for a brace that is only a character, or end the block with `{/verbatim}` before the slot.',
      );
    }
  }
  if (close === -1) {
    diagnostics.refuse(
      source.span(open, from),
      'This `{verbatim}` is never closed.',
      'Add `{/verbatim}` where the words it keeps as written end.',
    );
  }
  const stop = close === -1 ? end : close;
  const after = close === -1 ? end : close + VERBATIM_CLOSE.exec(text.slice(close, end))![0].length;

  let raw = text.slice(from, stop);
  const firstBreak = raw.indexOf('\n');
  const openedAlone = firstBreak !== -1 && raw.slice(0, firstBreak).trim() === '';
  if (openedAlone) raw = raw.slice(firstBreak + 1);
  const lastBreak = raw.lastIndexOf('\n');
  if (lastBreak !== -1 && raw.slice(lastBreak + 1).trim() === '') raw = raw.slice(0, lastBreak);
  else if (lastBreak === -1 && openedAlone && raw.trim() === '') raw = '';

  const lineStart = text.lastIndexOf('\n', open - 1) + 1;
  const margin = /^[ \t]*/.exec(text.slice(lineStart, open))![0].length;
  const lines = raw
    .split('\n')
    .map((line, n) =>
      n === 0 && !openedAlone
        ? line
        : line.slice(Math.min(margin, /^[ \t]*/.exec(line)![0].length)),
    );
  return { text: resolveEscapes(lines.join('\n')), after };
}

/** Quoted text's escapes resolved: `\n` a line break, `\{` a brace, `\\` and `\"` themselves. */
function resolveEscapes(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (ch !== '\\' || i + 1 >= raw.length) {
      out += ch;
      continue;
    }
    const escape = raw[i + 1]!;
    out += escape === 'n' ? '\n' : escape;
    i += 1;
  }
  return out;
}

/**
 * Where a blank line starting at the newline `at` ends: past every line
 * of nothing but spaces after it, to the start of the next words. Null
 * where the next line has words on it.
 */
function blankLineEnd(text: string, at: number, end: number): number | null {
  let i = at + 1;
  while (i < end && (text[i] === ' ' || text[i] === '\t' || text[i] === '\r')) i++;
  if (i >= end || text[i] !== '\n') return null;
  while (i < end && /\s/.test(text[i]!)) i++;
  return i;
}

/**
 * The `}` closing the tag opened at `open`: where its inside ends and
 * where reading resumes. Quoted text inside is text, with its own
 * escapes. A `{` inside is refused once and its `}` matched, so the
 * outer tag closes where its author closed it; a tag never closed is
 * refused at its `{` and ends where the prose does.
 */
function tagEnd(
  source: SourceFile,
  open: number,
  end: number,
  diagnostics: Diagnostics,
): { readonly inner: number; readonly after: number; readonly refused: boolean } {
  const text = source.text;
  let depth = 0;
  let quoted = false;
  let nested = false;
  for (let i = open + 1; i < end; i++) {
    const ch = text[i]!;
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (quoted) {
      if (ch === '"' || ch === '\n') quoted = false;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === '{') {
      if (!nested) {
        nested = true;
        diagnostics.refuse(
          source.span(i, i + 1),
          'A slot cannot hold another slot.',
          'Close the first with } before opening the next, or write \\{ for a brace that is only a character.',
        );
      }
      depth += 1;
    } else if (ch === '}') {
      if (depth === 0) return { inner: i, after: i + 1, refused: nested };
      depth -= 1;
    }
  }
  diagnostics.refuse(
    source.span(open, open + 1),
    'This slot is never closed.',
    'Add a } where it ends, or write \\{ for a brace that is only a character.',
  );
  return { inner: end, after: end, refused: true };
}
