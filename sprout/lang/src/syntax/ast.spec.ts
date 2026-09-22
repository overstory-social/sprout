import { describe, expect, it } from 'vitest';

import {
  writtenMember,
  type Declaration,
  type EnumDeclaration,
  type EnumOption,
  type Ident,
  type KindDeclaration,
} from './ast.js';
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
