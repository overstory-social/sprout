import { describe, expect, it } from 'vitest';

import { capitalise, reflow, type Rendered } from './reflow.js';

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

describe('a line capitalised', () => {
  it('has its first letter made a capital, past a quote or a bracket it opens with', () => {
    expect(capitalise('you')).toBe('You');
    expect(capitalise('"you," she says')).toBe('"You," she says');
    expect(capitalise('(and then)')).toBe('(And then)');
    expect(capitalise('3 sheets')).toBe('3 sheets');
    expect(capitalise('Already')).toBe('Already');
    expect(capitalise('')).toBe('');
  });
});
