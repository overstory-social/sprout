import { describe, expect, it } from 'vitest';

import {
  writtenMember,
  type Declaration,
  type KindDeclaration,
  type ObjectDeclaration,
  type WorldDeclaration,
} from '../ast.js';
import { Diagnostics } from '../../source/diagnostics.js';
import { unspanned } from '../../source/nodes.js';
import { locationOf, SourceFile, textOf } from '../../source/source.js';
import { read } from '../../fixtures/parse.js';
import { body, composition, kindMembers } from './bodies.js';
import { DECLARATION_READERS } from './declarations.js';
import { Parser } from './parser.js';

/** A parser over some text, for calling one reader directly. */
function parserOver(text: string) {
  const diagnostics = new Diagnostics();
  const p = new Parser(new SourceFile('b.sprout', text), diagnostics, DECLARATION_READERS);
  return { p, diagnostics };
}

/**
 * Each thing that holds a body, opened as it is written: the three share
 * one reader, so every rule below is asserted of all three, in the words
 * each is named by.
 */
const OWNERS = [
  {
    noun: 'world',
    article: 'A world',
    name: 'w',
    open: 'world w: sprout.World',
    holds: 'visitors',
  },
  { noun: 'kind', article: 'A kind', name: 'K', open: 'kind K', holds: null },
  { noun: 'object', article: 'An object', name: 'o', open: 'object o: K in r', holds: null },
] as const;

/** The declaration a file's text opened with. */
const owned = (declarations: readonly Declaration[]) =>
  declarations.find(
    (d): d is WorldDeclaration | KindDeclaration | ObjectDeclaration =>
      d.kind === 'world' || d.kind === 'kind' || d.kind === 'object',
  );

describe('the kinds after the colon, read directly', () => {
  it('are none, and nothing is taken, where no colon follows', () => {
    const { p, diagnostics } = parserOver('{ }');
    expect(composition(p, 'kind')).toEqual([]);
    expect(p.peek().text).toBe('{');
    expect(diagnostics.refusals).toEqual([]);
  });

  it('are what was written, up to the first thing that is not one', () => {
    const { p } = parserOver(': Crate, sprout.Container in r');
    const composes = composition(p, 'object');
    expect(composes?.map((c) => textOf(c.at))).toEqual(['Crate', 'sprout.Container']);
    expect(p.peek().text).toBe('in');
  });

  it('are null, having said why, where one cannot be read', () => {
    const { p, diagnostics } = parserOver(': Crate, 4 { }');
    expect(composition(p, 'kind')).toBeNull();
    expect(diagnostics.refusals.map((d) => d.message)).toEqual([
      'the number 4 is not the name of a kind.',
    ]);
  });

  it('name their owner when a comma is missing, and show how it is written', () => {
    for (const [owner, remedy] of [
      ['world', 'Write `world <name>: one.Kind, Another { … }`.'],
      ['kind', 'Write `kind <Name>: one.Kind, Another { … }`.'],
      ['object', 'Write `object <name>: one.Kind, Another in <container> { … }`.'],
    ] as const) {
      const { p, diagnostics } = parserOver(': Crate Heavy {');
      expect(composition(p, owner)?.length, owner).toBe(2);
      expect(diagnostics.refusals.map((d) => d.remedy)).toEqual([remedy]);
    }
  });
});

describe('a body, read directly', () => {
  it('reads to its own brace and hands that brace back', () => {
    const { p, diagnostics } = parserOver('K { :open true\n contains } after');
    const name = p.next();
    p.next();
    const read = body(p, 'kind', name, kindMembers(p));
    expect(diagnostics.refusals).toEqual([]);
    expect(read?.members.map((m) => m.kind)).toEqual(['property', 'contains']);
    expect(read?.close.text).toBe('}');
    expect(p.peek().text).toBe('after');
  });

  it('is null, having said so under the name it was given, where it is never closed', () => {
    const { p, diagnostics } = parserOver('K { :open true');
    const name = p.next();
    p.next();
    expect(body(p, 'kind', name, kindMembers(p))).toBeNull();
    expect(diagnostics.refusals.map((d) => d.message)).toEqual(['`K` is never closed.']);
  });
});

