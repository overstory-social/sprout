import { describe, expect, it } from 'vitest';

import type { SayStatement, TellStatement, TextStatement } from './ast-speech.js';
import { Diagnostics } from '../source/diagnostics.js';
import { nodesOf, unspanned } from '../source/nodes.js';
import { parseStatement } from './parse.js';
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
