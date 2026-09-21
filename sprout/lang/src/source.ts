// Where a thing was written (B01; the spec's The compiler › Diagnostics).
//
// "Every problem names the line and column of the thing it is about. Not
// the head of the definition — the token." That is a property of the
// compiler's whole data model rather than of its error messages: a
// diagnostic can only name a token if the node it is complaining about
// remembered which token it came from. So every node the compiler builds
// carries a SPAN, and a span is two offsets into one file.
//
// Offsets rather than line/column pairs, because a span is carried by
// every node of every tree and computed from by almost none of them:
// two integers and a reference to build, a binary search over a line
// index only when something is actually being reported.

/** A place in a file, both 1-based, as a person counts them. */
export interface Position {
  readonly line: number;
  readonly column: number;
}

/**
 * Half-open `[start, end)` over the code units of one file. `start ===
 * end` is a zero-width span — the end of the file, or the point a thing
 * that was never written should have been.
 */
export interface Span {
  readonly source: SourceFile;
  readonly start: number;
  readonly end: number;
}

/**
 * One file of a microworld: the name a diagnostic prints and the text it
 * points into. Files are addressed by the name they carry in the bundle
 * (`kiln.sprout`, `composing_room.prose`), which is what an author sees
 * and what a moderator reads.
 *
 * A line index is built on first use and kept, so a file that is never
 * complained about never pays for one.
 */
export class SourceFile {
  private starts: number[] | null = null;

  constructor(
    readonly name: string,
    readonly text: string,
  ) {}

  /** The offset each line begins at, lowest first. Lines are separated by `\n`. */
  private lineStarts(): number[] {
    if (this.starts === null) {
      const starts = [0];
      for (let i = 0; i < this.text.length; i++) if (this.text[i] === '\n') starts.push(i + 1);
      this.starts = starts;
    }
    return this.starts;
  }

  /** How many lines the file has. An empty file has one, and it is empty. */
  get lines(): number {
    return this.lineStarts().length;
  }

  /**
   * The line and column of an offset. A tab counts as one column, which
   * is what an editor's own column counter does and what an author can
   * check by looking. An offset outside the file clamps to its ends
   * rather than throwing: a position is for telling someone where to
   * look, and refusing to answer helps nobody.
   */
  positionAt(offset: number): Position {
    const at = Math.max(0, Math.min(Math.trunc(offset), this.text.length));
    const starts = this.lineStarts();
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (starts[mid]! <= at) low = mid;
      else high = mid - 1;
    }
    return { line: low + 1, column: at - starts[low]! + 1 };
  }

  /** The offset a 1-based line and column names, clamped into the file. */
  offsetAt(position: Position): number {
    const starts = this.lineStarts();
    const line = Math.max(1, Math.min(Math.trunc(position.line), starts.length));
    const start = starts[line - 1]!;
    const end = line < starts.length ? starts[line]! : this.text.length;
    const column = Math.max(1, Math.trunc(position.column));
    return Math.min(start + column - 1, end);
  }

  /** One 1-based line, without its newline. Out of range reads as empty. */
  lineText(line: number): string {
    const starts = this.lineStarts();
    if (line < 1 || line > starts.length) return '';
    const start = starts[line - 1]!;
    const end = line < starts.length ? starts[line]! : this.text.length;
    return this.text.slice(start, end).replace(/\r?\n$/, '');
  }

  /** A span over this file, with its offsets ordered and clamped. */
  span(start: number, end: number = start): Span {
    const a = Math.max(0, Math.min(Math.trunc(start), this.text.length));
    const b = Math.max(0, Math.min(Math.trunc(end), this.text.length));
    return { source: this, start: Math.min(a, b), end: Math.max(a, b) };
  }

  /** The zero-width span at the end of the file — where an unterminated thing ran out. */
  get endSpan(): Span {
    return this.span(this.text.length);
  }
}

/** The text a span covers. */
export function textOf(span: Span): string {
  return span.source.text.slice(span.start, span.end);
}

/** Where a span starts: the line and column a diagnostic names. */
export function positionOf(span: Span): Position {
  return span.source.positionAt(span.start);
}

/** `kiln.sprout:23:9` — a span written the way a diagnostic prints it. */
export function locationOf(span: Span): string {
  const { line, column } = positionOf(span);
  return `${span.source.name}:${line}:${column}`;
}

/**
 * The smallest span covering both — how a node built from several tokens
 * gets a span covering all of them. Both must be in the same file; a
 * span joining two files is a bug in the compiler rather than a problem
 * with the world, so it throws where a compile problem would be reported.
 */
export function spanning(first: Span, ...rest: Span[]): Span {
  let start = first.start;
  let end = first.end;
  for (const span of rest) {
    if (span.source !== first.source) {
      throw new Error(`A span cannot cross files: ${first.source.name} and ${span.source.name}.`);
    }
    start = Math.min(start, span.start);
    end = Math.max(end, span.end);
  }
  return { source: first.source, start, end };
}

/** Whether a span covers no text: the end of the file, or a thing that was never written. */
export function isEmptySpan(span: Span): boolean {
  return span.start === span.end;
}
