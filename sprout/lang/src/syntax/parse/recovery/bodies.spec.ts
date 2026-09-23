// The invariant this folder guards — "a defect in one item never loses a
// well-formed neighbour in silence" — run over the body of a world, a
// kind and an object, built member by member with a fixed seed, and one
// defective member placed among well-formed ones. Now and then the body
// is left never closed, so a declaration written after it is checked
// against `closedByWhatFollows` instead.

import { describe, expect, it } from 'vitest';

import type { WorldMember } from '../../ast.js';
import { parseDeclarations } from '../../parse.js';
import { chooser, type Chooser } from '../../../fixtures/parse.js';
import {
  closedByWhatFollows,
  defectiveMember,
  explained,
  FOLLOWING,
  ownedBy,
  reading,
  tally,
  wellFormed,
  OWNERS,
  SORTS,
} from '../../../fixtures/recovery.js';

/** A world member by what it would be looked up as, a `:remembers` by each entry. */
const memberNames = (member: WorldMember): string[] =>
  member.kind === 'property'
    ? [member.name.text]
    : member.kind === 'remembers'
      ? member.properties.map((p) => `remembers.${p.name.text}`)
      : [member.kind];

describe('a defect in one item never loses a well-formed neighbour in silence', () => {
  it('does not let a refused bound step into the next declaration’s own word', () => {
    // `max - -` fails at its bound and steps over what is left of it,
    // and that step must stop at `enum`, the next declaration's own
    // word — even though `Omega, name: [1]]` is a malformed header for
    // it. `enum` is a neighbour to name, not to eat.
    const text = 'kind K {\n  :faulty Ward.oak max - -\nenum Omega, name: [1]] { y }\n';
    const { said } = reading(text, parseDeclarations);
    expect(said.map((d) => d.message)).toContain('A max is a whole number.');
    expect(said.map((d) => d.message)).toContain('`K` is never closed.');
    expect(said.map((d) => d.message)).toContain('The options of `Omega` go in braces.');
  });

  it('over a generated body of a world, a kind and an object, a defect in any member', () => {
    const SYMBOL_LED = [
      { names: ['alpha'], text: (ch: Chooser) => wellFormed(ch, 'alpha', 'member') },
      { names: ['bravo'], text: (ch: Chooser) => wellFormed(ch, 'bravo', 'member') },
      {
        names: ['remembers.charlie', 'remembers.delta'],
        text: (ch: Chooser) =>
          `:remembers [${wellFormed(ch, 'charlie', 'entry')}, ${wellFormed(ch, 'delta', 'entry')}]`,
      },
    ];
    const WORD_LED = [
      { names: ['visitors-are'], text: () => 'visitors are P', worldOnly: true },
      { names: ['visitors-arrive-at'], text: () => 'visitors arrive at y', worldOnly: true },
      { names: ['contains'], text: () => 'contains actors', worldOnly: false },
      { names: ['without'], text: () => 'without changed :lit from Lamp', worldOnly: false },
    ];
    for (const [n, owner] of OWNERS.entries()) {
      const c = chooser(20_260_925 + n);
      const reached = tally();
      const wordLed = WORD_LED.filter((member) => owner.kind === 'world' || !member.worldOnly);
      for (let i = 0; i < 800; i++) {
        const members = c.shuffled([
          ...SYMBOL_LED.filter(() => c.below(3) !== 0),
          ...wordLed.filter(() => c.below(2) === 0),
        ]);
        // A property whose value is missing reads the next word as its
        // value, which is a reading and not a loss, so a member that
        // starts with a word never comes straight after the defect.
        let at = c.below(members.length + 1);
        while (at < members.length && wordLed.includes(members[at] as (typeof WORD_LED)[number])) {
          at += 1;
        }
        const made = defectiveMember(c);
        const lines = members.map((member) => member.text(c));
        lines.splice(at, 0, made.text);
        // Now and then the world is never closed, and a declaration
        // follows it, with a `:remembers` last in the body or not. Not
        // after a brace in the defect, which would close it, nor an
        // unclosed bracket, which takes what follows as far as a closer
        // turns up.
        const crossable = made.defect.sort !== 'unclosed' && !made.text.includes('}');
        const following = crossable && c.below(4) === 0 ? c.one(FOLLOWING) : null;
        if (following !== null) {
          // Whether a `:remembers` closes the body last is drawn only
          // where the defect is not already the line right before
          // `following`: there, standing directly against it is the
          // shape this run is for, since a value missing exactly where
          // `following`'s word stands is refused by the property reader
          // before it can be taken for a bare option.
          const remembersLast = at < members.length && c.below(2) === 0;
          if (remembersLast) lines.push(':remembers [zulu: 0]');
          const text = `${owner.open}\n  ${lines.join('\n  ')}\n${following.text}\n`;
          const { result, said, threw } = reading(text, parseDeclarations);
          expect(threw, text).toBeNull();
          reached.add(remembersLast && !following.wellFormed ? 'across' : 'never closed');
          expect(closedByWhatFollows(text, owner.name, following, result, said)).toEqual([]);
          continue;
        }
        const text = `${owner.open}\n  ${lines.join('\n  ')}\n}\n`;
        const { result, said, threw } = reading(text, parseDeclarations);
        expect(threw, text).toBeNull();
        const inRemembers = made.text.startsWith(':remembers');
        reached.add(made.defect.sort);
        const good = members.flatMap((member) => member.names);
        if (inRemembers) good.push('remembers.echo');
        expect(
          explained(
            text,
            made.defect.sort,
            ownedBy(owner, result)?.members.flatMap(memberNames) ?? [],
            good,
            // A symbol written where a value goes, `:wet` or `:stir`, is
            // a member of its own: a reading, and not something that
            // appeared.
            [...good, 'faulty', 'remembers.faulty', 'remembers.echo', 'contains', 'wet', 'stir'],
            said,
          ),
        ).toEqual([]);
      }
      expect(reached.keys(), owner.kind).toEqual([...SORTS, 'across', 'never closed'].sort());
    }
  });
});
