// Rendered words, laid out (the spec's Prose › Passages, Slots). Lines in
// source are reflowed: every run of spaces and line breaks is one space,
// and a paragraph has none at its ends. A blank line is a paragraph break,
// and a paragraph left with nothing in it is no paragraph, so a block that
// renders nothing leaves none behind. `\n` is a line break reflow keeps.
// The first letter of every rendered line is capitalised.

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

/** A line with its first letter capitalised, past any quote or bracket it opens with. */
export function capitalise(line: string): string {
  const lead = /^[^\p{L}\p{N}]*/u.exec(line)?.[0].length ?? 0;
  const first = line.charAt(lead);
  return `${line.slice(0, lead)}${first.toUpperCase()}${line.slice(lead + 1)}`;
}