describe('a world, a kind and an object read their bodies by one rule', () => {
  for (const owner of OWNERS) {
    const opened = (members: string) => read(`${owner.open} {\n  ${members}\n}\n`);

    it(`${owner.noun}: holds its properties, a \`:remembers\` and \`contains\``, () => {
      const { declarations, refusals } = opened(':a 1\n  :remembers [b: 2]\n  contains actors');
      expect(refusals).toEqual([]);
      expect(owned(declarations)!.members.map((m) => m.kind)).toEqual([
        'property',
        'remembers',
        'contains',
      ]);
    });

    it(`${owner.noun}: names itself and what it holds when a word is no member`, () => {
      const { declarations, refusals } = opened('nonsense\n  :a 1');
      const holds =
        owner.holds === null
          ? '`contains` and `without`'
          : `\`${owner.holds}\`, \`contains\` and \`without\``;
      expect(refusals.map((d) => [d.message, d.remedy])).toEqual([
        [`${owner.article} is not made of \`nonsense\`.`, `It holds its properties, ${holds}.`],
      ]);
      expect(owned(declarations)!.members.map((m) => m.kind)).toEqual(['property']);
    });

    it(`${owner.noun}: reads on past a member it could not read`, () => {
      // A list is stepped over whole, so `:wet` inside it is not a member.
      const { declarations, refusals } = opened(':a Zeta [oak, :wet]\n  :b Ward.Iron\n  :c 1');
      expect(refusals).toHaveLength(2);
      expect(
        owned(declarations)!.members.map((m) => (m.kind === 'property' ? m.name.text : m.kind)),
      ).toEqual(['c']);
    });

    it(`${owner.noun}: says it is never closed, in its own noun`, () => {
      const { refusals } = read(`${owner.open} {\n  :a 1\n`);
      expect(refusals.map((d) => [d.message, d.remedy])).toEqual([
        [`\`${owner.name}\` is never closed.`, `Add a } after what the ${owner.noun} is made of.`],
      ]);
    });

    it(`${owner.noun}: ends at a declaration written inside it, which is the file's`, () => {
      const { declarations, refusals } = opened('enum Inner { oak }');
      expect(refusals.map((d) => d.message)).toContain(`\`${owner.name}\` is never closed.`);
      expect(refusals.map((d) => d.message)).not.toContain(
        `${owner.article} is not made of \`enum\`.`,
      );
      expect(declarations.map((d) => d.name.text)).toContain('Inner');
    });
  }

  it('names every member written after a stray `}` that ends a kind too early', () => {
    // A brace count alone cannot tell a stray `}` from the kind's own,
    // so what follows it is named rather than lost the way stepping
    // straight to the next declaration would lose it — as `bodies.ts`
    // holds for a world, a kind and an object alike.
    const { declarations, refusals } = read(`kind K: sprout.Container {
  :alpha 0
  }
  :bravo 1
  contains actors
}
`);
    const kind = owned(declarations)!;
    expect(kind.members.map((m) => (m.kind === 'property' ? m.name.text : m.kind))).toEqual([
      'alpha',
    ]);
    expect(refusals.map((d) => [d.message, d.remedy])).toEqual([
      [
        '`bravo` and `contains` are written after the `}` that ends `K`.',
        'Everything `K` is made of goes inside its braces. Take out the `}` that ends it too early.',
      ],
    ]);
  });
});

