import { describe, expect, it } from 'vitest';

import type { KindDeclaration } from '../syntax/ast.js';
import { Diagnostics } from '../source/diagnostics.js';
import { locationOf, SourceFile } from '../source/source.js';
import { parseDeclarations } from '../syntax/parse.js';
import { composeDescribe, ownDescribe } from './describe.js';
import { EnumTable } from './enums.js';
import { KindTable, type KindRef } from './kinds.js';

function composed(text: string) {
  const diagnostics = new Diagnostics();
  const declared = parseDeclarations(new SourceFile('k.sprout', text), diagnostics);
  const kinds = new KindTable();
  kinds.add(
    'shop',
    declared.filter((d): d is KindDeclaration => d.kind === 'kind'),
    diagnostics,
  );
  kinds.resolve('shop', new EnumTable(), diagnostics);
  return {
    kind: (name: string): KindRef => kinds.qualified('shop', name)!,
    said: diagnostics.refusals.map((d) => [locationOf(d.at), d.message, d.remedy]),
  };
}

describe('a describe composes as an exclusive member', () => {
  it('is none where the closure writes none, and the one source’s where one does', () => {
    const { kind, said } = composed(
      'kind Plain { }\nkind Crate { describe { text "A crate." } }\nkind Big is Crate { }\nkind Bigger is Big, Plain { }',
    );
    expect(said).toEqual([]);
    expect(kind('Plain').describe).toBeNull();
    expect(kind('Crate').describe?.origin).toBe('shop.Crate');
    expect(kind('Bigger').describe?.origin).toBe('shop.Crate');
  });

  it('is the composer’s own over anything it composes, which is no collision', () => {
    const { kind, said } = composed(
      'kind A { describe { text "A." } }\nkind B { describe { text "B." } }\nkind C is A, B { describe { text "Both." } }',
    );
    expect(said).toEqual([]);
    expect(kind('C').describe?.origin).toBe('shop.C');
  });

  it('is one origin however many paths reach it', () => {
    const { kind, said } = composed(
      'kind A { describe { text "A." } }\nkind B is A { }\nkind C is A { }\nkind D is B, C { }',
    );
    expect(said).toEqual([]);
    expect(kind('D').describe?.origin).toBe('shop.A');
  });

  it('from two sources is refused at the kind that brought the second, asking for the one paragraph', () => {
    const { kind, said } = composed(
      'kind A { describe { text "A." } }\nkind B { describe { text "B." } }\nkind C is A, B { }',
    );
    expect(said).toEqual([
      [
        'k.sprout:3:14',
        '`C` gets a `describe` from both `A` and `B`, and a thing has one voice.',
        'Write `describe { … }` in `C`, with the one paragraph both should make.',
      ],
    ]);
    expect(kind('C').describe?.origin).toBe('shop.A');
  });

  it('written twice in one body is refused at the second, which is dropped', () => {
    const { kind, said } = composed(
      'kind A {\n  describe { text "A." }\n  describe { text "B." }\n}',
    );
    expect(said).toEqual([
      [
        'k.sprout:3:3',
        '`A` writes `describe` twice.',
        'A thing has one description. Keep one `describe`, and write what both say in it, with `if` where it depends.',
      ],
    ]);
    const kept = kind('A').describe!.declaration.body.statements[0]!;
    expect(kept.kind === 'text' && kept.said.kind === 'prose-literal' && kept.said.value).toBe(
      'A.',
    );
  });

  it('is read by the two functions composing uses, directly', () => {
    const diagnostics = new Diagnostics();
    expect(ownDescribe('K', [], 'shop.K', diagnostics)).toBeNull();
    expect(composeDescribe('K', [], null, (origin) => origin, diagnostics)).toBeNull();
    expect(diagnostics.all).toEqual([]);
  });
});
