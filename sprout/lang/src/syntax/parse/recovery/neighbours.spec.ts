// The invariant this folder guards — "a defect in one item never loses a
// well-formed neighbour in silence" — over hand-picked defects beside
// hand-picked well-formed neighbours, one `it` per construct: a
// `:remembers`, the members of a world, a kind and an object, a list
// literal, and the declarations of a whole file. `recovery/*.spec.ts`
// runs the same invariant over generated input; this file is the
// shapes someone thought to write down.

import { describe, expect, it } from 'vitest';

import type { WorldMember } from '../../ast.js';
import { Diagnostics } from '../../../source/diagnostics.js';
import { parseDeclarations, parseProperty, parseRemembers } from '../../parse.js';
import { SourceFile } from '../../../source/source.js';
import { nothingVanishes, ownedBy, tooDeep, OWNERS } from '../../../fixtures/recovery.js';

describe('a defect in one item never loses a well-formed neighbour in silence', () => {
  const ENTRY_DEFECTS = [
    'Zeta: 0',
    '4: 0',
    'b 1',
    'b: Zeta',
    'b: 1.5',
    'b: %',
    'b: :wet',
    'b:',
    ': 0',
    'b: {}',
    'b: [oak silver]',
    'b: 0 min [1, 2]',
    'b: 0 min oak',
    'b: 0 min max 9',
    'b: 0 min 0 min 1',
    'b: 0 max 1.5',
    'b: Ward.',
    'b: Ward.Iron',
    'b: integer.3',
    'b: Ward.oak default silver',
    'b: 0 min',
    `b: ${tooDeep('oak')}`,
    `b: ${tooDeep('Ward')} default oak`,
    `b: [Ward] default [${Array.from({ length: 17 }, (_, i) => `e${i}`).join(',')}]`,
    'b: 0 min -[1]',
    'b: 0 max -[1, 2]',
    'b: 0 min -oak',
    'b: 0 min - max 9',
    'b: -[1]',
  ];

  // Not `enum`: it is a reserved word, but the parser reads `[oak, enum]`
  // as a list of two words and leaves `enum` to be refused where options
  // are checked against their enum, so there is no parse defect to find.
  const ELEMENT_DEFECTS = ['Zeta', '1.5', '%', ':a', '{', '}', tooDeep('oak')];
  const DECLARATION_DEFECTS = [
    'enum',
    'enum {',
    'message',
    'enum Ward {',
    `message :a with ${tooDeep('Ward')}`,
    '%',
    'enum Ward { oak oak }',
    // Worlds. The first two: a member word that also starts a
    // declaration, and a member whose value is a list that was never
    // closed. Either could take the declaration after it with it.
    'world w: sprout.World { enum Inner { oak } }',
    'world w: sprout.World { :x [ }',
    // Not `world w: sprout.World { }`: it PARSES, and what is wrong with
    // it — no visitor kind, nowhere to arrive — is `resolveVisitors`' and
    // `arrivalOf`'s to say.
    // A shape that is not a parse defect belongs in world.spec.ts.
    'world w: sprout.World { nonsense }',
    'world w: 4 { }',
    'world',
    'world w',
    'world w: sprout.World { visitors }',
    'world w: sprout.World { visitors are 4 }',
    // Kinds and objects: a name, a composition, a brace or a container
    // missing or wrong, a member no kind holds, a list never closed, a
    // declaration inside the body, and a world's own member in an
    // object's.
    'kind',
    'kind K',
    'kind K: 4 { }',
    'kind K { nonsense }',
    'kind K { :x [ }',
    'kind K { enum Inner { oak } }',
    'object',
    'object o: K { }',
    'object o: K in { }',
    'object o: K in r { visitors are X }',
    // A container's path: a dot left at its end, two in a row, a number
    // or a capital for a step, spaces around a dot; and the same where a
    // world says its visitors arrive.
    'object o: K in r.',
    'object o: K in r..s { }',
    'object o: K in r.4 { }',
    'object o: K in r.S',
    'object o: K in r . s',
    'world w: sprout.World { visitors arrive at y. }',
  ];

  it('over a `:remembers`, whichever side of the defect the good entries are', () => {
    let checked = 0;
    for (const defect of ENTRY_DEFECTS) {
      for (const [text, good] of [
        [`:remembers [alpha: 0, ${defect}]`, ['alpha']],
        [`:remembers [${defect}, omega: 1]`, ['omega']],
        [`:remembers [alpha: 0, ${defect}, omega: 1]`, ['alpha', 'omega']],
      ] as const) {
        checked += 1;
        const diagnostics = new Diagnostics();
        const remembered = parseRemembers(new SourceFile('k.sprout', text), diagnostics);
        expect(
          nothingVanishes(
            text,
            remembered?.properties.map((p) => p.name.text) ?? [],
            [...good],
            [...good, 'b'],
          ),
        ).toEqual([]);
        // And it is a defect at all — the net is worth nothing if the
        // shapes it walks are well formed.
        expect(diagnostics.refusals.length, `${text}: nothing was wrong with it`).toBeGreaterThan(
          0,
        );
      }
    }
    expect(checked).toBe(ENTRY_DEFECTS.length * 3);
  });

  it('over the members of a world, a kind and an object, in every order', () => {
    // The member-shaped defects: a member word with nothing it can read
    // after it, a member word followed by one that is no member, and a
    // word that is no member at all. Then the tables above as a world
    // writes them: an entry defect as a property where it has the shape
    // of one and inside a `:remembers` always, and an element defect
    // inside a list default.
    const MEMBER_DEFECTS = [
      'visitors are 4',
      'visitors arrive y',
      'visitors',
      'contains 4',
      'nonsense',
      '4',
      // A `without` with its member, its `from` or its kind missing or
      // wrong, each a line that would otherwise take the next member.
      'without',
      'without accept',
      'without accept from',
      'without accept from 4',
      'without nonsense from K',
      'without :x from K',
      'without changed',
      'without on :stir',
      'without as target',
      'without as target for',
      ...ENTRY_DEFECTS.filter((entry) => entry.startsWith('b:')).map(
        (entry) => `:b${entry.slice(2)}`,
      ),
      ...ENTRY_DEFECTS.map((entry) => `:remembers [${entry}]`),
      ...ELEMENT_DEFECTS.map((element) => `:b [Ward] default [oak, ${element}]`),
    ];
    // Symbols, and not `visitors …`: a property whose value is missing
    // reads the next word as its value, which is a reading and not a
    // loss, and a symbol can never be a value.
    const GOOD = [':alpha 0', ':remembers [omega: 1]'] as const;
    /** A member by what it would be looked up as. */
    const nameOf = (member: WorldMember): string =>
      member.kind === 'property'
        ? member.name.text
        : member.kind === 'remembers'
          ? `remembers:${member.properties.map((p) => p.name.text).join(',')}`
          : member.kind;
    let checked = 0;
    for (const owner of OWNERS) {
      for (const defect of MEMBER_DEFECTS) {
        for (const order of [
          [GOOD[0], defect, GOOD[1]],
          [GOOD[0], GOOD[1], defect],
          [defect, GOOD[0], GOOD[1]],
          [GOOD[1], defect, GOOD[0]],
          [GOOD[1], GOOD[0], defect],
          [defect, GOOD[1], GOOD[0]],
        ]) {
          checked += 1;
          const text = `${owner.open}\n  ${order.join('\n  ')}\n}\n`;
          const diagnostics = new Diagnostics();
          const declared = parseDeclarations(new SourceFile('k.sprout', text), diagnostics);
          // What the defect itself may leave standing: the `contains` a
          // `contains 4` did read, and a `:remembers` whose entry was refused.
          expect(
            nothingVanishes(
              text,
              ownedBy(owner, declared)?.members.map(nameOf) ?? [],
              ['alpha', 'remembers:omega'],
              ['alpha', 'remembers:omega', 'b', 'contains', 'remembers:', 'remembers:b'],
            ),
          ).toEqual([]);
          expect(diagnostics.refusals.length, `${text}: nothing was wrong with it`).toBeGreaterThan(
            0,
          );
        }
      }
    }
    expect(checked).toBe(OWNERS.length * MEMBER_DEFECTS.length * 6);
  });

  it('over a list literal', () => {
    for (const defect of ELEMENT_DEFECTS) {
      for (const [text, good] of [
        [`:x [Ward] default [oak, ${defect}]`, ['oak']],
        [`:x [Ward] default [${defect}, silver]`, ['silver']],
        [`:x [Ward] default [oak, ${defect}, silver]`, ['oak', 'silver']],
      ] as const) {
        const diagnostics = new Diagnostics();
        const declared = parseProperty(new SourceFile('k.sprout', text), diagnostics);
        // Only the options: an element that is not one has no name to go
        // missing, and rendering its kind would make this rule complain
        // about shapes rather than about losses.
        const written =
          declared?.default?.kind === 'list-literal'
            ? declared.default.elements.flatMap((e) =>
                e.kind === 'option-literal' ? [e.name.text] : [],
              )
            : [];
        expect(nothingVanishes(text, written, [...good], [...good, 'oak', 'silver'])).toEqual([]);
        expect(diagnostics.refusals.length, `${text}: nothing was wrong with it`).toBeGreaterThan(
          0,
        );
      }
    }
  });

  it('over the declarations of a whole file', () => {
    for (const defect of DECLARATION_DEFECTS) {
      for (const [text, good] of [
        [`enum Alpha { x }\n${defect}\n`, ['Alpha']],
        [`${defect}\nenum Omega { y }\n`, ['Omega']],
        [`enum Alpha { x }\n${defect}\nenum Omega { y }\n`, ['Alpha', 'Omega']],
      ] as const) {
        const diagnostics = new Diagnostics();
        const declared = parseDeclarations(new SourceFile('k.sprout', text), diagnostics);
        // A construct that was never closed gives its contents to the
        // file — `world w: sprout.World { enum Inner { oak } }` is a
        // world that ran on, and `Inner` is the file's enum. That is the
        // rule, and it keeps the author's work rather than skipping to a
        // brace and losing it. So a name WRITTEN inside the defect may
        // surface at the top level; a name that was never written
        // anywhere still may not. A world or an object whose defect is
        // in one member is kept, under its own name.
        const inside = [
          ...(defect.match(/[A-Z][A-Za-z_]*/g) ?? []),
          ...(defect.match(/^(?:world|object) (\w+)/)?.slice(1) ?? []),
        ];
        expect(
          nothingVanishes(
            text,
            declared.map((d) => d.name.text),
            [...good],
            [...good, 'Ward', ...inside],
          ),
        ).toEqual([]);
        expect(diagnostics.refusals.length, `${text}: nothing was wrong with it`).toBeGreaterThan(
          0,
        );
      }
    }
  });
});
