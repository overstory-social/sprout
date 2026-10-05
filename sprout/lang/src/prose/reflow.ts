// Rendered words, laid out (the spec's Prose › Passages, Slots). Lines in
// source are reflowed: every run of spaces and line breaks is one space,
// and a paragraph has none at its ends. A blank line is a paragraph break,
// and a paragraph left with nothing in it is no paragraph, so a block that
// renders nothing leaves none behind. `\n` is a line break reflow keeps.
// The first letter of every rendered line is capitalised, past an opening
// quotation mark but not past a bracket. A passage put
// into a slot is trimmed at its ends first, so the padding inside its
// braces is not left before the words that follow the slot.

/** What rendering prose gives, in order: words, or a break. */
export type Rendered =
  | { readonly words: string }
  /** A blank line, or `\n`, which reflow keeps. */
  | { readonly break: 'paragraph' | 'line' };

/** The paragraphs `rendered` lays out to, each its lines joined by a line break. */
export function reflow(rendered: readonly Rendered[]): string[] {
  const paragraphs: string[] = [];
  let lines: string[] = [''];
  const close = (): void => {
    const text = lines
      .map((line) => capitalise(line.replace(/\s+/g, ' ').trim()))
      .join('\n')
      .trim();
    if (text.length > 0) paragraphs.push(text);
    lines = [''];
  };
  for (const piece of rendered) {
    if ('words' in piece) lines[lines.length - 1] += piece.words;
    else if (piece.break === 'paragraph') close();
    else lines.push('');
  }
  close();
  return paragraphs;
}

/**
 * `rendered` with the space at its ends taken off: leading and trailing
 * whitespace, and the blank lines a body opens or closes with. A `\n` is
 * written, not space, and is kept.
 */
export function trimmed(rendered: readonly Rendered[]): Rendered[] {
  const out = [...rendered];
  while (out.length > 0) {
    const first = out[0]!;
    if ('break' in first) {
      if (first.break === 'line') break;
      out.shift();
      continue;
    }
    const words = first.words.trimStart();
    if (words !== '') {
      out[0] = { words };
      break;
    }
    out.shift();
  }
  while (out.length > 0) {
    const last = out[out.length - 1]!;
    if ('break' in last) {
      if (last.break === 'line') break;
      out.pop();
      continue;
    }
    const words = last.words.trimEnd();
    if (words !== '') {
      out[out.length - 1] = { words };
      break;
    }
    out.pop();
  }
  return out;
}

/**
 * A line with its first letter capitalised, past any quotation marks it
 * opens with but not past a bracket, so `meant`'s "(the wooden rib)" keeps
 * its lower case (the spec's Prose › Slots).
 */
export function capitalise(line: string): string {
  const lead = /^["'\u201C\u2018]*/u.exec(line)?.[0].length ?? 0;
  const first = line.charAt(lead);
  return `${line.slice(0, lead)}${first.toUpperCase()}${line.slice(lead + 1)}`;
}
