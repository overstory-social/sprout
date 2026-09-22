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
// it refuses something, and so that two lists are only ever compared
// when they hold the same thing. What a VALUE is at run time belongs to
// B16, which builds the state model; this is the one collection the
// language has, written so that B16 has something to persist.

import type { ValueType } from '../declare/types.js';
import { DEFAULT_LIMITS, type StaticCaps } from '../bundle/limits.js';
import { sameType, showType } from '../declare/types.js';

/**
 * What a list holds. An option is its own name — `oak`, not `:oak` —
 * because that is what a symbol IS once its enum is known, and the
 * enum is known from the list's element type.
 */
export type Element = boolean | number | string;

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
 * still names what it named. B16 decides what is persisted; nothing
 * here holds a reference to an object, because no list can.
 */
export class SproutList {
  private constructor(
    readonly holds: ValueType,
    private readonly items: readonly Element[],
    readonly allowed: number,
  ) {}

  /**
   * A list of `holds`, holding `elements` in the order given. Later
   * duplicates are dropped rather than refused — a caller building one
   * from source has already had them refused by `checkLiteral`, and a
   * caller restoring one from state is restoring what was already
   * checked.
   */
  static of(
    holds: ValueType,
    elements: readonly Element[] = [],
    caps: StaticCaps = DEFAULT_LIMITS.caps,
  ): SproutList {
    const items: Element[] = [];
    for (const element of elements) {
      if (items.includes(element)) continue;
      if (items.length >= caps.listElements) throw new ListFull(caps.listElements, holds);
      items.push(element);
    }
    return new SproutList(holds, items, caps.listElements);
  }

  /** What it holds, in insertion order. */
  get elements(): readonly Element[] {
    return this.items;
  }

  /** How many. One of the four operations. */
  get count(): number {
    return this.items.length;
  }

  /** Whether it holds this. One of the four. */
  includes(element: Element): boolean {
    return this.items.includes(element);
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
  add(element: Element): SproutList {
    if (this.includes(element)) return this;
    if (this.full) throw new ListFull(this.allowed, this.holds);
    return new SproutList(this.holds, [...this.items, element], this.allowed);
  }

  /** Without this element. Not holding it does nothing. */
  remove(element: Element): SproutList {
    if (!this.includes(element)) return this;
    return new SproutList(
      this.holds,
      this.items.filter((held) => held !== element),
      this.allowed,
    );
  }

  /**
   * Whether two lists are the same list: the same element type, the
   * same things, in the same order. Order counts because it is visible
   * in prose, so two lists that render differently are not equal.
   */
  equals(other: SproutList): boolean {
    if (!sameType(this.holds, other.holds)) return false;
    if (this.items.length !== other.items.length) return false;
    return this.items.every((element, index) => element === other.items[index]);
  }

  /** As a message names it: `[oak, silver]`. */
  toString(): string {
    return `[${this.items.map((element) => String(element)).join(', ')}]`;
  }
}
