// The invariant this folder guards — "a defect in one item never loses a
// well-formed neighbour in silence" — run over a `remembers` block built
// from its parts, with a fixed seed, and one defect placed in any part of
// any one entry. The block stands in a kind's body, since a stray `}`
// really does end it early and what follows is then the body's to read.

import { describe, expect, it } from 'vitest';

import type { Declaration } from '../../ast.js';
import { parseDeclarations } from '../../parse.js';
import { chooser } from '../../../fixtures/parse.js';
import {
  explained,
  generatedRemembers,
  memberNames,
  ownedBy,
  OWNERS,
  reading,
  tally,
  SORTS,
} from '../../../fixtures/recovery.js';

/** What the kind kept: an entry of its block, or a property of its own, by name. */
const keptIn = (declared: readonly Declaration[]): string[] =>
  declared
    .filter((d) => d.kind === 'kind')
    .flatMap((d) => d.members.flatMap(memberNames))
    .map((name) => name.replace(/^remembers\./, ''));

describe('a defect in one item never loses a well-formed neighbour in silence', () => {
  it('a list default before a colonless entry leaves that entry to the block', () => {
    // `faulty "x"` has no colon before its name: the entry before it,
    // `echo`, ends its own list default one token before the defect,
    // and `faulty` is the block's to refuse, not more of the list.
    const { result, said } = reading(
      'kind K {\n  remembers { :echo [oak] faulty "x" }\n  :a 1\n}',
      parseDeclarations,
    );
    const declared = ownedBy(OWNERS[1], result);
    expect(declared?.members.flatMap(memberNames)).toEqual(['remembers.echo', 'a']);
    expect(said.map((d) => d.message)).toEqual([
      'A `remembers` block holds properties, and `faulty` is not one.',
    ]);
  });

  it('an unclosed `remembers` block, directly before a word-led member, keeps both', () => {
    // No `}` of its own: the block ends where the body's next member
    // starts, so `contains` survives and the body still closes at its
    // own `}`, with what the block read kept.
    for (const owner of OWNERS) {
      const text = `${owner.open}\n  remembers { :echo 0\n  contains actors\n${owner.close}\n`;
      const { result, said } = reading(text, parseDeclarations);
      expect(ownedBy(owner, result)?.members.flatMap(memberNames), text).toEqual([
        'remembers.echo',
        'contains',
      ]);
      expect(
        said.map((d) => d.message),
        text,
      ).toEqual(['This `remembers` block is never closed.']);
    }
  });

  it('over generated `remembers` blocks, a defect in any part of any entry', () => {
    // An entry refused before the rest of it is read is stepped over
    // through its own brackets, the way a refused member is, so every
    // contained shape is held to the strong rule: nothing written is lost.
    const c = chooser(20_260_922);
    const reached = tally();
    for (let i = 0; i < 1000; i++) {
      const good = ['alpha', 'bravo', 'charlie', 'delta'].slice(0, c.below(5));
      const made = generatedRemembers(c, good);
      const text = `kind K {\n  ${made.text}\n}\n`;
      const { result, said, threw } = reading(text, parseDeclarations);
      expect(threw, text).toBeNull();
      reached.add(made.defect.sort);
      // A symbol written where a value goes, `:wet`, is an entry of its
      // own: a reading, and not something that appeared.
      const written = [...good, 'faulty', 'wet'];
      expect(explained(text, made.defect.sort, keptIn(result), good, written, said)).toEqual([]);
    }
    expect(reached.keys()).toEqual(SORTS);
  });
});
