import { describe, expect, it } from 'vitest';

import { chooser } from '../fixtures/parse.js';
import { capitalise, reflow, slotted, type Rendered } from './reflow.js';

const words = (text: string): Rendered => ({ words: text });
const PARAGRAPH: Rendered = { break: 'paragraph' };
const LINE: Rendered = { break: 'line' };

describe('rendered words are reflowed into paragraphs', () => {
  it('makes every run of spaces and line breaks one space, and trims each paragraph', () => {
    expect(
      reflow([words('  The glass is older\n    than the frame, '), words('\tand the house. ')]),
    ).toEqual(['The glass is older than the frame, and the house.']);
  });

  it('breaks a paragraph at a blank line, and leaves none where nothing was rendered', () => {
    expect(
      reflow([words('One.'), PARAGRAPH, words('  \n '), PARAGRAPH, PARAGRAPH, words('Two.')]),
    ).toEqual(['One.', 'Two.']);
    expect(reflow([PARAGRAPH, words(' '), PARAGRAPH])).toEqual([]);
  });

  it('keeps a line break written `\\n`, inside the paragraph', () => {
    expect(reflow([words('first, '), LINE, words('  second')])).toEqual(['First,\nSecond']);
  });

  it('capitalises the first letter of every line, where a slot so often sits', () => {
    expect(reflow([words('you take a key.'), PARAGRAPH, words('marta waves.')])).toEqual([
      'You take a key.',
      'Marta waves.',
    ]);
  });
});

describe('rendered words as a slot puts them in its line', () => {
  it('loses the space at either end, and keeps the space between', () => {
    expect(slotted([words('  a '), words(' leaflet  ')])).toEqual([words('a '), words(' leaflet')]);
    expect(slotted([words('  a leaflet  ')])).toEqual([words('a leaflet')]);
  });

  it('keeps a blank line at either end as one paragraph break, and the breaks between', () => {
    expect(
      slotted([PARAGRAPH, words(' \n '), words('  one'), PARAGRAPH, words('two \n'), PARAGRAPH]),
    ).toEqual([PARAGRAPH, words('one'), PARAGRAPH, words('two'), PARAGRAPH]);
    expect(slotted([PARAGRAPH, PARAGRAPH, words('one'), LINE])).toEqual([
      PARAGRAPH,
      words('one'),
      LINE,
    ]);
  });

  it('makes two `\\n` at an end a paragraph break, and keeps one as a line break', () => {
    expect(slotted([LINE, words(' '), LINE, words(' one ')])).toEqual([PARAGRAPH, words('one')]);
    expect(slotted([LINE, words(' one '), LINE])).toEqual([LINE, words('one'), LINE]);
    expect(slotted([words('one'), LINE, PARAGRAPH])).toEqual([words('one'), PARAGRAPH]);
  });

  it('leaves nothing where it holds no words, whatever breaks it holds', () => {
    expect(slotted([PARAGRAPH, words('   '), PARAGRAPH])).toEqual([]);
    expect(slotted([LINE, LINE, words(' '), PARAGRAPH])).toEqual([]);
    expect(slotted([])).toEqual([]);
  });

  it('as reflow lays it out in a line, breaks it into paragraphs only where it renders words', () => {
    const line = (inner: Rendered[]) =>
      reflow([words('One.'), ...slotted(inner), words(' After.')]);
    expect(line([PARAGRAPH, words('Two.'), PARAGRAPH])).toEqual(['One.', 'Two.', 'After.']);
    expect(line([PARAGRAPH, words('  '), PARAGRAPH])).toEqual(['One. After.']);
  });

  it('over generated pieces, reads alone as the passage does, and is nothing exactly where it has no words', () => {
    const PIECES: Rendered[] = [
      PARAGRAPH,
      LINE,
      words(' '),
      words('\n  '),
      words(' a '),
      words('b'),
    ];
    for (let seed = 1; seed <= 500; seed++) {
      const c = chooser(seed);
      const given = Array.from({ length: c.below(8) }, () => c.one(PIECES));
      const shown = JSON.stringify(given);
      const laid = slotted(given);
      // Slotting moves only where its ends meet the line, never what it says.
      expect(reflow(laid), shown).toEqual(reflow(given));
      expect(laid.length === 0, shown).toBe(reflow(given).length === 0);
      const [first, last] = [laid[0], laid.at(-1)];
      if (first !== undefined && 'words' in first) expect(first.words, shown).not.toMatch(/^\s/);
      if (last !== undefined && 'words' in last) expect(last.words, shown).not.toMatch(/\s$/);
    }
  });

  it('leaves what it lays out unchanged', () => {
    const given = [words(' one ')];
    slotted(given);
    expect(given).toEqual([words(' one ')]);
  });
});

describe('a line capitalised', () => {
  it('has its first letter made a capital, past a quotation mark it opens with', () => {
    expect(capitalise('you')).toBe('You');
    expect(capitalise('"you," she says')).toBe('"You," she says');
    expect(capitalise("'you,' she says")).toBe("'You,' she says");
    expect(capitalise('\u201Cyou,\u201D she says')).toBe('\u201CYou,\u201D she says');
    for (const quote of ['\u201C', '\u2018', '\u201E', '\u201A', '\u00AB', '\u2039']) {
      expect(capitalise(`${quote}you`)).toBe(`${quote}You`);
    }
    expect(capitalise('\u2014and then')).toBe('\u2014And then');
    expect(capitalise('...and then')).toBe('...And then');
    expect(capitalise('3 sheets')).toBe('3 sheets');
    expect(capitalise('Already')).toBe('Already');
    expect(capitalise('')).toBe('');
  });

  it('keeps the lower case of a line that opens with a bracket, as `meant` does', () => {
    expect(capitalise('(the wooden rib)')).toBe('(the wooden rib)');
    expect(capitalise('[aside]')).toBe('[aside]');
    expect(capitalise('{aside}')).toBe('{aside}');
    expect(capitalise('\u2014(aside)')).toBe('\u2014(aside)');
    expect(capitalise('"(quietly) yes"')).toBe('"(quietly) yes"');
    expect(reflow([words('(the wooden rib)'), PARAGRAPH, words('you take it.')])).toEqual([
      '(the wooden rib)',
      'You take it.',
    ]);
  });
});
