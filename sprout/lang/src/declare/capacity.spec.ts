// A capacity by measure is one per kind (the spec's Containment is a
// declaration; How members combine): the composer's own, else the one
// source it composes, refused where it is said twice, where two sources
// arrive, where the body holds nothing, or past the largest integer.

import { describe, expect, it } from 'vitest';

import type { KindExpr, KindMember } from '../syntax/ast.js';
import { Diagnostics } from '../source/diagnostics.js';
import { locationOf, SourceFile } from '../source/source.js';
import { readBody } from '../fixtures/readers.js';
import { composeCapacity, type Capacity, type CapacityArrival } from './capacity.js';

const FILE = new SourceFile('shop.sprout', 'Cart Tub');

/** A kind as a composer writes it, `Cart` or `Tub`, spanning its name in `FILE`. */
function written(name: 'Cart' | 'Tub'): KindExpr {
  const start = FILE.text.indexOf(name);
  const at = FILE.span(start, start + name.length);
  return { kind: 'kind-expr', at, library: null, name: { kind: 'ident', at, text: name } };
}

/** What `origin`'s own `capacity` says, as a composer receives it. */
function capacityOf(origin: string, limit: number): Capacity {
  return { limit, by: 'size', origin, at: FILE.span(0, 0) };
}

/** The members of a kind whose body is `body`. */
function members(body: string): readonly KindMember[] {
  const { members: read, refusals } = readBody(`kind Bag is sprout.Container {\n${body}\n}\n`);
  expect(refusals, 'the fixture parses').toEqual([]);
  return read as readonly KindMember[];
}

/** Compose `Bag`'s capacity from `body` and what arrives, holding things unless `contains` says otherwise. */
function compose(body: string, arrivals: readonly CapacityArrival[] = [], contains = true) {
  const diagnostics = new Diagnostics();
  const capacity = composeCapacity(
    { name: 'Bag', members: members(body) },
    'shop.Bag',
    arrivals,
    contains,
    (origin) => origin.replace(/^shop\./, ''),
    diagnostics,
  );
  const said = diagnostics.refusals.map((d) => [locationOf(d.at), d.message]);
  return { capacity, said };
}

describe('a capacity written in the body', () => {
  it('is the composer’s own: its most, its property and its origin', () => {
    const { capacity, said } = compose('  capacity 40 by :size');
    expect(said).toEqual([]);
    expect([capacity?.limit, capacity?.by, capacity?.origin]).toEqual([40, 'size', 'shop.Bag']);
  });

  it('replaces two composed sources, which then do not collide', () => {
    const { capacity, said } = compose('  capacity 60 by :weight', [
      { capacity: capacityOf('shop.Cart', 30), written: written('Cart') },
      { capacity: capacityOf('shop.Tub', 20), written: written('Tub') },
    ]);
    expect(said).toEqual([]);
    expect([capacity?.limit, capacity?.by]).toEqual([60, 'weight']);
  });

  it('is refused said twice, at the second', () => {
    const { capacity, said } = compose('  capacity 40 by :size\n  capacity 50 by :size');
    expect(said).toEqual([['b.sprout:3:3', '`Bag` says its capacity twice.']]);
    expect(capacity?.limit).toBe(40);
  });

  it('is refused where the body holds nothing', () => {
    const { said } = compose('  capacity 40 by :size', [], false);
    expect(said).toEqual([['b.sprout:2:3', '`Bag` has a capacity and holds nothing.']]);
  });

  it('is refused past the largest integer, at the number', () => {
    const { said } = compose('  capacity 2147483648 by :size');
    expect(said).toEqual([
      ['b.sprout:2:12', 'A capacity of 2147483648 is more than an integer holds.'],
    ]);
    expect(compose('  capacity 2147483647 by :size').said).toEqual([]);
  });
});

describe('a capacity the composer does not write', () => {
  it('is none where nothing it composes has one', () => {
    expect(compose('', [{ capacity: null, written: written('Cart') }]).capacity).toBeNull();
  });

  it('is the one source it composes, however many paths reach it', () => {
    const cart = capacityOf('shop.Cart', 30);
    const { capacity, said } = compose('', [
      { capacity: cart, written: written('Cart') },
      { capacity: cart, written: written('Tub') },
    ]);
    expect(said).toEqual([]);
    expect(capacity).toBe(cart);
  });

  it('is refused from two sources, at the kind that brought the second', () => {
    const { said } = compose('', [
      { capacity: capacityOf('shop.Cart', 30), written: written('Cart') },
      { capacity: capacityOf('shop.Tub', 20), written: written('Tub') },
    ]);
    expect(said).toEqual([
      [
        'shop.sprout:1:6',
        '`Bag` gets its capacity from both `Cart` and `Tub`, and a container has one.',
      ],
    ]);
  });
});
