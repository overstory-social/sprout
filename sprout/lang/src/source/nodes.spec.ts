import { describe, expect, it } from 'vitest';

import { isNode, isSpan, isSpanned, nodesOf, unspanned, type Node } from './nodes.js';
import { SourceFile, type Span } from './source.js';

const FILE = new SourceFile(
  'kiln.sprout',
  'object kiln is sprout.Fixture in yard {\n  :door open\n}\n',
);
const at = (start: number, end: number): Span => FILE.span(start, end);

/** A tree shaped the way the compiler's are: a `kind` and an `at` on every node. */
const tree: Node = {
  kind: 'object',
  at: at(0, FILE.text.length),
  name: 'kiln',
  members: [
    { kind: 'property', at: at(40, 45), name: 'door', value: { kind: 'symbol', at: at(46, 50) } },
  ],
} as Node;

describe('what counts as a node', () => {
  it('is a plain object with a string kind', () => {
    expect(isNode({ kind: 'object', at: at(0, 1) })).toBe(true);
    expect(isNode({ name: 'kiln', at: at(0, 1) })).toBe(false);
    expect(isNode({ kind: 7, at: at(0, 1) })).toBe(false);
    expect(isNode('object')).toBe(false);
    expect(isNode(null)).toBe(false);
    expect(isNode([{ kind: 'object', at: at(0, 1) }])).toBe(false);
  });

  it('is not a class instance, so a SourceFile is never walked into', () => {
    expect(isNode(FILE)).toBe(false);
  });
});

describe('what counts as a span', () => {
  it('is a file and two offsets inside it', () => {
    expect(isSpan(at(0, 4))).toBe(true);
    expect(isSpan({ source: FILE, start: 4, end: 0 })).toBe(false);
    expect(isSpan({ source: FILE, start: -1, end: 4 })).toBe(false);
    expect(isSpan({ source: FILE, start: 0, end: FILE.text.length + 1 })).toBe(false);
    expect(isSpan({ source: 'kiln.sprout', start: 0, end: 4 })).toBe(false);
    expect(isSpan({ start: 0, end: 4 })).toBe(false);
    expect(isSpan(undefined)).toBe(false);
  });

  it('carried on `at` is what makes a value spanned', () => {
    expect(isSpanned({ at: at(0, 4) })).toBe(true);
    expect(isSpanned({ at: { line: 1, column: 1 } })).toBe(false);
    expect(isSpanned({})).toBe(false);
  });
});

describe('nodesOf walks a tree, parents before children', () => {
  it('finds every node once, in the order it is written', () => {
    expect([...nodesOf(tree)].map((n) => n.kind)).toEqual(['object', 'property', 'symbol']);
  });

  it('walks into arrays and into a bare list of trees', () => {
    expect([...nodesOf([tree, tree])].map((n) => n.kind)).toEqual(['object', 'property', 'symbol']);
  });

  it('does not walk into the span itself', () => {
    expect([...nodesOf({ kind: 'object', at: at(0, 4) })]).toHaveLength(1);
  });
});

describe('unspanned holds the rule that every node carries a span', () => {
  it('says nothing about a tree that keeps it', () => {
    expect(unspanned(tree)).toEqual([]);
  });

  it('names the node that broke it, by where it sits', () => {
    const broken = {
      kind: 'object',
      at: at(0, 4),
      members: [{ kind: 'property', name: 'door' }],
    };
    expect(unspanned(broken)).toEqual(['members[0]']);
  });

  it('names a node at the root of the walk as the empty path', () => {
    expect(unspanned({ kind: 'object' })).toEqual(['']);
  });

  it('catches a span that is a line and column pair rather than a real span', () => {
    const wrong = { kind: 'object', at: { line: 1, column: 1 } };
    expect(unspanned(wrong)).toEqual(['']);
  });

  it('catches a span whose offsets fall outside the file it names', () => {
    const wrong = { kind: 'object', at: { source: FILE, start: 0, end: 10_000 } };
    expect(unspanned(wrong)).toEqual(['']);
  });

  it('finds every offender, not the first', () => {
    const broken = {
      kind: 'world',
      at: at(0, 4),
      members: [{ kind: 'a' }, { kind: 'b', at: at(0, 1) }, { kind: 'c' }],
    };
    expect(unspanned(broken)).toEqual(['members[0]', 'members[2]']);
  });

  it('ignores what is not a node at all', () => {
    expect(unspanned({ name: 'kiln', options: ['raw', 'dry'], open: false })).toEqual([]);
    expect(unspanned(null)).toEqual([]);
    expect(unspanned('object kiln')).toEqual([]);
  });

  it('terminates on a tree that refers to itself', () => {
    const loop: Record<string, unknown> = { kind: 'object', at: at(0, 4) };
    loop.self = loop;
    expect(unspanned(loop)).toEqual([]);
  });
});
