import { describe, expect, it } from 'vitest';

import type { Declaration, KindDeclaration, ObjectDeclaration, WorldDeclaration } from '../ast.js';
import { Diagnostics } from '../../source/diagnostics.js';
import { SourceFile, textOf } from '../../source/source.js';
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
      const holds = owner.holds === null ? '`contains`' : `\`${owner.holds}\` and \`contains\``;
      expect(refusals.map((d) => [d.message, d.remedy])).toEqual([
        [`${owner.article} is not made of \`nonsense\`.`, `It holds its properties, and ${holds}.`],
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
});
