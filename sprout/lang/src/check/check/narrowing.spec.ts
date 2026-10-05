// What a condition, holding, says about the names it tests: `x.is(K)` and
// `bound tool`, alone or as operands of `&&`, and nothing under any other
// operator.

import { describe, expect, it } from 'vitest';

import { objectOf } from '../bindings.js';
import { expression, VESSEL, vessel } from '../../fixtures/check.js';
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
