import { describe, expect, it } from 'vitest';

import type { GuardName, KindDeclaration } from '../syntax/ast.js';
import { Diagnostics } from '../source/diagnostics.js';
import { parseDeclarations } from '../syntax/parse.js';
import { locationOf, SourceFile } from '../source/source.js';
import { EnumTable } from './enums.js';
import { KindTable, type KindRef } from './kinds.js';
import { composeGuards, NO_GUARDS, ownGuards, writesGuard, type Guards } from './guards.js';

/** Every kind in `text`, composed in the library `shop`, and what composing them said. */
function composed(text: string) {
  const read = new Diagnostics();
  const declared = parseDeclarations(new SourceFile('shop.sprout', text), read);
  expect(
    read.refusals.map((d) => d.message),
    'the fixture parses',
  ).toEqual([]);
  const diagnostics = new Diagnostics();
  const kinds = new KindTable();
  kinds.add(
    'shop',
    declared.filter((d): d is KindDeclaration => d.kind === 'kind'),
    diagnostics,
  );
  kinds.resolve(new EnumTable(), diagnostics);
  return {
    kind: (name: string): KindRef => kinds.qualified('shop', name)!,
    declared,
    said: diagnostics.refusals.map((d) => [locationOf(d.at), d.message, d.remedy]),
  };
}

/** Who wrote each guard a kind runs for one part of a move, in run order. */
const origins = (kind: KindRef, name: GuardName): string[] =>
  kind.guards[name].map((guard) => guard.origin);

/** `A`, and two kinds composing it, each writing a `depart` of its own. */
const DIAMOND = `kind A { depart (to) { refuse "a" } }
kind B: A { depart (to) { refuse "b" } }
kind C: A { depart (to) { refuse "c" } }
`;

describe('a kind’s own guards', () => {
  it('are one for each part of a move, each with the kind as its origin', () => {
    const { declared } = composed(
      'kind Crate { depart (to) { allow } release (item, to) { allow } accept (item, from) { allow } }',
    );
    const diagnostics = new Diagnostics();
    const own = ownGuards(
      'Crate',
      (declared[0] as KindDeclaration).members,
      'shop.Crate',
      diagnostics,
    );
    expect(diagnostics.refusals).toEqual([]);
    expect([...own.keys()]).toEqual(['depart', 'release', 'accept']);
    expect([...own.values()].map((guard) => guard.origin)).toEqual([
      'shop.Crate',
      'shop.Crate',
      'shop.Crate',
    ]);
  });

  it('refuses one written twice at the second, and keeps the first', () => {
    const { kind, said } = composed(`kind Crate {
  contains
  accept (item, from) { refuse "first" }
  release (item, to) { allow }
  accept (item, from) { refuse "second" }
}`);
    expect(said).toEqual([
      [
        'shop.sprout:5:3',
        '`Crate` writes `accept` twice.',
        'A kind answers once for each part of a move. Keep one `accept`, and write what both decide in it with `if` and `else if`.',
      ],
    ]);
    const kept = kind('Crate').guards.accept;
    expect(kept).toHaveLength(1);
    expect(locationOf(kept[0]!.declaration.at)).toBe('shop.sprout:3:3');
  });

  it('are none where nothing in the closure writes one: the engine allows', () => {
    const { kind } = composed('kind Plain { :lit false }\nkind Lamp: Plain { }');
    expect(kind('Lamp').guards).toEqual(NO_GUARDS);
  });
});

describe('composed guards all run, in closure order, the composer’s own last', () => {
  it('runs each origin once however many paths reach it, depth-first and left to right', () => {
    const { kind, said } = composed(`${DIAMOND}kind D: B, C { depart (to) { refuse "d" } }`);
    expect(said).toEqual([]);
    expect(origins(kind('D'), 'depart')).toEqual(['shop.A', 'shop.B', 'shop.C', 'shop.D']);
  });

  it('keeps each part of a move to its own list', () => {
    const { kind } = composed(`kind Shelf { accept (item, from) { allow } }
kind Fixture { depart (to) { allow } }
kind Case: Shelf, Fixture { release (item, to) { allow } }`);
    const guards = kind('Case').guards;
    expect(origins(kind('Case'), 'depart')).toEqual(['shop.Fixture']);
    expect(origins(kind('Case'), 'release')).toEqual(['shop.Case']);
    expect(origins(kind('Case'), 'accept')).toEqual(['shop.Shelf']);
    expect(writesGuard(guards, 'release', 'shop.Case')).toBe(true);
    expect(writesGuard(guards, 'accept', 'shop.Case')).toBe(false);
  });

  it('orders by where each origin sits in the closure, not by the list it came through', () => {
    // `C` is written first, but `A` comes before it in the closure
    // because `B` reaches `A` and `C` reaches it too; so `A` runs first.
    const { kind } = composed(`${DIAMOND}kind D: C, B { }`);
    expect(kind('D').order).toEqual(['shop.A', 'shop.C', 'shop.B', 'shop.D']);
    expect(origins(kind('D'), 'depart')).toEqual(['shop.A', 'shop.C', 'shop.B']);
  });
});

describe('`without` leaves one origin’s guard out', () => {
  it('drops that origin’s guard and no other, and records the suppression', () => {
    const { kind, said } = composed(`${DIAMOND}kind D: B { without depart from A }`);
    expect(said).toEqual([]);
    expect(origins(kind('D'), 'depart')).toEqual(['shop.B']);
    expect(kind('D').suppressed.map((one) => one.source)).toEqual(['shop.A']);
  });

  it('keeps it left out in whatever composes the kind that left it out, however else that reaches it', () => {
    // `B` leaves `A`'s out; `C` brings `A`'s back by another path, and
    // it stays out in `D` all the same.
    const { kind } = composed(`kind A { depart (to) { refuse "a" } }
kind B: A { without depart from A }
kind C: A { }
kind D: B, C { }`);
    expect(origins(kind('C'), 'depart')).toEqual(['shop.A']);
    expect(origins(kind('D'), 'depart')).toEqual([]);
    expect(kind('D').suppressed.map((one) => one.source)).toEqual(['shop.A']);
  });

  it('leaves the other parts of a move alone', () => {
    const { kind } = composed(`kind A { depart (to) { refuse "a" } accept (item, from) { allow } }
kind B: A { without depart from A }`);
    expect(origins(kind('B'), 'depart')).toEqual([]);
    expect(origins(kind('B'), 'accept')).toEqual(['shop.A']);
  });
});

describe('composeGuards, given its parts directly', () => {
  const { kind } = composed(DIAMOND);
  const [a, b] = [kind('A'), kind('B')];
  const guardOf = (of: KindRef) => of.guards.depart.at(-1)!;

  it('puts the composer’s own after everything it composes', () => {
    const own = new Map([['depart' as const, { ...guardOf(b), origin: 'shop.Z' }]]);
    const guards: Guards = composeGuards([a.guards], ['shop.A'], [], own);
    expect(guards.depart.map((guard) => guard.origin)).toEqual(['shop.A', 'shop.Z']);
    expect(guards.release).toEqual([]);
  });

  it('never leaves out the composer’s own, whatever is suppressed', () => {
    const own = new Map([['depart' as const, guardOf(b)]]);
    const at = guardOf(b).declaration.at;
    const suppressed = [
      {
        member: {
          kind: 'guard-ref' as const,
          at,
          guard: 'depart' as const,
        },
        source: 'shop.B',
      },
    ];
    const guards = composeGuards([a.guards], ['shop.A'], suppressed, own);
    expect(guards.depart.map((guard) => guard.origin)).toEqual(['shop.A', 'shop.B']);
  });
});
