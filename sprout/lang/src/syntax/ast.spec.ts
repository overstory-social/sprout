import { describe, expect, it } from 'vitest';

import {
  GUARD_NAMES,
  writtenMember,
  type Declaration,
  type EnumDeclaration,
  type EnumOption,
  type GuardDeclaration,
  type Ident,
  type KindDeclaration,
  type PassageDeclaration,
} from './ast.js';
import type { VerbDeclaration } from './ast-verbs.js';
import { Diagnostics } from '../source/diagnostics.js';
import { isNode, nodesOf, unspanned } from '../source/nodes.js';
import { parseDeclarations } from './parse.js';
import { SourceFile, textOf } from '../source/source.js';

const source = new SourceFile('ward.sprout', 'enum Ward { oak, silver }\n');
const declarations = parseDeclarations(source, new Diagnostics());
const ward = declarations[0] as EnumDeclaration;

describe('every node in the tree keeps the rule nodes.ts holds', () => {
  it('carries a span, at every depth', () => expect(unspanned(declarations)).toEqual([]));

  it('is a node by the convention the walker recognises', () => {
    for (const node of nodesOf(declarations)) expect(isNode(node)).toBe(true);
  });

  it('is the nodes the enum is made of, parents before children', () => {
    expect([...nodesOf(declarations)].map((n) => n.kind)).toEqual([
      'enum',
      'ident',
      'option',
      'ident',
      'option',
      'ident',
    ]);
  });
});

describe('the shapes the union is made of', () => {
  it('names an enum by an Ident rather than a bare string, so a problem can point at it', () => {
    const name: Ident = ward.name;
    expect(name.kind).toBe('ident');
    expect(name.text).toBe('Ward');
    expect(name.at.source).toBe(source);
  });

  it('gives each option its own node, and its name a node inside that', () => {
    const [first] = ward.options as readonly EnumOption[];
    expect(first!.kind).toBe('option');
    expect(first!.name.kind).toBe('ident');
    expect(first!.name.text).toBe('oak');
    // An option is its name and nothing else today, so the two spans
    // cover the same word. They are separate fields because an option
    // will grow things a name does not have.
    expect(textOf(first!.at)).toBe('oak');
    expect(textOf(first!.name.at)).toBe('oak');
  });

  it('is narrowed by its `kind`, which is what every reader switches on', () => {
    const declared: Declaration = ward;
    if (declared.kind === 'enum') {
      expect(declared.options).toHaveLength(2);
    } else {
      expect.unreachable('the union has one member today and this is how it will grow');
    }
  });
});

describe('a member named by `without` is shown as it was written', () => {
  it('whatever the spacing it was written with', () => {
    const text = `kind K {
  without on   :stir from A
  without changed\n :lit from A
  without depart from A
  without as  target  for unlock from A
}`;
    const diagnostics = new Diagnostics();
    const [kind] = parseDeclarations(new SourceFile('k.sprout', text), diagnostics) as [
      KindDeclaration,
    ];
    expect(diagnostics.refusals).toEqual([]);
    expect(
      kind.members.flatMap((m) => (m.kind === 'without' ? [writtenMember(m.member)] : [])),
    ).toEqual(['on :stir', 'changed :lit', 'depart', 'as target for unlock']);
  });
});

describe('a passage is a member whose body is carried as written', () => {
  const text = 'kind Mirror {\n  passage greeting default { Hello, {actor}. }\n}';
  const diagnostics = new Diagnostics();
  const [mirror] = parseDeclarations(new SourceFile('m.sprout', text), diagnostics) as [
    KindDeclaration,
  ];

  it('keeps the node rule, its name and its body each a node of their own', () => {
    expect(diagnostics.refusals).toEqual([]);
    expect(unspanned(mirror)).toEqual([]);
    expect([...nodesOf(mirror.members)].map((n) => n.kind)).toEqual([
      'passage',
      'ident',
      'passage-body',
    ]);
  });

  it('is narrowed by its `kind`, to its name, whether it yields, and its words', () => {
    const [member] = mirror.members;
    if (member?.kind !== 'passage') return expect.unreachable('a passage was written');
    const passage: PassageDeclaration = member;
    expect(passage.name.text).toBe('greeting');
    expect(passage.yields).toBe(true);
    expect(passage.body.text).toBe(' Hello, {actor}. ');
    expect(textOf(passage.body.at)).toBe('{ Hello, {actor}. }');
    expect(textOf(passage.at)).toBe('passage greeting default { Hello, {actor}. }');
  });
});

describe('a guard is a member whose parameters and statements are nodes', () => {
  const text = 'kind Crate {\n  accept (item, from) { if (a) { refuse full } else { allow } }\n}';
  const diagnostics = new Diagnostics();
  const [crate] = parseDeclarations(new SourceFile('c.sprout', text), diagnostics) as [
    KindDeclaration,
  ];

  it('keeps the node rule down to each statement and each name', () => {
    expect(diagnostics.refusals).toEqual([]);
    expect(unspanned(crate)).toEqual([]);
    expect([...nodesOf(crate.members)].map((n) => n.kind)).toEqual([
      'guard',
      'ident',
      'ident',
      'block',
      'if',
      'binding',
      'ident',
      'block',
      'refuse',
      'ident',
      'block',
      'allow',
    ]);
  });

  it('is named by one of the three guards, in the order the engine asks them', () => {
    expect(GUARD_NAMES).toEqual(['depart', 'release', 'accept']);
    const [member] = crate.members;
    if (member?.kind !== 'guard') return expect.unreachable('a guard was written');
    const guard: GuardDeclaration = member;
    expect(guard.guard).toBe('accept');
    expect(textOf(guard.at)).toBe('accept (item, from) { if (a) { refuse full } else { allow } }');
  });
});

describe('a verb is its name, its roles and its phrases, each part a node', () => {
  const text =
    'verb work {\n  role target: Clay\n  role tools many\n  "work [target] with [tools]"\n}';
  const diagnostics = new Diagnostics();
  const [work] = parseDeclarations(new SourceFile('v.sprout', text), diagnostics) as [
    VerbDeclaration,
  ];

  it('keeps the node rule down to each slot and each modifier', () => {
    expect(diagnostics.refusals).toEqual([]);
    expect(unspanned(work)).toEqual([]);
    expect([...nodesOf(work)].map((n) => n.kind)).toEqual([
      'verb',
      'ident',
      'role',
      'ident',
      'kind-expr',
      'ident',
      'role',
      'ident',
      'role-modifier',
      'phrase',
      'phrase-words',
      'phrase-slot',
      'ident',
      'phrase-words',
      'phrase-slot',
      'ident',
    ]);
  });

  it('spans a role from its word to its last modifier, and a phrase over its quotes', () => {
    expect(work.roles.map((role) => textOf(role.at))).toEqual([
      'role target: Clay',
      'role tools many',
    ]);
    expect(textOf(work.phrases[0]!.at)).toBe('"work [target] with [tools]"');
  });
});
