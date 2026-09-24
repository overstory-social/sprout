import { describe, expect, it } from 'vitest';

import {
  describeWord,
  type DescribeDeclaration,
  type SayStatement,
  type TellStatement,
  type TextStatement,
} from './ast-speech.js';
import type { KindDeclaration } from './ast.js';
import { Diagnostics } from '../source/diagnostics.js';
import { nodesOf, unspanned } from '../source/nodes.js';
import { parseDeclarations, parseStatement } from './parse.js';
import { SourceFile, textOf } from '../source/source.js';

describe('the nodes of words for a reader keep the rule every node keeps', () => {
  const read = (text: string) => {
    const diagnostics = new Diagnostics();
    const statement = parseStatement(new SourceFile('s.sprout', text), diagnostics);
    expect(diagnostics.all, text).toEqual([]);
    return statement as SayStatement | TellStatement | TextStatement;
  };

  it('spans every node, and names each part by its kind', () => {
    const said = [
      read('say "You pull {target}."'),
      read('tell kiln.shelf pulled'),
      read('text greeting'),
    ];
    expect(unspanned(said)).toEqual([]);
    expect(said.map((statement) => statement.kind)).toEqual(['say', 'tell', 'text']);
    const kinds = new Set([...nodesOf(said)].map((node) => node.kind));
    for (const kind of ['prose-literal', 'prose-slot', 'path', 'ident']) {
      expect(kinds.has(kind), kind).toBe(true);
    }
  });

  it('keeps who is told as the path written, and none for the place', () => {
    const told = read('tell kiln.shelf pulled') as TellStatement;
    expect(textOf(told.to!.at)).toBe('kiln.shelf');
    expect((read('tell pulled') as TellStatement).to).toBeNull();
  });
});

describe('a describe’s node', () => {
  const kindOf = (text: string): KindDeclaration => {
    const diagnostics = new Diagnostics();
    const [kind] = parseDeclarations(new SourceFile('k.sprout', text), diagnostics);
    expect(diagnostics.all, text).toEqual([]);
    return kind as KindDeclaration;
  };

  it('spans its word and its block, and every node inside', () => {
    const kind = kindOf('kind Lamp { describe { if (true) { text greeting } } }');
    const described = kind.members[0] as DescribeDeclaration;
    expect(described.kind).toBe('describe');
    expect(unspanned([described])).toEqual([]);
    expect(textOf(described.at)).toBe('describe { if (true) { text greeting } }');
    expect(described.body.kind).toBe('block');
  });

  it('names its own word as where a diagnostic about the whole of it points', () => {
    const kind = kindOf('kind Lamp {\n  describe { text "A lamp." }\n}');
    expect(textOf(describeWord(kind.members[0] as DescribeDeclaration))).toBe('describe');
  });
});
