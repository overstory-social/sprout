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
import { DECLARATION_READERS } from './declarations.js';
import { Parser } from './parser.js';
import { without } from './without.js';

/** Each thing that holds a body, opened as it is written; an object sits inside a world's. */
const OWNERS = [
  { noun: 'world', open: 'world w is sprout.World', around: ['', ''] },
  { noun: 'kind', open: 'kind K', around: ['', ''] },
  { noun: 'object', open: 'object o is K', around: ['world w is sprout.World {\n', '}\n'] },
] as const;
type Owner = (typeof OWNERS)[number];

/** The declaration a file's text opened with, or, for the object owner, the object in the world. */
const ownedIn = (declarations: readonly Declaration[], owner?: Owner) => {
  const top = declarations.find(
    (d): d is WorldDeclaration | KindDeclaration => d.kind === 'world' || d.kind === 'kind',
  );
  return owner?.noun === 'object' ? (top?.objects[0] as ObjectDeclaration | undefined) : top;
};
const owned = (declarations: readonly Declaration[]) => ownedIn(declarations);

describe('`without`, read directly', () => {
  it('reads the member and the kind, and leaves what follows', () => {
    const diagnostics = new Diagnostics();
    const p = new Parser(
      new SourceFile('w.sprout', 'without on :stir from Bellows :a 1'),
      diagnostics,
      DECLARATION_READERS,
    );
    const made = without(p, (token) => token.kind === 'symbol');
    expect(diagnostics.refusals).toEqual([]);
    expect(
      made === null ? null : `${writtenMember(made.member)} from ${textOf(made.source.at)}`,
    ).toBe('on :stir from Bellows');
    expect(p.peek().text).toBe('a');
  });
});

describe('`without` names a member and the kind it comes from, in any body', () => {
  /** The `without` lines a body read, each as the member and kind it names. */
  const withouts = (declarations: readonly Declaration[], owner?: Owner) =>
    ownedIn(declarations, owner)!.members.flatMap((m) =>
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
      const { declarations, refusals } = read(
        `${owner.around[0]}${owner.open} {\n  ${lines.join('\n  ')}\n}\n${owner.around[1]}`,
      );
      expect(refusals).toEqual([]);
      expect(withouts(declarations, owner)).toEqual(
        lines.map((line) => line.slice('without '.length)),
      );
      const first = ownedIn(declarations, owner)!.members[0]!;
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

  it('refuses a passage, at the word, since writing one replaces it, and reads on', () => {
    const remedy = (name: string) =>
      `Write your own \`passage ${name} { … }\` in this body instead: a body's own passage is the one that applies.`;
    const message = '`without` does not leave out a passage.';
    expect(said('without passage immovable from sprout.Fixture')).toEqual([
      ['k.sprout:2:11', message, remedy('immovable')],
    ]);
    expect(said('without passage immovable { It stays. }')).toEqual([
      ['k.sprout:2:11', message, remedy('immovable')],
    ]);
    expect(said('without passage from sprout.Fixture')).toEqual([
      ['k.sprout:2:11', message, remedy('<name>')],
    ]);
    for (const line of ['without passage immovable', 'without passage immovable { It stays. }']) {
      const { declarations } = read(`kind K {\n  ${line}\n  :a 1\n  contains\n}\n`);
      expect(
        owned(declarations)!.members.map((m) => m.kind),
        line,
      ).toEqual(['property', 'contains']);
    }
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

describe('`without` beside a guard', () => {
  /** A kind's body, its members by kind, and what was said. */
  const readKind = (members: string) => {
    const { declarations, refusals } = read(`kind Crate {\n  ${members}\n}\n`, 'k.sprout');
    const kind = declarations[0] as KindDeclaration;
    return {
      members: kind.members.map((m) => m.kind),
      said: refusals.map((d) => d.message),
    };
  };

  it('names a guard by its word, and leaves a guard written after it alone', () => {
    expect(readKind('without depart from Fixture\n  depart (to) { allow }')).toEqual({
      members: ['without', 'guard'],
      said: [],
    });
  });

  it('with nothing named, does not take the guard written after it for what it leaves out', () => {
    expect(readKind('without\n  depart (to) { allow }')).toEqual({
      members: ['guard'],
      said: ['`without` does not say what to leave out.'],
    });
  });
});
