import { describe, expect, it } from 'vitest';

import { unspanned } from '../source/nodes.js';
import { textOf } from '../source/source.js';
import { readProseText } from '../fixtures/parse.js';
import { isLoopVariable, LOOP_VARIABLES, type ProsePiece } from './ast-prose.js';

describe('prose is nodes, each spanned where it was written', () => {
  const { prose, refusals } = readProseText(
    'A {thing}.\n\n{if $x}yes{else if y}no{else}maybe{/if}\\n{for t: sprout.Place in self}{t}{/for}',
  );

  it('keeps the node rule all the way down', () => {
    expect(refusals).toEqual([]);
    expect(unspanned(prose)).toEqual([]);
  });

  it('holds words, breaks, slots and blocks as pieces of their own kinds, in order', () => {
    expect(prose.pieces.map((piece: ProsePiece) => piece.kind)).toEqual([
      'prose-words',
      'prose-slot',
      'prose-words',
      'prose-paragraph',
      'prose-if',
      'prose-newline',
      'prose-for',
    ]);
    const [, slot, , , branch, , walk] = prose.pieces;
    expect(textOf(slot!.at)).toBe('{thing}');
    expect(textOf(branch!.at)).toBe('{if $x}yes{else if y}no{else}maybe{/if}');
    expect(textOf(walk!.at)).toBe('{for t: sprout.Place in self}{t}{/for}');
  });

  it('chains `{else if}` as the `{if}` in `otherwise`, and ends with the `{else}` as prose', () => {
    const branch = prose.pieces[4];
    if (branch?.kind !== 'prose-if') return expect.unreachable('an `{if}` was written');
    const chained = branch.otherwise;
    if (chained?.kind !== 'prose-if') return expect.unreachable('an `{else if}` was written');
    expect(chained.otherwise?.kind).toBe('prose');
  });
});

describe('the loop’s own names', () => {
  it('are four, and are a loop’s alone', () => {
    expect(Object.keys(LOOP_VARIABLES)).toEqual(['$first', '$last', '$index', '$count']);
    for (const name of Object.keys(LOOP_VARIABLES)) expect(isLoopVariable(name)).toBe(true);
    for (const name of ['first', '$firsts', 'toString', '$'])
      expect(isLoopVariable(name)).toBe(false);
  });

  it('are true or false for where the walk is, and numbers for how far', () => {
    expect(LOOP_VARIABLES).toEqual({
      $first: 'boolean',
      $last: 'boolean',
      $index: 'integer',
      $count: 'integer',
    });
  });
});
