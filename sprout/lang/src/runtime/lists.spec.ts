import { describe, expect, it } from 'vitest';

import type { ValueType } from '../declare/types.js';
import { Diagnostics } from '../source/diagnostics.js';
import { EnumTable } from '../declare/enums.js';
import { DEFAULT_LIMITS, limitsFrom } from '../bundle/limits.js';
import { ListFull, SproutList, type Element } from './lists.js';
import { parseDeclarations } from '../syntax/parse.js';
import { SourceFile } from '../source/source.js';
import { BOOLEAN, integer, STRING } from '../declare/types.js';

const ALLOWED = DEFAULT_LIMITS.caps.listElements;

/** `Ward`, resolved the way a property's type would be. */
const WARD: ValueType = (() => {
  const table = new EnumTable();
  const diagnostics = new Diagnostics();
  table.add(
    'shop',
    parseDeclarations(
      new SourceFile('e.sprout', 'enum Ward { oak, silver, brass }\n'),
      diagnostics,
    ).filter((d) => d.kind === 'enum'),
    diagnostics,
  );
  expect(diagnostics.refusals).toHaveLength(0);
  return { type: 'symbol', of: table.unqualified('Ward', 'shop')! };
})();

/** A list filled to whatever the host allows. */
function full(holds: ValueType = integer()): SproutList {
  return SproutList.of(
    holds,
    Array.from({ length: ALLOWED }, (_, i) => i),
  );
}

describe('a list is ordered, and its order is insertion order', () => {
  it('keeps what it was given in the order it was given', () => {
    expect(SproutList.of(integer(), [3, 1, 2]).elements).toEqual([3, 1, 2]);
    expect(SproutList.of(WARD, ['silver', 'oak']).elements).toEqual(['silver', 'oak']);
  });

  it('adds at the end, because `{for … of}` makes the order visible in prose', () => {
    const opens = SproutList.of(WARD, ['oak']).add('silver').add('brass');
    expect(opens.elements).toEqual(['oak', 'silver', 'brass']);
  });

  it('keeps the order of what is left after a removal', () => {
    const three = SproutList.of(WARD, ['oak', 'silver', 'brass']);
    expect(three.remove('silver').elements).toEqual(['oak', 'brass']);
  });

  it('is two different lists when the same things are in a different order', () => {
    // Order is visible in prose, so two lists that render differently
    // are not the same list.
    expect(SproutList.of(integer(), [1, 2]).equals(SproutList.of(integer(), [1, 2]))).toBe(true);
    expect(SproutList.of(integer(), [2, 1]).equals(SproutList.of(integer(), [1, 2]))).toBe(false);
  });

  it('is not equal to a list of something else holding the same-looking things', () => {
    expect(SproutList.of(BOOLEAN, [true]).equals(SproutList.of(STRING, ['true']))).toBe(false);
    expect(SproutList.of(WARD, ['oak']).equals(SproutList.of(STRING, ['oak']))).toBe(false);
  });
});

describe('a list holds no duplicates, and says so by doing nothing', () => {
  it('adds something it already holds by doing nothing at all', () => {
    const opens = SproutList.of(WARD, ['oak', 'silver']);
    // The same list, not an equal one: a caller can tell nothing
    // happened, which is what `add` of a held thing means.
    expect(opens.add('oak')).toBe(opens);
    expect(opens.add('silver').elements).toEqual(['oak', 'silver']);
  });

  it('removes something it does not hold by doing nothing at all', () => {
    const opens = SproutList.of(WARD, ['oak']);
    expect(opens.remove('brass')).toBe(opens);
  });

  it('reads the spec’s own two sentences', () => {
    // `self.add(:opens, silver)` on a list already holding `silver`
    // does nothing, and `self.remove(:opens, iron)` on a list without
    // `iron` does nothing.
    const opens = SproutList.of(WARD, ['oak', 'silver']);
    expect(opens.add('silver').elements).toEqual(['oak', 'silver']);
    expect(opens.remove('brass').elements).toEqual(['oak', 'silver']);
  });

  it('drops a repeat it was built from rather than holding it twice', () => {
    expect(SproutList.of(integer(), [1, 1, 2, 2, 1]).elements).toEqual([1, 2]);
  });
});

describe('the four operations, and no more', () => {
  const opens = SproutList.of(WARD, ['oak', 'silver']);

  it('`includes(x)`', () => {
    expect(opens.includes('oak')).toBe(true);
    expect(opens.includes('brass')).toBe(false);
  });

  it('`count`', () => {
    expect(opens.count).toBe(2);
    expect(SproutList.of(WARD).count).toBe(0);
  });

  it('`add` and `remove` hand back a list rather than changing this one', () => {
    // A binding that named it still names what it named: nothing in
    // the language can see a list change under it.
    const before = [...opens.elements];
    opens.add('brass');
    opens.remove('oak');
    expect(opens.elements).toEqual(before);
  });
});

describe('a list is bounded, and a full one faults rather than dropping', () => {
  it('holds as many as the host allows', () => {
    expect(full().count).toBe(ALLOWED);
    expect(full().full).toBe(true);
    expect(SproutList.of(integer(), [1]).full).toBe(false);
  });

  it('faults when a new element is added to a full one', () => {
    // Not a silent drop: `adjust` clamps at a ceiling because reaching
    // the ceiling is the meaning, but dropping an element would lose
    // something the author wrote.
    expect(() => full().add(ALLOWED + 1)).toThrow(ListFull);
    try {
      full().add(ALLOWED + 1);
    } catch (fault) {
      expect(fault).toBeInstanceOf(ListFull);
      expect((fault as ListFull).allowed).toBe(ALLOWED);
      expect((fault as ListFull).message).toContain('integer');
    }
  });

  it('does not fault when a full list is added to with what it already holds', () => {
    const held = full();
    expect(held.add(0)).toBe(held);
  });

  it('faults when it is built from more than the host allows', () => {
    const many: Element[] = Array.from({ length: ALLOWED + 1 }, (_, i) => i);
    expect(() => SproutList.of(integer(), many)).toThrow(ListFull);
  });

  it('takes the bound from the host, not from a number of its own', () => {
    const smaller = limitsFrom({ caps: { listElements: 2 } });
    const two = SproutList.of(integer(), [1, 2], smaller.caps);
    expect(two.full).toBe(true);
    expect(() => two.add(3)).toThrow(ListFull);

    const bigger = limitsFrom({ caps: { listElements: ALLOWED + 8 } });
    expect(SproutList.of(integer(), [...Array(ALLOWED + 8).keys()], bigger.caps).count).toBe(
      ALLOWED + 8,
    );
  });

  it('keeps room again once something is removed', () => {
    const held = full();
    expect(held.remove(0).full).toBe(false);
    expect(held.remove(0).add(ALLOWED + 1).count).toBe(ALLOWED);
  });
});
