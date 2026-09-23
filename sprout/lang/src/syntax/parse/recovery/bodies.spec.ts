// The invariant this folder guards — "a defect in one item never loses a
// well-formed neighbour in silence" — run over the body of a world, a
// kind and an object, built member by member with a fixed seed, and one
// defective member placed among well-formed ones, an object written in
// the body among them. Now and then the body is left never closed, so a
// declaration written after it is checked against `closedByWhatFollows`
// instead. An object sits in a world's body, so a stray `}` that closes
// it early leaves what follows to the world, which keeps it there.

import { describe, expect, it } from 'vitest';

import { parseDeclarations } from '../../parse.js';
import { chooser, type Chooser } from '../../../fixtures/parse.js';
import type { Declaration } from '../../ast.js';
import {
  aroundOwner,
  closedByWhatFollows,
  defectiveMember,
  explained,
  FOLLOWING,
  memberNames,
  ownedBy,
  reading,
  tally,
  wellFormed,
  WELL_FORMED_GUARDS,
  OWNERS,
  SORTS,
  type Owner,
} from '../../../fixtures/recovery.js';

/** What an owner's body kept: its members by name, and the objects in it as `object.<name>`. */
const keptBy = (owner: Owner, result: readonly Declaration[]): string[] => {
  const owned = ownedBy(owner, result);
  if (owned === undefined) return [];
  return [
    ...owned.members.flatMap(memberNames),
    ...owned.objects.map((object) => `object.${object.name.text}`),
  ];
};

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
      { names: ['object.echo'], text: () => 'object echo is Crate', worldOnly: false },
      {
        names: ['object.foxtrot'],
        text: () => 'object foxtrot is Crate {\n    :lit true\n    object inner is Crate\n  }',
        worldOnly: false,
      },
      { names: ['without'], text: () => 'without changed :lit from Lamp', worldOnly: false },
      ...WELL_FORMED_GUARDS.map(({ names, text }) => ({
        names,
        text: () => text,
        worldOnly: false,
      })),
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
        const text = `${owner.open}\n  ${lines.join('\n  ')}\n${owner.close}\n`;
        const { result, said, threw } = reading(text, parseDeclarations);
        expect(threw, text).toBeNull();
        // Not every `:remembers`-shaped defect holds a well-formed
        // `echo`: the one this run's own generator writes always does,
        // but an unclosed `:remembers` never reaches an entry of its own.
        const inRemembers = made.text.startsWith(':remembers') && made.text.includes('echo');
        reached.add(made.defect.sort);
        const good = members.flatMap((member) => member.names);
        if (inRemembers) good.push('remembers.echo');
        const kept = [
          ...keptBy(owner, result),
          ...(made.defect.sort === 'stray' ? aroundOwner(owner, result) : []),
        ];
        expect(
          explained(
            text,
            made.defect.sort,
            kept,
            good,
            // A symbol written where a value goes, `:wet` or `:stir`, is
            // a member of its own: a reading, and not something that
            // appeared.
            [
              ...good,
              'faulty',
              'remembers.faulty',
              'remembers.echo',
              'contains',
              'wet',
              'stir',
              // A guard with a defect inside its block is kept with what read.
              'depart',
              'release',
              'accept',
              // An object with a defect in its own head is kept with what read.
              'object.faulty',
            ],
            said,
          ),
        ).toEqual([]);
        // An unclosed list default or `:remembers`, with nothing of its
        // own to lose, is held to the strong rule beyond what `unclosed`
        // otherwise requires: the member written directly after it is
        // always kept, since the hunt for its close stops there rather
        // than reading past it.
        if (made.text === ':faulty [oak' || made.text.startsWith(':remembers [faulty: 0')) {
          const kept = keptBy(owner, result);
          if (at < members.length) {
            for (const name of (members[at] as { names: readonly string[] }).names) {
              expect(kept, text).toContain(name);
            }
          }
        }
      }
      expect(reached.keys(), owner.kind).toEqual([...SORTS, 'across', 'never closed'].sort());
    }
  });
});
