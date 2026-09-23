import { describe, expect, it } from 'vitest';

import type { ObjectPath } from '../syntax/ast.js';
import type { Vantage } from '../declare/names.js';
import { bodyOf, read, VESSEL } from '../fixtures/check.js';
import { nameSource } from '../fixtures/names.js';
import { showBindingType, type BindingType } from './bindings.js';
import type { CheckContext } from './check.js';
import { dottedType, identifierType, identifiersInReach, type NameScope } from './names.js';

const source = nameSource();

/** A vessel's body written at `vantage`, its names recorded in the scope returned. */
function writtenAt(vantage: Vantage): { context: CheckContext; scope: NameScope } {
  const scope: NameScope = { source, vantage, world: null, table: new Map() };
  return { context: { ...bodyOf(VESSEL), names: scope }, scope };
}

/** A path as written, spanned over its own text. */
function path(text: string): ObjectPath {
  const expr = read(text.split('.')[0]!, bodyOf(VESSEL)).expr;
  const at = expr.at;
  return {
    kind: 'path',
    at,
    parts: text.split('.').map((part) => ({ kind: 'ident', at, text: part })),
  };
}

const shown = (type: BindingType | null): string | null =>
  type === null ? null : showBindingType(type);

describe('an identifier in a body', () => {
  it('names an object in reach, typed at its kind, and is recorded for the runtime', () => {
    const { context, scope } = writtenAt({ in: 'tree', path: ['hall'] });
    const { expr, shown: type, said } = read('lamp', context);
    expect(said).toEqual([]);
    expect(type).toBe('shop.lamp');
    expect(scope.table.get(expr.kind === 'binding' ? expr.name : expr)).toMatchObject({
      names: 'declared',
      path: ['hall', 'lamp'],
    });
  });

  it('is hidden by a binding of its name, which is what the name means here', () => {
    const { context } = writtenAt({ in: 'tree', path: ['hall'] });
    expect(read('self', context).shown).toBe('shop.Vessel');
  });

  it('reads a property through its kind without `is()`', () => {
    const { context } = writtenAt({ in: 'tree', path: [] });
    expect(read('cellar.count', context).said).toEqual([]);
  });

  it('is refused where nothing in reach answers, naming what does', () => {
    const { context } = writtenAt({ in: 'kind', giver: 'shop.Lantern', path: [] });
    const { said, shown: type } = read('wik', context);
    expect(type).toBeNull();
    expect(said).toEqual([
      'Nothing here is called `wik`. Did you mean `wick`? In reach: `self`, `actor`, `here`, `wick`, `hall`, `cellar`, `lamp` and `shop`.',
    ]);
    expect(identifiersInReach(context)).toContain('wick');
  });

  it('is nothing at all where the body has nowhere to resolve from', () => {
    const context = bodyOf(VESSEL);
    const ident = { kind: 'ident' as const, at: read('lamp', context).expr.at, text: 'lamp' };
    expect(identifierType(ident, context)).toBeNull();
  });
});

describe('a dotted path in a body', () => {
  it('names what the last step reaches, and is recorded at the path', () => {
    const { context, scope } = writtenAt({ in: 'kind', giver: 'shop.Lantern', path: [] });
    const written = path('hall.bench.cushion');
    expect(shown(dottedType(written, context))).toBe('shop.cushion');
    expect(scope.table.get(written)).toMatchObject({ names: 'declared' });
    expect(shown(dottedType(path('wick.flame'), context))).toBe('shop.flame');
  });

  it('refuses a step nothing answers to, and the world’s name as a later step', () => {
    const { context } = writtenAt({ in: 'tree', path: [] });
    expect(dottedType(path('hall.stool'), context)).toBeNull();
    expect(dottedType(path('hall.shop'), context)).toBeNull();
    expect(context.diagnostics.refusals.map((d) => [d.message, d.remedy])).toEqual([
      ['Nothing in `hall` is called `stool`.', 'Name something written in the body of `hall`.'],
      [
        "`shop` is the world, whose name may be a path's first step and no other.",
        "Leave the world's name out of the middle: write `hall`.",
      ],
    ]);
  });
});
