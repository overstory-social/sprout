// What a condition, holding, says about the names it tests: `x.is(K)` and
// `bound tool`, alone or as operands of `&&`, and nothing under any other
// operator.

import { describe, expect, it } from 'vitest';

import { objectOf } from '../bindings.js';
import { bodyOf, expression, read, VESSEL, vessel } from '../../fixtures/check.js';
import { inKind, nameSource } from '../../fixtures/names.js';
import type { CheckContext } from './checker.js';
import { branchScope, heldScope, isAnd, narrowingOf } from './narrowing.js';

describe('one operand', () => {
  it('`x.is(K)` narrows the binding it tests to the kind it names', () => {
    const context = vessel();
    const narrowing = narrowingOf(expression('target.is(Vessel)'), context);
    expect(narrowing).toMatchObject({ kind: VESSEL, binding: { name: 'target' } });
    expect(heldScope(expression('target.is(Vessel)'), context).lookup('target')!.type).toEqual(
      objectOf(VESSEL),
    );
  });

  it('anything else narrows nothing, and leaves the scope as it was', () => {
    const context = vessel();
    for (const text of ['self.count > 1', '!target.is(Vessel)', 'target.is(Nowhere)', 'true']) {
      expect(narrowingOf(expression(text), context), text).toBeNull();
      expect(heldScope(expression(text), context), text).toBe(context.scope);
    }
  });
});

describe('a dotted path in a kind’s body', () => {
  /** A vessel's body written in a lantern's, where `hall.bench` is whatever is so called nearest each instance. */
  function inLantern(): CheckContext {
    const source = nameSource();
    return {
      ...bodyOf(VESSEL),
      names: { source, vantage: inKind(source, 'shop.Lantern'), world: null, table: new Map() },
    };
  }

  it('narrows as a name does, bound by the path as written', () => {
    const context = inLantern();
    const condition = read('hall.bench.is(Vessel)', context).expr;
    expect(narrowingOf(condition, context)).toMatchObject({
      kind: VESSEL,
      binding: { name: 'hall.bench', origin: 'name' },
    });
    const branch = branchScope(condition, context);
    expect(branch.lookup('hall.bench')!.type).toEqual(objectOf(VESSEL));
    expect(context.scope.lookup('hall.bench')).toBeNull();
  });

  it('narrows nothing for a path the compile fixed, which is typed already', () => {
    const context = inLantern();
    for (const text of ['shop.hall.bench.is(Vessel)', 'wick.flame.is(Vessel)']) {
      const condition = read(text, context).expr;
      expect(narrowingOf(condition, context), text).toBeNull();
    }
  });
});

describe('a condition', () => {
  it('says, for its branch, what every operand of its `&&`s says, wherever it is written', () => {
    for (const text of [
      'target.is(Vessel)',
      'target.is(Vessel) && self.count > 1',
      'self.count > 1 && target.is(Vessel)',
      'self.count > 1 && target.is(Vessel) && self.count > 2',
    ]) {
      const context = vessel();
      const branch = branchScope(expression(text), context);
      expect(branch.lookup('target')!.type, text).toEqual(objectOf(VESSEL));
      expect(context.scope.lookup('target')!.type, text).not.toEqual(objectOf(VESSEL));
    }
  });

  it('says nothing through `||` or `!`, which do not hold their operands', () => {
    const context = vessel();
    for (const text of ['target.is(Vessel) || self.count > 1', '!(target.is(Vessel) && true)']) {
      expect(branchScope(expression(text), context), text).toBe(context.scope);
    }
  });

  it('walks a chain of `&&` however long, without recursing down it', () => {
    const context = vessel();
    const long = [...Array<string>(50_000).fill('true'), 'target.is(Vessel)'].join(' && ');
    expect(branchScope(expression(long), context).lookup('target')!.type).toEqual(objectOf(VESSEL));
  });

  it('knows `&&` from every other operator', () => {
    expect(isAnd(expression('true && false'))).toBe(true);
    for (const text of ['true || false', '1 < 2', '!true', 'target.is(Vessel)']) {
      expect(isAnd(expression(text)), text).toBe(false);
    }
  });
});
