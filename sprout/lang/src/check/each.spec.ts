import { describe, expect, it } from 'vitest';

import type { EachStatement } from '../syntax/ast.js';
import { readStatement } from '../fixtures/parse.js';
import { at, bodyOf, KEY, saidBy, vessel, WARDED } from '../fixtures/check.js';
import { letBinding, objectOf, valueOf } from './bindings.js';
import { BOOLEAN } from '../declare/types.js';
import { eachScope } from './each.js';

/** `text`, read as an `each`. */
function each(text: string): EachStatement {
  const { statement, refusals } = readStatement(text);
  expect(refusals, text).toEqual([]);
  if (statement?.kind !== 'each') throw new Error(`${text} is not an each`);
  return statement;
}

describe('what an `each` binds', () => {
  it('binds a walk of what a container holds as an object, or as the kind it filters by', () => {
    const context = vessel();
    const scope = eachScope(each('each thing in self { }'), context);
    expect(scope?.lookup('thing')?.type).toEqual({ binds: 'object', kind: null });
    expect(scope?.lookup('thing')?.origin).toBe('each');
    const filtered = eachScope(each('each k: Key in self { }'), context);
    expect(filtered?.lookup('k')?.type).toEqual(objectOf(KEY));
    expect(saidBy(context)).toEqual([]);
  });

  it('binds each member of a set role at the role’s kind', () => {
    const context = vessel();
    const scope = eachScope(each('each rib of tools { }'), context);
    expect(scope?.lookup('rib')?.type.binds).toBe('object');
    expect(scope?.lookup('rib')?.type).toMatchObject({ kind: { name: 'Rib' } });
    expect(saidBy(context)).toEqual([]);
  });

  it('binds its variable for its body alone, not for what follows it', () => {
    const context = vessel();
    eachScope(each('each thing in self { }'), context);
    expect(context.scope.lookup('thing')).toBeNull();
  });
});

describe('what an `each` refuses to walk', () => {
  it('refuses to walk what holds nothing, with the declaration that would', () => {
    const context = bodyOf(WARDED);
    expect(eachScope(each('each thing in self { }'), context)).toBeNull();
    expect(saidBy(context)).toEqual([
      '`Warded` holds nothing, so there is nothing to walk. Containment is a declaration: a kind that holds things writes `contains`.',
    ]);
  });

  it('refuses a list, which holds values: a passage renders one with `{for … of}`', () => {
    const keys = letBinding('keys', valueOf({ type: 'list', element: BOOLEAN }), at('note'));
    for (const text of ['each k of keys { }', 'each k in keys { }']) {
      const context = bodyOf(WARDED, keys);
      expect(eachScope(each(text), context), text).toBeNull();
      expect(saidBy(context)[0], text).toContain(
        'A list holds values, not things, so nothing walks it with `each`: render it in a passage with `{for … of}`.',
      );
    }
  });

  it('refuses `of` over a thing, and `in` over a set role, saying which word walks it', () => {
    const over = vessel();
    expect(eachScope(each('each thing of self { }'), over)).toBeNull();
    expect(saidBy(over)).toEqual([
      '`each … of` walks a role marked `many`, and this is `Vessel`. To walk what it holds, write `each thing in …`.',
    ]);
    const into = vessel();
    expect(eachScope(each('each rib in tools { }'), into)).toBeNull();
    expect(saidBy(into)[0]).toMatch(
      /^`each … in` walks what a thing holds, and this is .*Walk a role marked `many` with `each rib of …`\.$/,
    );
  });

  it('refuses to walk a thing of the object type until it is narrowed', () => {
    const context = vessel();
    expect(eachScope(each('each thing in target { }'), context)).toBeNull();
    expect(saidBy(context)[0]).toContain('Sprout does not know whether this holds anything.');
  });

  it('refuses a filter naming no kind, and a variable that shadows a name in scope', () => {
    const unknown = vessel();
    expect(eachScope(each('each pot: Teapot in self { }'), unknown)).toBeNull();
    expect(saidBy(unknown)).toHaveLength(1);
    const shadow = vessel();
    expect(eachScope(each('each target in self { }'), shadow)).toBeNull();
    expect(saidBy(shadow)).toHaveLength(1);
  });
});
