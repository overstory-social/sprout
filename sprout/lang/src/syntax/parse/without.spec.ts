import { describe, expect, it } from 'vitest';

import { writtenMember, type WithoutDeclaration } from '../ast.js';
import { unspanned } from '../../source/nodes.js';
import { locationOf, textOf } from '../../source/source.js';
import { atMember, inKindBody, parserOver, rest } from '../../fixtures/readers.js';
import { startsMemberOf } from './bodies.js';
import { guard } from './guards.js';
import { without } from './without.js';
import { worldMembers } from './world.js';

/** Each thing that holds a body, opened as it is written; an object sits inside a world's. */
const OWNERS = [
  { noun: 'world', open: 'world w is sprout.World', around: ['', ''] },
  { noun: 'kind', open: 'kind K', around: ['', ''] },
  { noun: 'object', open: 'object o is K', around: ['world w is sprout.World {\n', '}\n'] },
] as const;

/**
 * The `without`s written one after another from `at` in `text`, each
 * read by `without` where the body of a world, or else of a kind or an
 * object, holds it; what they left, and what was said.
 */
function withoutsAt(text: string, at: number, world = false) {
  const { p, diagnostics, startsMember } = atMember(text, at, 'K', { name: 'k.sprout' });
  const starts = world ? startsMemberOf(p, worldMembers(p, 'w')) : startsMember;
  const read: WithoutDeclaration[] = [];
  while (p.at('name', 'without')) {
    const one = without(p, starts);
    if (one !== null) read.push(one);
  }
  return { withouts: read, rest: rest(p), refusals: diagnostics.refusals };
}

/** The `without`s `members` starts with, in the body of `kind K`. */
function readWithouts(members: string) {
  const { p } = inKindBody(members, 'K');
  return withoutsAt(p.source.text, p.peek().at.start);
}

describe('`without`, read directly', () => {
  it('reads the member and the kind, and leaves what follows', () => {
    const { p, diagnostics } = parserOver('without on :stir from Bellows :a 1');
    const made = without(p, (token) => token.kind === 'symbol');
    expect(diagnostics.refusals).toEqual([]);
    expect(
      made === null ? null : `${writtenMember(made.member)} from ${textOf(made.source.at)}`,
    ).toBe('on :stir from Bellows');
    expect(p.peek().text).toBe('a');
  });
});

describe('`without` names a member and the kind it comes from, in any body', () => {
  /** Each `without` as the member and kind it names. */
  const named = (withouts: readonly WithoutDeclaration[]) =>
    withouts.map((m) => `${writtenMember(m.member)} from ${textOf(m.source.at)}`);

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
      const text = `${owner.around[0]}${owner.open} {\n  ${lines.join('\n  ')}\n}\n${owner.around[1]}`;
      const { withouts, rest, refusals } = withoutsAt(
        text,
        text.indexOf(lines[0]!),
        owner.noun === 'world',
      );
      expect(refusals).toEqual([]);
      expect(named(withouts)).toEqual(lines.map((line) => line.slice('without '.length)));
      expect(textOf(withouts[0]!.at)).toBe(lines[0]);
      expect(unspanned(withouts)).toEqual([]);
      expect(rest.startsWith('}\n')).toBe(true);
    });
  }

  /** Each refusal as its place, its words and its remedy, in a kind's body. */
  const said = (line: string) =>
    readWithouts(`${line}\n  :a 1`).refusals.map((d) => [locationOf(d.at), d.message, d.remedy]);
  const EXAMPLE = '`without changed :lit from sprout.LightSource`';

  it('refuses one that names nothing, at the word, and reads the member after it', () => {
    const missing = [
      'k.sprout:2:3',
      '`without` does not say what to leave out.',
      `Name a handler, a hook, a guard or a role, and the kind it comes from: ${EXAMPLE}.`,
    ];
    expect(said('without')).toEqual([missing]);
    expect(said('without from Crate')).toEqual([missing]);
    const { withouts, rest } = readWithouts('without\n  :a 1');
    expect(withouts).toEqual([]);
    expect(rest).toBe(':a 1\n}\n');
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
    // What is left of its line is the body's to step over; the member after it is untouched.
    const { withouts, rest } = readWithouts('without :x from Crate\n  :a 1');
    expect(withouts).toEqual([]);
    expect(rest.endsWith('\n  :a 1\n}\n')).toBe(true);
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
      const { withouts, rest } = readWithouts(`${line}\n  :a 1\n  contains`);
      expect(withouts, line).toEqual([]);
      expect(rest.endsWith('\n  :a 1\n  contains\n}\n'), line).toBe(true);
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
  /** A `without` and then the guard after it, each read by its own reader in `kind Crate`. */
  const readKind = (members: string) => {
    const { p, diagnostics, startsMember } = inKindBody(members);
    const read = [without(p, startsMember), guard(p, 'Crate', startsMember)];
    return {
      members: read.flatMap((one) => (one === null ? [] : [one.kind])),
      said: diagnostics.refusals.map((d) => d.message),
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
