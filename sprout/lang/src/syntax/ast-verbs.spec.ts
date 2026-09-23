import { describe, expect, it } from 'vitest';

import type { VerbDeclaration } from './ast-verbs.js';
import { Diagnostics } from '../source/diagnostics.js';
import { nodesOf, unspanned } from '../source/nodes.js';
import { parseDeclarations } from './parse.js';
import { SourceFile, textOf } from '../source/source.js';

describe('a verb’s nodes keep the rule every node keeps', () => {
  const diagnostics = new Diagnostics();
  const [verb] = parseDeclarations(
    new SourceFile(
      'v.sprout',
      'verb unlock { role target: Lockable  role tool optional  role topic: symbol  "unlock [target] with [tool]" }\n',
    ),
    diagnostics,
  ) as [VerbDeclaration];

  it('reads clean, and every node carries a span', () => {
    expect(diagnostics.all).toEqual([]);
    expect(unspanned([verb])).toEqual([]);
  });

  it('names each part by its kind, spanned at what was written', () => {
    const kinds = new Set([...nodesOf([verb])].map((node) => node.kind));
    for (const kind of ['verb', 'role', 'value-filler', 'role-modifier', 'phrase', 'phrase-slot']) {
      expect(kinds.has(kind), kind).toBe(true);
    }
    expect(verb.roles.map((role) => textOf(role.at))).toEqual([
      'role target: Lockable',
      'role tool optional',
      'role topic: symbol',
    ]);
  });
});
