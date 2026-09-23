import { describe, expect, it } from 'vitest';

import type { ValueType } from '../declare/types.js';
import { Diagnostics } from '../source/diagnostics.js';
import { EnumTable } from '../declare/enums.js';
import { DEFAULT_LIMITS, limitsFrom } from '../bundle/limits.js';
import { ListFull, sameValue, SproutList } from './lists.js';
import type { Value } from './values.js';
import { parseDeclarations } from '../syntax/parse.js';
import { SourceFile } from '../source/source.js';
import { integer, STRING } from '../declare/types.js';

const CAPS = DEFAULT_LIMITS.caps;
const ALLOWED = CAPS.listElements;

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
    CAPS,
  );
}

describe('a list is ordered, and its order is insertion order', () => {
  it('keeps what it was given in the order it was given', () => {
    expect(SproutList.of(integer(), [3, 1, 2], CAPS).elements).toEqual([3, 1, 2]);
    expect(SproutList.of(WARD, ['silver', 'oak'], CAPS).elements).toEqual(['silver', 'oak']);
  });

  it('adds at the end, because `{for … of}` makes the order visible in prose', () => {
    const opens = SproutList.of(WARD, ['oak'], CAPS).add('silver').add('brass');
    expect(opens.elements).toEqual(['oak', 'silver', 'brass']);
  });

  it('keeps the order of what is left after a removal', () => {
    const three = SproutList.of(WARD, ['oak', 'silver', 'brass'], CAPS);
    expect(three.remove('silver').elements).toEqual(['oak', 'brass']);
  });
});

describe('a list holds no duplicates, and says so by doing nothing', () => {
  it('adds something it already holds by doing nothing at all', () => {
    const opens = SproutList.of(WARD, ['oak', 'silver'], CAPS);
    // The same list, not an equal one: a caller can tell nothing
    // happened, which is what `add` of a held thing means.
    expect(opens.add('oak')).toBe(opens);
    expect(opens.add('silver').elements).toEqual(['oak', 'silver']);
  });

  it('removes something it does not hold by doing nothing at all', () => {
    const opens = SproutList.of(WARD, ['oak'], CAPS);
    expect(opens.remove('brass')).toBe(opens);
  });

  it('reads the spec’s own two sentences', () => {
    // `self.add(:opens, silver)` on a list already holding `silver`
    // does nothing, and `self.remove(:opens, iron)` on a list without
    // `iron` does nothing.
    const opens = SproutList.of(WARD, ['oak', 'silver'], CAPS);
    expect(opens.add('silver').elements).toEqual(['oak', 'silver']);
    expect(opens.remove('brass').elements).toEqual(['oak', 'silver']);
  });

  it('drops a repeat it was built from rather than holding it twice', () => {
    expect(SproutList.of(integer(), [1, 1, 2, 2, 1], CAPS).elements).toEqual([1, 2]);
  });
});

describe('the four operations, and no more', () => {
  const opens = SproutList.of(WARD, ['oak', 'silver'], CAPS);

  it('`includes(x)`', () => {
    expect(opens.includes('oak')).toBe(true);
    expect(opens.includes('brass')).toBe(false);
  });

  it('`count`', () => {
    expect(opens.count).toBe(2);
    expect(SproutList.of(WARD, [], CAPS).count).toBe(0);
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
    expect(SproutList.of(integer(), [1], CAPS).full).toBe(false);
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
    const many: Value[] = Array.from({ length: ALLOWED + 1 }, (_, i) => i);
    expect(() => SproutList.of(integer(), many, CAPS)).toThrow(ListFull);
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

describe('a list of lists keeps the no-duplicates rule by order', () => {
  const ROW: ValueType = { type: 'list', element: WARD };
  const row = (...wards: string[]) => SproutList.of(ROW, wards, CAPS);
  const grid = (...rows: SproutList[]) => SproutList.of({ type: 'list', element: ROW }, rows, CAPS);

  it('drops a later inner list holding the same wards in the same order', () => {
    // Not identity: two inner lists built separately are still the
    // same element, which is what keeps the rule here.
    expect(grid(row('oak'), row('oak')).count).toBe(1);
    expect(grid(row('oak', 'silver'), row('oak', 'silver')).count).toBe(1);
  });

  it('keeps an inner list holding the same wards in a different order', () => {
    const kept = grid(row('oak', 'silver'), row('silver', 'oak'));
    expect(kept.count).toBe(2);
    expect(kept.elements.map(String)).toEqual(['[oak, silver]', '[silver, oak]']);
  });

  it('is not the same element as an inner list of another element type', () => {
    const wards = grid(row('oak'));
    expect(wards.includes(SproutList.of(STRING, ['oak'], CAPS))).toBe(false);
  });

  it('`includes`, `add` and `remove` take a whole inner list', () => {
    const held = grid(row('oak'), row('silver'));
    expect(held.includes(row('silver'))).toBe(true);
    expect(held.includes(row('brass'))).toBe(false);

    // `add` of one it already holds does nothing at all, and `remove`
    // of one it does not hold does nothing at all.
    expect(held.add(row('oak'))).toBe(held);
    expect(held.remove(row('brass'))).toBe(held);

    expect(held.add(row('brass')).elements.map(String)).toEqual(['[oak]', '[silver]', '[brass]']);
    expect(held.remove(row('oak')).elements.map(String)).toEqual(['[silver]']);
  });

  it('names itself with its inner lists spelled out', () => {
    expect(String(grid(row('oak'), row('silver')))).toBe('[[oak], [silver]]');
    expect(String(grid())).toBe('[]');
  });

  it('bounds each list on its own, the inner ones included', () => {
    const smaller = limitsFrom({ caps: { listElements: 2 } });
    const two = SproutList.of(ROW, ['oak', 'silver'], smaller.caps);
    expect(two.full).toBe(true);
    expect(() => two.add('brass')).toThrow(ListFull);
    // The outer list has room for a third row even though this one is
    // full, because the cap is a cap on each list.
    const rows = SproutList.of({ type: 'list', element: ROW }, [two], smaller.caps);
    expect(rows.add(SproutList.of(ROW, ['brass'], smaller.caps)).count).toBe(2);
  });
});

describe('whether two values are the same', () => {
  it('is identity for a scalar, and same elements in the same order for a list', () => {
    const caps = DEFAULT_LIMITS.caps;
    expect(sameValue(3, 3)).toBe(true);
    expect(sameValue('oak', 'iron')).toBe(false);
    const words = SproutList.of(STRING, ['a', 'b'], caps);
    expect(sameValue(words, SproutList.of(STRING, ['a', 'b'], caps))).toBe(true);
    expect(sameValue(words, SproutList.of(STRING, ['b', 'a'], caps))).toBe(false);
    expect(sameValue(words, words.add('a'))).toBe(true);
    expect(sameValue(words, 'a')).toBe(false);
  });
});