describe('`without` names a member and the kind it comes from, in any body', () => {
  /** The `without` lines a body read, each as the member and kind it names. */
  const withouts = (declarations: readonly Declaration[]) =>
    owned(declarations)!.members.flatMap((m) =>
      m.kind === 'without' ? [`${writtenMember(m.member)} from ${textOf(m.source.at)}`] : [],
    );

  for (const owner of OWNERS) {
    it(`${owner.noun}: reads each member form the spec's table says every source of runs`, () => {
      const lines = [
        'without changed :lit from sprout.LightSource',
        'without on :stir from Bellows',
        'without depart from sprout.Fixture',
        'without release from Crate',
        'without accept from Crate',
        'without as target for unlock from Lock',
      ];
      const { declarations, refusals } = read(`${owner.open} {\n  ${lines.join('\n  ')}\n}\n`);
      expect(refusals).toEqual([]);
      expect(withouts(declarations)).toEqual(lines.map((line) => line.slice('without '.length)));
      const first = owned(declarations)!.members[0]!;
      expect(textOf(first.at)).toBe(lines[0]);
      expect(unspanned(declarations)).toEqual([]);
    });
  }

  /** Each refusal as its place, its words and its remedy, in a kind's body. */
  const said = (line: string) =>
    read(`kind K {\n  ${line}\n  :a 1\n}\n`, 'k.sprout').refusals.map((d) => [
      locationOf(d.at),
      d.message,
      d.remedy,
    ]);
  const EXAMPLE = '`without changed :lit from sprout.LightSource`';

  it('refuses one that names nothing, at the word, and reads the member after it', () => {
    const missing = [
      'k.sprout:2:3',
      '`without` does not say what to leave out.',
      `Name a handler, a hook, a guard or a role, and the kind it comes from: ${EXAMPLE}.`,
    ];
    expect(said('without')).toEqual([missing]);
    expect(said('without from Crate')).toEqual([missing]);
    const { declarations } = read('kind K {\n  without\n  :a 1\n}\n');
    expect(owned(declarations)!.members.map((m) => m.kind)).toEqual(['property']);
  });

  it('refuses a member that is none of the forms, at it, and does not read it as a member', () => {
    expect(said('without :x from Crate')).toEqual([
      [
        'k.sprout:2:11',
        '`without` names a handler, a hook, a guard or a role, not `:x`, which is a property or a message.',
        `A handler is written \`on :x\` and a hook \`changed :x\`, as in ${EXAMPLE}.`,
      ],
    ]);
    expect(said('without nonsense from Crate')).toEqual([
      [
        'k.sprout:2:11',
        '`without` names a handler, a hook, a guard or a role, not `nonsense`.',
        `Write one as it is declared: \`on :<message>\`, \`changed :<property>\`, \`depart\`, \`release\`, \`accept\` or \`as <role> for <verb>\`, as in ${EXAMPLE}.`,
      ],
    ]);
    const { declarations } = read('kind K {\n  without :x from Crate\n  :a 1\n}\n');
    expect(
      owned(declarations)!.members.map((m) => (m.kind === 'property' ? m.name.text : m.kind)),
    ).toEqual(['a']);
  });

  it('refuses a handler or a hook with no name, and a role with half of one', () => {
    expect(said('without on from Bellows')).toEqual([
      [
        'k.sprout:2:14',
        '`on` names the message a handler answers, with its colon.',
        'Write `without on :<message> from <Kind>`, as in `without on :stir from Bellows`.',
      ],
    ]);
    expect(said('without changed')).toEqual([
      [
        'k.sprout:2:18',
        '`changed` names the property a hook watches, with its colon.',
        `Write \`without changed :<property> from <Kind>\`, as in ${EXAMPLE}.`,
      ],
    ]);
    expect(said('without as target unlock from Lock')).toEqual([
      [
        'k.sprout:2:21',
        '`as` names a role and the verb it plays it for.',
        'Write `without as <role> for <verb> from <Kind>`, as in `without as target for unlock from Lock`.',
      ],
    ]);
  });

  it('refuses a member with no `from`, just after the member', () => {
    expect(said('without accept')).toEqual([
      [
        'k.sprout:2:17',
        '`without accept` does not say which kind it comes from.',
        `Write \`from\` and the kind that declares it: \`without accept from <Kind>\`, as in ${EXAMPLE}.`,
      ],
    ]);
  });

  it('refuses a `from` that names no kind, at what it names or just after it', () => {
    const remedy = `Name it as it is composed, with its capital: ${EXAMPLE}.`;
    expect(said('without accept from 4')).toEqual([
      ['k.sprout:2:23', 'After `from` comes the kind that declares `accept`.', remedy],
    ]);
    expect(said('without accept from')).toEqual([
      ['k.sprout:2:22', 'After `from` comes the kind that declares `accept`.', remedy],
    ]);
  });
});
