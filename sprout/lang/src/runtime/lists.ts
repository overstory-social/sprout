// A list, as a world actually holds one (the spec's Properties › Lists).
//
// A bounded, ordered collection of ONE element type, without duplicates.
// Each of those three words is a decision:
//
//   ORDERED, in insertion order, because `{for … of}` makes the order
//   visible in prose. A set that reordered itself would rewrite a
//   sentence an author wrote.
//
//   NO DUPLICATES, so `add` of something already held does nothing and
//   `remove` of something not held does nothing. Neither is an error:
//   the list is a statement about what is true, and saying a true thing
//   twice is not a mistake.
//
//   BOUNDED by what the host allows. Adding a new element to a full
//   list is a FAULT rather than a silent drop — `adjust` clamps at a
//   ceiling because reaching the ceiling is the meaning, but dropping
//   an element would lose something the author wrote, and a world that
//   quietly forgot half a keyring would be worse than one that stopped.
//
// Four operations, and no more: `includes`, `count`, `add`, `remove`.
// Only the object that declared the property may add or remove, which
// is `check.ts`'s to enforce and not something a value can know.
//
// The element type is carried so that a list can say what it holds when
// it refuses something. An element may itself be a list, and there the
// no-duplicates rule is kept by taking two elements to be the same when
// they hold the same element type and the same elements in the same
// order — not an `==` an author can write (the spec's Lists). What a
// list holds is a `Value` (`values.ts`), and it is stored as an array of
// its elements (`stored.ts`), read back whole or not at all.

import type { ValueType } from '../declare/types.js';
import type { Value } from './values.js';
import { DEFAULT_LIMITS, type StaticCaps } from '../bundle/limits.js';
import { sameType, showType } from '../declare/types.js';

/**
 * A full list was added to. Thrown, and not returned, for the reason
 * `BudgetExhausted` is: the turn cannot finish what it was asked to do,
 * and everything it has done is about to be rolled back. B34 turns it
 * into the world's `fault` passage.
 */
export class ListFull extends Error {
  constructor(
    readonly allowed: number,
    readonly holding: ValueType,
  ) {
    super(`a list of ${showType(holding)} already holds ${allowed}`);
    this.name = 'ListFull';
  }
}

/**
 * A list value. Immutable from the outside: `add` and `remove` hand
 * back a list rather than changing this one, so a binding that named it
 * still names what it named. Nothing here holds a reference to an
 * object, because no list can.
 */
export class SproutList {
  private constructor(
    readonly holds: ValueType,
    private readonly items: readonly Value[],
    readonly allowed: number,
  ) {}

  /**
   * A list of `holds`, holding `elements` in the order given. Later
   * duplicates are dropped rather than refused — a caller building one
   * from source has already had them refused by `checkLiteral`, and
   * `decodeValue` refuses a stored list holding one before it gets here.
   */
  static of(
    holds: ValueType,
    elements: readonly Value[] = [],
    caps: StaticCaps = DEFAULT_LIMITS.caps,
  ): SproutList {
    const items: Value[] = [];
    for (const element of elements) {
      if (items.some((held) => same(held, element))) continue;
      if (items.length >= caps.listElements) throw new ListFull(caps.listElements, holds);
      items.push(element);
    }
    return new SproutList(holds, items, caps.listElements);
  }

  /** What it holds, in insertion order. */
  get elements(): readonly Value[] {
    return this.items;
  }

  /** How many. One of the four operations. */
  get count(): number {
    return this.items.length;
  }

  /** Whether it holds this. One of the four. */
  includes(element: Value): boolean {
    return this.items.some((held) => same(held, element));
  }

  /** Whether another element would fit, which is what `add` faults about. */
  get full(): boolean {
    return this.items.length >= this.allowed;
  }

  /**
   * With this element in it. Already holding it does nothing — the same
   * list, not a copy, so a caller can tell nothing changed. Adding a
   * NEW element to a full list faults.
   */
  add(element: Value): SproutList {
    if (this.includes(element)) return this;
    if (this.full) throw new ListFull(this.allowed, this.holds);
    return new SproutList(this.holds, [...this.items, element], this.allowed);
  }

  /** Without this element. Not holding it does nothing. */
  remove(element: Value): SproutList {
    if (!this.includes(element)) return this;
    return new SproutList(
      this.holds,
      this.items.filter((held) => !same(held, element)),
      this.allowed,
    );
  }

  /** As a message names it: `[oak, silver]`, or `[[oak], [silver]]`. */
  toString(): string {
    return `[${this.items.map((element) => String(element)).join(', ')}]`;
  }
}

/**
 * Whether two elements are the same element: a scalar by identity, and
 * a list when it holds the same element type, as many elements, and
 * elements that are the same in order. This is what keeps the
 * no-duplicates rule inside a list of lists, and it is the only
 * sameness there is for lists — the spec gives an author no `==` on one.
 */
function same(a: Value, b: Value): boolean {
  if (a instanceof SproutList || b instanceof SproutList) {
    if (!(a instanceof SproutList) || !(b instanceof SproutList)) return false;
    if (!sameType(a.holds, b.holds)) return false;
    if (a.count !== b.count) return false;
    return a.elements.every((element, index) => same(element, b.elements[index]!));
  }
  return a === b;
}
