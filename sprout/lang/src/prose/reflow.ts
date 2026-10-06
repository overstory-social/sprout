// Rendered words, laid out (the spec's Prose › Passages, Slots). Lines in
// source are reflowed: every run of spaces and line breaks is one space,
// and a paragraph has none at its ends. A blank line is a paragraph break,
// and a paragraph left with nothing in it is no paragraph, so a block that
// renders nothing leaves none behind. `\n` is a line break reflow keeps.
// The first letter of every rendered line is capitalised, past an opening
// quotation mark but not past a bracket. A passage put into a slot loses
// the padding inside its braces, so none is left before the words that
// follow the slot, and keeps a paragraph break it opens or closes with
// only where it renders words, so an empty one leaves nothing behind.

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
 * `rendered` as a slot puts it in its line: nothing, where it holds no
 * words; otherwise its words with the space at their ends taken off, a
 * blank line or two `\n` at either end a paragraph break, and one `\n` a
 * line break (the spec's Prose › Slots).
 */
export function slotted(rendered: readonly Rendered[]): Rendered[] {
  const said = (piece: Rendered): boolean => 'words' in piece && piece.words.trim() !== '';
  const first = rendered.findIndex(said);
  if (first < 0) return [];
  let last = rendered.length - 1;
  while (!said(rendered[last]!)) last--;
  const inner = rendered.slice(first, last + 1).map((piece, at, all) => {
    if (!('words' in piece)) return piece;
    let words = piece.words;
    if (at === 0) words = words.trimStart();
    if (at === all.length - 1) words = words.trimEnd();
    return { words };
  });
  return [...edge(rendered.slice(0, first)), ...inner, ...edge(rendered.slice(last + 1))];
}

/** The break the space at a slotted passage's end leaves: a paragraph, a line, or none. */
function edge(space: readonly Rendered[]): Rendered[] {
  const breaks = space.flatMap((piece) => ('break' in piece ? [piece.break] : []));
  if (breaks.includes('paragraph') || breaks.length > 1) return [{ break: 'paragraph' }];
  return breaks.length === 1 ? [{ break: 'line' }] : [];
}

/**
 * A line with its first letter capitalised, past any quotation mark, dash
 * or other mark it opens with, unless a bracket comes first among them, so
 * `meant`'s "(the wooden rib)" keeps its lower case (the spec's Prose › Slots).
 */
export function capitalise(line: string): string {
  const opening = /^[^\p{L}\p{N}]*/u.exec(line)?.[0] ?? '';
  if (/[([{]/.test(opening)) return line;
  const lead = opening.length;
  const first = line.charAt(lead);
  return `${line.slice(0, lead)}${first.toUpperCase()}${line.slice(lead + 1)}`;
}
