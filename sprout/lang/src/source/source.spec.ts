import { describe, expect, it } from 'vitest';

import {
  isEmptySpan,
  locationOf,
  positionOf,
  SourceFile,
  spanning,
  textOf,
  type Span,
} from './source.js';

const KILN = new SourceFile(
  'kiln.sprout',
  ['object kiln: sprout.Fixture in yard {', '  :door open', '}', ''].join('\n'),
);

describe('SourceFile counts lines and columns the way a person does', () => {
  it('starts at line 1, column 1', () => {
    expect(KILN.positionAt(0)).toEqual({ line: 1, column: 1 });
  });

  it('puts the first character of a later line in column 1', () => {
    const offset = KILN.text.indexOf('  :door');
    expect(KILN.positionAt(offset)).toEqual({ line: 2, column: 1 });
  });

  it('names the column of a token inside a line', () => {
    const offset = KILN.text.indexOf(':door');
    expect(KILN.positionAt(offset)).toEqual({ line: 2, column: 3 });
  });

  it('counts a tab as one column, which is what an editor shows', () => {
    const tabbed = new SourceFile('tabbed.sprout', '\t\t:door open');
    expect(tabbed.positionAt(2)).toEqual({ line: 1, column: 3 });
  });

  it('round-trips a position through an offset', () => {
    for (let offset = 0; offset <= KILN.text.length; offset++) {
      expect(KILN.offsetAt(KILN.positionAt(offset))).toBe(offset);
    }
  });

  it('clamps an offset outside the file rather than refusing to answer', () => {
    expect(KILN.positionAt(-10)).toEqual({ line: 1, column: 1 });
    expect(KILN.positionAt(KILN.text.length + 100)).toEqual(KILN.positionAt(KILN.text.length));
  });

  it('counts an empty file as one empty line', () => {
    const empty = new SourceFile('empty.sprout', '');
    expect(empty.lines).toBe(1);
    expect(empty.lineText(1)).toBe('');
    expect(empty.positionAt(0)).toEqual({ line: 1, column: 1 });
  });

  it('gives back a line without its newline, and nothing out of range', () => {
    expect(KILN.lineText(1)).toBe('object kiln: sprout.Fixture in yard {');
    expect(KILN.lineText(2)).toBe('  :door open');
    expect(KILN.lineText(0)).toBe('');
    expect(KILN.lineText(99)).toBe('');
  });

  it('drops a carriage return from a line of CRLF text', () => {
    const crlf = new SourceFile('crlf.sprout', 'one\r\ntwo\r\n');
    expect(crlf.lineText(1)).toBe('one');
    expect(crlf.positionAt(crlf.text.indexOf('two'))).toEqual({ line: 2, column: 1 });
  });
});

describe('a span points at the text it covers', () => {
  const at = KILN.text.indexOf(':door');
  const door: Span = KILN.span(at, at + ':door'.length);

  it('covers exactly its own text', () => expect(textOf(door)).toBe(':door'));

  it('reports the position of its start, not of its end', () => {
    expect(positionOf(door)).toEqual({ line: 2, column: 3 });
  });

  it('prints as file, line and column', () => expect(locationOf(door)).toBe('kiln.sprout:2:3'));

  it('orders and clamps the offsets it is given', () => {
    expect(KILN.span(10, 4)).toMatchObject({ start: 4, end: 10 });
    expect(KILN.span(-5, KILN.text.length + 5)).toMatchObject({
      start: 0,
      end: KILN.text.length,
    });
  });

  it('is empty when it covers nothing, and the end of a file is such a span', () => {
    expect(isEmptySpan(KILN.span(4, 4))).toBe(true);
    expect(isEmptySpan(door)).toBe(false);
    expect(isEmptySpan(KILN.endSpan)).toBe(true);
    expect(positionOf(KILN.endSpan)).toEqual(KILN.positionAt(KILN.text.length));
  });
});

describe('spanning joins the tokens a node was built from', () => {
  it('covers the first through the last', () => {
    const object = KILN.span(0, 6);
    const brace = KILN.span(KILN.text.indexOf('{'), KILN.text.indexOf('{') + 1);
    expect(textOf(spanning(object, brace))).toBe('object kiln: sprout.Fixture in yard {');
  });

  it('does not care which order it is given them in', () => {
    const a = KILN.span(0, 6);
    const b = KILN.span(20, 26);
    expect(spanning(b, a)).toEqual(spanning(a, b));
  });

  it('is the span itself when there is only one', () => {
    const one = KILN.span(0, 6);
    expect(spanning(one)).toEqual(one);
  });

  it('refuses to cross files, because that is a bug and not a bad world', () => {
    const other = new SourceFile('yard.sprout', 'object yard {}');
    expect(() => spanning(KILN.span(0, 1), other.span(0, 1))).toThrow(/cannot cross files/);
  });
});
