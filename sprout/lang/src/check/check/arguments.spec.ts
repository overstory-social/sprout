// What a reading or a write is given: how many things, the property it
// names and the kind it names.

import { describe, expect, it } from 'vitest';

import { Diagnostics } from '../../source/diagnostics.js';
import { parseExpression } from '../../syntax/parse.js';
import { locationOf, SourceFile } from '../../source/source.js';
import { call, expression, KEY, saidBy, vessel } from '../../fixtures/check.js';
import { arity, count, propertyName, resolveKind } from './arguments.js';

describe('the names a statement reads through', () => {
  const written = (text: string) =>
    parseExpression(new SourceFile('b.sprout', text), new Diagnostics())!;

  it('resolves a kind as written, and refuses one nothing declares or that is no kind', () => {
    const context = vessel();
    expect(resolveKind(written('Key'), context)).toBe(KEY);
    expect(resolveKind(written('sprout.Container'), context)!.library).toBe('sprout');
    expect(resolveKind(written('Kiln'), context)).toBeNull();
    expect(resolveKind(written('self'), context)).toBeNull();
    expect(saidBy(context)).toEqual([
      'Nothing here is a `Kiln`. Write a kind this world declares, or one a library it uses exports.',
      'This names a kind, which starts with a capital letter. Write the kind, as in `Key` or `sprout.Container`.',
    ]);
  });
});

describe('what a call is given, asked directly', () => {
  it('counts as a sentence says it', () => {
    expect(count(1)).toBe('one thing');
    expect(count(0)).toBe('0 things');
    expect(count(2)).toBe('2 things');
  });

  it('takes exactly as many things as a call is given, and refuses at the word', () => {
    const context = vessel();
    const get = call('self.get(:inked, 1)');
    expect(arity(get.method, get.arguments, 2, context)).toBe(true);
    expect(arity(get.method, get.arguments, 1, context)).toBe(false);
    const set = call('self.set(:inked)');
    expect(arity(set.method, set.arguments, 2, context)).toBe(false);
    expect(saidBy(context)).toEqual([
      '`get` is given one thing, and this gives it 2 things. Write `get(…)` with one thing in the brackets.',
      '`set` is given 2 things, and this gives it one thing. Write `set(…, …)` with two.',
    ]);
    expect(locationOf(context.diagnostics.refusals[0]!.at)).toBe('b.sprout:1:6');
  });

  it('reads a property named with a colon, and refuses one without', () => {
    const context = vessel();
    expect(propertyName(expression(':wear'), context)!.text).toBe('wear');
    expect(propertyName(expression('wear'), context)).toBeNull();
    expect(saidBy(context)).toEqual([
      'This names the property to read, and that is written with a colon. Write `:wear`, naming the property.',
    ]);
  });

  it('resolves a kind qualified by its library', () => {
    const context = vessel();
    expect(resolveKind(expression('shop.Key'), context)).toBe(KEY);
    expect(resolveKind(expression('shop.Kiln'), context)).toBeNull();
    expect(saidBy(context).join(' ')).toContain('Nothing here is a `shop.Kiln`.');
  });
});
