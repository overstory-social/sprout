// The invariant this folder guards — "a defect in one item never loses a
// well-formed neighbour in silence" — run over a whole file: a shuffled
// set of well-formed declarations with one defective one dropped in
// among them, with a fixed seed. Every defect here is held to the strong
// rule, the unclosed and the stray ones too: at the top of a file, the
// word that starts the next declaration is where recovery stops,
// whatever bracket is open.

import { describe, expect, it } from 'vitest';

import { parseDeclarations } from '../../parse.js';
import { chooser } from '../../../fixtures/parse.js';
import {
  closedByWhatFollows,
  defectiveMember,
  explained,
  FOLLOWING,
  reading,
  tally,
  tooDeep,
} from '../../../fixtures/recovery.js';

describe('a defect in one item never loses a well-formed neighbour in silence', () => {
  it('over a generated file, a defect in any part of any declaration', () => {
    const c = chooser(20_260_926);
    const option = c.one;
    const reached = tally();
    const DECLARED = [
      { name: 'Alpha', text: () => 'enum Alpha { oak, silver }' },
      { name: 'Bravo', text: () => 'enum Bravo { iron }' },
      { name: 'golf', text: () => option(['message :golf', 'message :golf with [Ward]']) },
      { name: 'hotel', text: () => option(['message :hotel with boolean', 'message :hotel']) },
      {
        name: 'india',
        text: () => 'world india: sprout.World {\n  visitors are P\n  visitors arrive at y\n}',
      },
      {
        name: 'Juliet',
        text: () =>
          option(['kind Juliet { }', 'kind Juliet: Crate, sprout.Container {\n  :open true\n}']),
      },
      {
        name: 'kilo',
        text: () =>
          option([
            'object kilo: Juliet in yard',
            'object kilo: Juliet in yard {\n  contains\n}',
            'object kilo: Juliet in yard.shed.shelf',
          ]),
      },
    ];
    // A world never closed, holding a `:remembers` or not; whatever
    // follows it, in the file or here, is a declaration of its own.
    const unclosedWorld = (): string =>
      `world faulty: sprout.World {\n  ${option(['visitors are P', 'visitors are P\n  :remembers [a: 0]', ':remembers [a: 0]'])}`;
    const DEFECTIVE: readonly (() => string)[] = [
      // An enum: its name, its braces, one option, or a comma.
      () => `enum ${option(['faulty', '', '4', 'Faulty.'])} { oak }`,
      () => 'enum Faulty oak, silver }',
      () => 'enum Faulty { oak, silver',
      () => {
        const bad = option([
          'Zeta',
          'enum',
          'message',
          'world',
          'kind',
          'object',
          'in',
          'without',
          'from',
          'integer',
          '4',
          ':a',
          '%',
          '"x"',
        ]);
        return `enum Faulty { oak, ${bad}, silver }`;
      },
      () => `enum Faulty { oak${option([' ', ', ,'])} silver }`,
      () => 'enum Faulty { oak, ], silver }',
      () => 'enum Faulty { oak, [, silver }',
      // A message: its name, or what it carries.
      () => option(['message', 'message faulty', 'message :faulty boolean']),
      () => {
        const carried = option(['', '4', 'sprout.', tooDeep('Ward'), '[Ward, oak]', '%', '[Ward']);
        return `message :faulty with ${carried}`;
      },
      // A world: its name, what it is composed from, a brace, a member.
      () => option(['world faulty: 4 { }', 'world faulty', 'world: sprout.World']),
      () =>
        `world faulty: sprout.World {\n  visitors arrive at ${option(['yard.', 'yard..shed', 'yard.4', 'yard . shed'])}\n}`,
      unclosedWorld,
      () => `world faulty: sprout.World {\n  visitors are P\n  ${defectiveMember(c).text}\n}`,
      // A kind: its name, what it composes, its braces, a member.
      () =>
        option([
          'kind',
          'kind faulty { }',
          'kind: Crate { }',
          'kind Faulty',
          'kind Faulty: 4 { }',
          'kind Faulty: Crate Fixture { }',
        ]),
      () => `kind Faulty: sprout.Container {\n  ${defectiveMember(c).text}\n}`,
      // An object: its name, what it composes, its container, a member.
      () =>
        option([
          'object',
          'object Faulty: Crate in yard',
          'object faulty: 4 in yard',
          'object faulty: Crate',
          'object faulty: Crate { }',
          'object faulty: Crate in { }',
          'object faulty: Crate in Yard',
          'object faulty: Crate in yard.',
          'object faulty: Crate in yard..shed',
          'object faulty: Crate in yard.4 { }',
          'object faulty: Crate in yard.Shed',
          'object faulty: Crate in yard . shed { contains }',
        ]),
      () => `object faulty: Crate in yard {\n  ${defectiveMember(c).text}\n}`,
    ];
    const used = new Set<number>();
    for (let i = 0; i < 700; i++) {
      const declared = c.shuffled(DECLARED).slice(0, c.below(DECLARED.length + 1));
      const which = c.below(DEFECTIVE.length);
      used.add(which);
      const unclosed = DEFECTIVE[which] === unclosedWorld;
      // After a world never closed, now and then a declaration whose own
      // header reads like the entries of a `:remembers`.
      const following =
        unclosed && c.below(2) === 0 ? c.one(FOLLOWING.filter((f) => !f.wellFormed)) : null;
      const defect = `${DEFECTIVE[which]!()}${following === null ? '' : `\n${following.text}`}`;
      const blocks = declared.map((d) => d.text());
      blocks.splice(c.below(blocks.length + 1), 0, defect);
      const text = `${blocks.join('\n')}\n`;
      const { result, said, threw } = reading(text, parseDeclarations);
      expect(threw, text).toBeNull();
      // What a construct never closed gives the file was written inside
      // it, so a capitalised word or a world's name written in the defect
      // may surface; a name written nowhere may not.
      const inside = [
        ...(defect.match(/[A-Z][A-Za-z_]*/g) ?? []),
        ...(defect.match(/world (\w+)/)?.slice(1) ?? []),
      ];
      const good = declared.map((d) => d.name);
      expect(
        explained(
          text,
          'contained',
          result.map((d) => d.name.text),
          good,
          [...good, 'faulty', 'Faulty', ...inside],
          said,
        ),
      ).toEqual([]);
      if (unclosed) {
        reached.add(
          following !== null && defect.includes(':remembers') ? 'across' : 'unclosed world',
        );
        expect(
          said.some((d) => d.message === '`faulty` is never closed.'),
          `${text}\n  nothing says \`faulty\` is never closed`,
        ).toBe(true);
      }
      if (following !== null) {
        expect(closedByWhatFollows(text, 'faulty', following, result, said)).toEqual([]);
      }
    }
    expect(used.size).toBe(DEFECTIVE.length);
    expect(reached.keys()).toEqual(['across', 'unclosed world']);
  });
});
