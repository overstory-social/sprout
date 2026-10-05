import { describe, expect, it } from 'vitest';

import { capitalise, reflow, trimmed, type Rendered } from './reflow.js';

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

describe('rendered words trimmed at their ends', () => {
  it('loses the space at either end, and keeps the space between', () => {
    expect(trimmed([words('  a '), words(' leaflet  ')])).toEqual([words('a '), words(' leaflet')]);
  });

  it('drops pieces that were only space, and the blank lines at either end', () => {
    expect(
      trimmed([PARAGRAPH, words(' \n '), words('  one'), PARAGRAPH, words('two \n'), PARAGRAPH]),
    ).toEqual([words('one'), PARAGRAPH, words('two')]);
    expect(trimmed([PARAGRAPH, words('   '), PARAGRAPH])).toEqual([]);
  });

  it('keeps a line break written `\\n` at either end, as written words', () => {
    expect(trimmed([LINE, words(' one '), LINE])).toEqual([LINE, words(' one '), LINE]);
  });

  it('leaves what it trims unchanged', () => {
    const given = [words(' one ')];
    trimmed(given);
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
