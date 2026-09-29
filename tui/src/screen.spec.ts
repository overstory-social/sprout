import { describe, expect, it } from 'vitest';

import { furthestBack, rowsOf, shown, wrap, type Row } from './screen.js';

describe('wrap', () => {
  it('breaks at the last space that fits, and never makes a row wider than the window', () => {
    expect(wrap('Lead and lamp oil. The composing frames', 12)).toEqual([
      'Lead and',
      'lamp oil.',
      'The',
      'composing',
      'frames',
    ]);
    for (const row of wrap('the quick brown fox jumps over the lazy dog', 7))
      expect(row.length).toBeLessThanOrEqual(7);
  });

  it('breaks a word too long for a row where it must, and keeps each paragraph and blank line', () => {
    expect(wrap('ab abcdefghij', 4)).toEqual(['ab', 'abcd', 'efgh', 'ij']);
    expect(wrap('one\n\ntwo', 10)).toEqual(['one', '', 'two']);
  });
});

describe('rowsOf', () => {
  it('wraps each line and keeps its kind on every row', () => {
    expect(
      rowsOf(
        [
          { kind: 'typed', text: '> look', level: 'prose' },
          { kind: 'refused', text: 'It is locked.', level: 'prose' },
        ],
        5,
      ),
    ).toEqual([
      { kind: 'typed', text: '>' },
      { kind: 'typed', text: 'look' },
      { kind: 'refused', text: 'It is' },
      { kind: 'refused', text: 'locke' },
      { kind: 'refused', text: 'd.' },
    ]);
  });
});

describe('shown', () => {
  const rows: Row[] = ['a', 'b', 'c', 'd', 'e'].map((text) => ({ kind: 'said', text }));
  const texts = (height: number, back: number) => shown(rows, height, back).map((row) => row.text);

  it('shows the newest rows that fit, and scrolled back shows earlier ones', () => {
    expect(texts(2, 0)).toEqual(['d', 'e']);
    expect(texts(2, 2)).toEqual(['b', 'c']);
  });

  it('stops at the first row however far back it is scrolled, and shows a short transcript whole', () => {
    expect(furthestBack(5, 2)).toBe(3);
    expect(texts(2, 99)).toEqual(['a', 'b']);
    expect(texts(9, 4)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});
