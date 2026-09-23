// The invariant this folder guards — "a defect in one item never loses a
// well-formed neighbour in silence" — run over a `:remembers` built from
// its parts, with a fixed seed, and one defect placed in any part of any
// one entry.

import { describe, expect, it } from 'vitest';

import type { KindDeclaration } from '../../ast.js';
import { parseDeclarations, parseRemembers } from '../../parse.js';
import { chooser } from '../../../fixtures/parse.js';
import {
  explained,
  generatedRemembers,
  memberNames,
  reading,
  stoppedShort,
  tally,
  SORTS,
} from '../../../fixtures/recovery.js';

describe('a defect in one item never loses a well-formed neighbour in silence', () => {
  it('a list default before a colonless entry does not carry the `:remembers` closer past it', () => {
    // `faulty "x"` has no colon between its name and its value: the
    // entry immediately before it, `echo`, ends its own list default
    // one token before the defect, and the `]` that closes `:remembers`
    // must stay `:remembers`'s own rather than being read as the list
    // default's late close.
    const { result, said } = reading(
      'kind K {\n  :remembers [echo: [oak], faulty "x"]\n  :a 1\n}',
      parseDeclarations,
    );
    const declared = result?.find((d): d is KindDeclaration => d.kind === 'kind');
    expect(declared).toBeDefined();
    expect(declared?.members.flatMap(memberNames)).toEqual(['remembers.echo', 'a']);
    expect(said.map((d) => d.message)).toEqual([
      '`faulty` needs a colon between its name and its value.',
    ]);
  });

  it('over generated `:remembers`, a defect in any part of any entry', () => {
    // An entry refused before the rest of it is read is stepped over
    // through its own brackets, the way a refused member is, so every
    // shape here is held to the strong rule: nothing written is lost.
    const c = chooser(20_260_922);
    const reached = tally();
    for (let i = 0; i < 1000; i++) {
      const good = ['alpha', 'bravo', 'charlie', 'delta'].slice(0, c.below(5));
      const made = generatedRemembers(c, good);
      const { result, said, threw } = reading(made.text, parseRemembers);
      expect(threw, made.text).toBeNull();
      reached.add(made.defect.sort);
      expect(
        explained(
          made.text,
          made.defect.sort,
          result?.properties.map((p) => p.name.text) ?? [],
          good,
          [...good, 'faulty'],
          said,
          !stoppedShort(made.text, result),
        ),
      ).toEqual([]);
    }
    expect(reached.keys()).toEqual(SORTS);
  });
});
