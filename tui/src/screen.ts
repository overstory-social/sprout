import type { Line } from './state.js';

// The client's window as rows of the terminal, with no terminal in it:
// the transcript's lines wrapped to the window's width at spaces, and the
// rows that fit above the input, counted up from the newest by how far
// the visitor has scrolled back. A column is a character; text that is
// wider on screen, as some scripts are, wraps late.

/** One row of the transcript on screen, styled as the line it belongs to is. */
export interface Row {
  readonly kind: Line['kind'];
  readonly text: string;
}

/** `text` in rows no wider than `width`, broken at spaces, a word too long for a row broken where it must be. */
export function wrap(text: string, width: number): string[] {
  const room = Math.max(1, width);
  const rows: string[] = [];
  for (const paragraph of text.split('\n')) {
    let row = '';
    for (const word of paragraph.split(' ')) {
      let rest = word;
      while (rest.length > room) {
        if (row !== '') rows.push(row);
        rows.push(rest.slice(0, room));
        rest = rest.slice(room);
        row = '';
      }
      if (row === '') row = rest;
      else if (row.length + 1 + rest.length <= room) row = `${row} ${rest}`;
      else {
        rows.push(row);
        row = rest;
      }
    }
    rows.push(row);
  }
  return rows;
}

/** Every line, wrapped to `width`, in order. */
export function rowsOf(lines: readonly Line[], width: number): Row[] {
  return lines.flatMap((line) => wrap(line.text, width).map((text) => ({ kind: line.kind, text })));
}

/** How far back a transcript may be scrolled: to where its first row is the top one shown. */
export function furthestBack(rows: number, height: number): number {
  return Math.max(0, rows - height);
}

/**
 * The rows shown in a window `height` rows tall, scrolled `back` rows up
 * from the newest, which is clamped to the transcript. Fewer rows than
 * the window are shown at its foot, as a transcript grows up from there.
 */
export function shown(rows: readonly Row[], height: number, back: number): Row[] {
  const from = Math.min(Math.max(0, back), furthestBack(rows.length, height));
  const end = rows.length - from;
  return rows.slice(Math.max(0, end - height), end);
}
