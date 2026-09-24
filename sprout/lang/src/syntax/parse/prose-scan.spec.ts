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

  it('spans every piece where it was written, so a problem in one points at it', () => {
    const { scanned } = scan('ab\n\ncd{e}');
    const spans = scanned.map((item) => textOf(item.item === 'tag' ? item.at : item.piece.at));
    expect(spans).toEqual(['ab', '\n\n', 'cd', '{e}']);
  });
});
