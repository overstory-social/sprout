// The invariant this folder guards — "a defect in one item never loses a
// well-formed neighbour in silence" — run over a property built from its
// parts, with a fixed seed, and one defect in any one part: first a
// property on its own, with no neighbour to lose, then a list default at
// any depth, where the elements either side of the defect are the
// neighbours.

import { describe, expect, it } from 'vitest';

import type { Literal } from '../../ast.js';
import { parseDeclarations, parseProperty } from '../../parse.js';
import { chooser } from '../../../fixtures/parse.js';
import {
  contained,
  defectiveProperty,
  explained,
  memberNames,
  OVER_CAP,
  ownedBy,
  OWNERS,
  reading,
  stoppedShort,
  stray,
  tally,
  tooDeep,
  unclosed,
  SORTS,
  type Defect,
} from '../../../fixtures/recovery.js';

describe('a defect in one item never loses a well-formed neighbour in silence', () => {
  it('over a generated property on its own, a defect in any part', () => {
    // No neighbour to lose, so what holds is that nothing is thrown and
    // the defect is refused, wherever in the property it is.
    const c = chooser(20_260_923);
    const reached = tally();
    for (let i = 0; i < 400; i++) {
      const made = defectiveProperty(c);
      const { result, said, threw } = reading(made.text, parseProperty);
      expect(threw, made.text).toBeNull();
      reached.add(made.defect.sort);
      if (!stoppedShort(made.text, result)) {
        expect(said.length, `${made.text}\n  nothing was wrong with it`).toBeGreaterThan(0);
      }
    }
    expect(reached.keys()).toEqual(SORTS);
  });

  it('an unclosed list default, directly before a well-formed member, keeps that member', () => {
    // No `]` anywhere: the hunt for one stops at the next member's own
    // `:symbol` rather than reading past it, so `bravo` survives and the
    // body still closes at its own `}`.
    for (const owner of OWNERS) {
      const text = `${owner.open}\n  :faulty [oak\n  :bravo 1\n${owner.close}\n`;
      const { result, said } = reading(text, parseDeclarations);
      expect(ownedBy(owner, result)?.members.flatMap(memberNames), text).toEqual(['bravo']);
      expect(
        said.map((d) => d.message),
        text,
      ).toEqual(['This list is never closed.']);
    }
  });

  /**
   * The element pool a generated list draws its leaves from, and the
   * declared type that matches: options for an enum, and, so the
   * elements written after a stray closer are named whatever shape they
   * are, whole numbers (signed ones included) and text too.
   */
  const ELEMENT_KINDS: readonly { readonly type: string; readonly pool: readonly string[] }[] = [
    { type: 'Ward', pool: ['oak', 'silver', 'iron', 'brass', 'tin', 'copper', 'zinc', 'lead'] },
    { type: 'integer', pool: ['1', '-2', '3', '-4', '5', '-6', '7', '-8'] },
    { type: 'string', pool: ['"a"', '"b"', '"c"', '"d"', '"e"', '"f"', '"g"', '"h"'] },
  ];

  it('over a generated list default, a defect at any depth', () => {
    const c = chooser(20_260_924);
    const ELEMENT: readonly Defect[] = [
      ...['Zeta', '1.5', '-1.5', '%', ':a', '{', ')', '-oak', '-[oak]', '-', 'Ward.oak'].map(
        (text) => contained(text),
      ),
      contained(tooDeep('oak')),
      contained(OVER_CAP),
      stray('}'),
      stray(']'),
      unclosed('['),
    ];
    const reached = tally();
    for (let i = 0; i < 600; i++) {
      // The list is built with numbered holes for its leaves, so the
      // defect can go in place of one leaf, beside it, or in place of
      // the comma after it.
      const kind = c.one(ELEMENT_KINDS);
      const depth = 1 + c.below(3);
      let leaves = 0;
      const nested = (level: number): string => {
        const inner = Array.from({ length: 1 + c.below(3) }, () =>
          level > 1 ? nested(level - 1) : `<${leaves++}>`,
        );
        return `[${inner.join(', ')}]`;
      };
      const template = nested(depth);
      const names = Array.from({ length: leaves }, (_, n) => kind.pool[n % kind.pool.length]!);
      const target = c.below(leaves);
      const commaAfter = template.includes(`<${target}>,`);
      const how = c.below(commaAfter ? 3 : 2);
      const defect = how === 2 ? contained(c.one([' ', ',,'])) : c.one(ELEMENT);
      const value = template.replace(/<(\d+)>(,?)/g, (_, n: string, comma: string) => {
        const leaf = names[Number(n)]!;
        if (Number(n) !== target) return `${leaf}${comma}`;
        if (how === 0) return `${defect.text}${comma}`;
        if (how === 1) return `${leaf} ${defect.text}${comma}`;
        return `${leaf}${defect.text}`;
      });
      const text = `:x ${'['.repeat(depth)}${kind.type}${']'.repeat(depth)} default ${value}`;
      const { result, said, threw } = reading(text, parseProperty);
      expect(threw, text).toBeNull();
      const kept: string[] = [];
      const walk = (literal: Literal | null | undefined): void => {
        if (literal?.kind === 'option-literal') kept.push(literal.name.text);
        else if (literal?.kind === 'integer') kept.push(String(literal.value));
        else if (literal?.kind === 'string') kept.push(`"${literal.value}"`);
        else if (literal?.kind === 'list-literal') literal.elements.forEach(walk);
      };
      walk(result?.default);
      reached.add(defect.sort);
      const good = names.filter((_, n) => n !== target || how !== 0);
      expect(
        explained(
          text,
          defect.sort,
          kept,
          [...new Set(good)],
          [...names, 'Ward', 'Zeta', 'oak'],
          said,
          !stoppedShort(text, result),
        ),
      ).toEqual([]);
    }
    expect(reached.keys()).toEqual(SORTS);
  });
});
