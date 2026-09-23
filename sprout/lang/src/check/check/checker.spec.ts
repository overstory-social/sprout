// The checker's context: it reads the body it was made over, and its
// `typeOf` keeps every recursion inside the one checker.

import { describe, expect, it } from 'vitest';

import type { Expr } from '../../syntax/ast.js';
import { valueOf } from '../bindings.js';
import { BOOLEAN } from '../../declare/types.js';
import { expression, vessel } from '../../fixtures/check.js';
import { checkerOf, type Checker } from './checker.js';

describe('a checker', () => {
  it('reads the body it was made over: the same scope, kinds, self and diagnostics', () => {
    const context = vessel();
    const checker = checkerOf(context, () => null);
    expect(checker.scope).toBe(context.scope);
    expect(checker.kinds).toBe(context.kinds);
    expect(checker.from).toBe(context.from);
    expect(checker.self).toBe(context.self);
    expect(checker.diagnostics).toBe(context.diagnostics);
  });

  it('hands the walk itself, so a recursion never leaves the one checker', () => {
    const seen: [Expr, Checker][] = [];
    const checker = checkerOf(vessel(), (expr, by) => {
      seen.push([expr, by]);
      return valueOf(BOOLEAN);
    });
    const written = expression('true');
    expect(checker.typeOf(written)).toEqual(valueOf(BOOLEAN));
    expect(seen).toHaveLength(1);
    expect(seen[0]![0]).toBe(written);
    expect(seen[0]![1]).toBe(checker);
  });

  it('walks by the walk it was made with, not one it was made from', () => {
    const first = checkerOf(vessel(), () => null);
    const second = checkerOf(first, () => valueOf(BOOLEAN));
    expect(second.typeOf(expression('true'))).toEqual(valueOf(BOOLEAN));
    expect(second.diagnostics).toBe(first.diagnostics);
  });
});
