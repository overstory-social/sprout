import { describe, expect, it } from 'vitest';

import { Diagnostics } from '../../source/diagnostics.js';
import { locationOf, SourceFile, textOf } from '../../source/source.js';
import { scanProse, type Scanned } from './prose-scan.js';

function scan(text: string) {
  const source = new SourceFile('lines.prose', text);
  const diagnostics = new Diagnostics();
  const scanned = scanProse(source, 0, text.length, diagnostics);
  return { scanned, refusals: diagnostics.refusals };
}

/** What each item is: words as they mean, a break by name, a tag as written. */
const shape = (scanned: readonly Scanned[]): string[] =>
  scanned.map((item) =>
    item.item === 'tag'
      ? `tag ${textOf(item.at)}${item.refused ? ' (refused)' : ''}`
      : item.piece.kind === 'prose-words'
        ? `words ${JSON.stringify(item.piece.text)}`
        : item.piece.kind,
  );

/** The text of each verbatim block scanned. */
const verbatimText = (scanned: readonly Scanned[]): string[] =>
  scanned.flatMap((item) =>
    item.item === 'piece' && item.piece.kind === 'prose-verbatim' ? [item.piece.text] : [],
  );

describe('prose is cut into words, breaks and tags', () => {
  it('keeps a single line break in the words, for the renderer to reflow', () => {
    expect(shape(scan('one\n  two').scanned)).toEqual(['words "one\\n  two"']);
  });

  it('cuts a blank line out of the words as a paragraph break, however many lines it spans', () => {
    const { scanned } = scan('one\n\n  \n\ttwo');
    expect(shape(scanned)).toEqual(['words "one"', 'prose-paragraph', 'words "two"']);
  });

  it('reads the escapes of quoted text: `\\{` a brace, `\\n` a line break kept, `\\\\` and `\\"` themselves', () => {
    const { scanned, refusals } = scan('a \\{ b \\\\ c \\" d\\ne');
    expect(refusals).toEqual([]);
    expect(shape(scanned)).toEqual(['words "a { b \\\\ c \\" d"', 'prose-newline', 'words "e"']);
  });

  it('takes a tag from its `{` to its `}`, quoted text inside it read as text', () => {
    const { scanned } = scan('x {"}"} y {self}');
    expect(shape(scanned)).toEqual(['words "x "', 'tag {"}"}', 'words " y "', 'tag {self}']);
  });

  it('refuses a slot inside a slot once, and takes both to the outer one’s close', () => {
    const { scanned, refusals } = scan('{a {b} {c}} after');
    expect(refusals.map((d) => [locationOf(d.at), d.message])).toEqual([
      ['lines.prose:1:4', 'A slot cannot hold another slot.'],
    ]);
    expect(shape(scanned)).toEqual(['tag {a {b} {c}} (refused)', 'words " after"']);
  });

  it('refuses a slot never closed at its `{`, and it ends where the prose does', () => {
    const { scanned, refusals } = scan('You pull {self.');
    expect(refusals.map((d) => [locationOf(d.at), d.message, d.remedy])).toEqual([
      [
        'lines.prose:1:10',
        'This slot is never closed.',
        'Add a } where it ends, or write \\{ for a brace that is only a character.',
      ],
    ]);
    expect(shape(scanned)).toEqual(['words "You pull "', 'tag {self. (refused)']);
  });

  it('cuts a verbatim block out whole, its spaces, breaks and blank lines kept', () => {
    const { scanned, refusals } = scan('a {verbatim}  x   y\n\n z{/verbatim} b');
    expect(refusals).toEqual([]);
    expect(shape(scanned)).toEqual(['words "a "', 'prose-verbatim', 'words " b"']);
    expect(verbatimText(scanned)).toEqual(['  x   y\n\n z']);
  });

  it('takes off the breaks just inside its tags and the indentation of its opening line', () => {
    const text = 'Above.\n    {verbatim}\n      W   E\n\n    end\n    {/verbatim}\nBelow.';
    const { scanned } = scan(text);
    expect(shape(scanned)).toEqual([
      'words "Above.\\n    "',
      'prose-verbatim',
      'words "\\nBelow."',
    ]);
    expect(verbatimText(scanned)).toEqual(['  W   E\n\nend']);
  });

  it('keeps a first line written on the opening tag’s own line whole', () => {
    const { scanned } = scan('  {verbatim}   one\n    two{/verbatim}');
    expect(verbatimText(scanned)).toEqual(['   one\n  two']);
  });

  it('resolves escapes inside a verbatim block, and a close may hold spaces', () => {
    const { scanned, refusals } = scan('{verbatim}a\\{b\\nc \\\\ d{ / verbatim }');
    expect(refusals).toEqual([]);
    expect(verbatimText(scanned)).toEqual(['a{b\nc \\ d']);
  });

  it('refuses a slot inside a verbatim block once, and keeps reading to its close', () => {
    const { scanned, refusals } = scan('{verbatim}a {self} {b}{/verbatim} after');
    expect(refusals.map((d) => [locationOf(d.at), d.message])).toEqual([
      [
        'lines.prose:1:13',
        'A `{verbatim}` block holds only its words, laid out as written, so it holds no slot.',
      ],
    ]);
    expect(shape(scanned)).toEqual(['prose-verbatim', 'words " after"']);
  });

  it('refuses a verbatim block never closed at its opening tag, and it ends where the prose does', () => {
    const { scanned, refusals } = scan('x {verbatim} kept');
    expect(refusals.map((d) => [locationOf(d.at), d.message])).toEqual([
      ['lines.prose:1:3', 'This `{verbatim}` is never closed.'],
    ]);
    expect(verbatimText(scanned)).toEqual([' kept']);
  });

  it('spans every piece where it was written, so a problem in one points at it', () => {
    const { scanned } = scan('ab\n\ncd{e}');
    const spans = scanned.map((item) => textOf(item.item === 'tag' ? item.at : item.piece.at));
    expect(spans).toEqual(['ab', '\n\n', 'cd', '{e}']);
  });
});
