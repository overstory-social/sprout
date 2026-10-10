import { describe, expect, it } from 'vitest';

import type { Expr, Ident, MemberExpr, ObjectPath } from '../syntax/ast.js';
import type { Vantage } from '../declare/names.js';
import { bodyOf, expression, read, saidBy, VESSEL } from '../fixtures/check.js';
import { inKind, nameSource } from '../fixtures/names.js';
import { compileWorld } from '../fixtures/bundle.js';
import { locationOf } from '../source/source.js';
import { showBindingType, type BindingType } from './bindings.js';
import type { CheckContext } from './check.js';
import {
  dottedType,
  identifierType,
  identifiersInReach,
  isMemberPath,
  memberPathType,
  pathSteps,
  placedBinding,
  placedWords,
  type NameScope,
} from './names.js';

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

  it('in a kind’s body, is of the object type where the instance’s place decides it', () => {
    const { context, scope } = writtenAt(inKind(source, 'shop.Lantern'));
    const { expr, shown: type, said } = read('lamp', context);
    expect(said).toEqual([]);
    expect(type).toBe('an object');
    expect(scope.table.get(expr.kind === 'binding' ? expr.name : expr)).toMatchObject({
      names: 'placed',
    });
    expect(read('wick', context).shown).toBe('shop.wick');
  });

  it('in a kind’s body, is read through only where `is()` has narrowed it', () => {
    const { context } = writtenAt(inKind(source, 'shop.Lantern'));
    expect(read('cellar.count', context).said).toEqual([
      '`cellar` is whatever is called that nearest each instance, so Sprout does not know what it is, and cannot count it. Narrow it with `is()` and read it inside the branch, as in `if (cellar.is(Room)) { … }` in a body or `{if cellar.is(Room)}…{/if}` in a passage.',
    ]);
  });

  it('in a kind’s body, is the binding `is()` narrows for its branch, and nowhere else', () => {
    const { context } = writtenAt(inKind(source, 'shop.Lantern'));
    const { expr } = read('lamp', context);
    const ident = expr.kind === 'binding' ? expr.name : null;
    expect(ident).not.toBeNull();
    expect(placedBinding(ident!, context)).toEqual({
      name: 'lamp',
      type: { binds: 'object', kind: null },
      origin: 'name',
      at: ident!.at,
      writable: false,
    });
    // A name the compile fixed is typed already, and a binding hides a name.
    const own = read('wick', context).expr;
    expect(placedBinding(own.kind === 'binding' ? own.name : ident!, context)).toBeNull();
    const bound = read('self', context).expr;
    expect(placedBinding(bound.kind === 'binding' ? bound.name : ident!, context)).toBeNull();
  });

  it('is refused where nothing in reach answers, naming what does', () => {
    const { context } = writtenAt(inKind(source, 'shop.Lantern'));
    const { said, shown: type } = read('wik', context);
    expect(type).toBeNull();
    expect(said).toEqual([
      'Nothing here is called `wik`. Did you mean `wick`? In reach: `self`, `actor`, `here`, `wick`, `hall`, `cellar`, `lamp`, `bench`, `lantern`, `cushion`, `flame` and `shop`.',
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
    const { context, scope } = writtenAt({ in: 'tree', path: ['cellar'] });
    const written = path('hall.bench.cushion');
    expect(shown(dottedType(written, context))).toBe('shop.cushion');
    expect(scope.table.get(written)).toMatchObject({ names: 'declared' });
  });

  it('in a kind’s body, is typed at its kind only where it is the instance’s own', () => {
    const { context, scope } = writtenAt(inKind(source, 'shop.Lantern'));
    expect(shown(dottedType(path('wick.flame'), context))).toBe('shop.flame');
    const placed = path('hall.bench.cushion');
    expect(shown(dottedType(placed, context))).toBe('an object');
    expect(scope.table.get(placed)).toMatchObject({ names: 'placed' });
    expect(shown(dottedType(path('shop.lamp'), context))).toBe('shop.lamp');
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

describe('a dotted path in an expression', () => {
  /** The member readings written on a name, innermost first, and the name. */
  function written(text: string): { first: Ident; members: MemberExpr[]; expr: Expr } {
    const expr = expression(text);
    const members: MemberExpr[] = [];
    let node = expr;
    for (; node.kind === 'member' || node.kind === 'call'; node = node.receiver) {
      if (node.kind === 'member') members.unshift(node);
      else members.length = 0;
    }
    if (node.kind !== 'binding') throw new Error(`\`${text}\` is not written on a name`);
    return { first: node.name, members, expr };
  }

  it('takes each member that names an object declared in the body of the one before', () => {
    const { context } = writtenAt({ in: 'tree', path: ['cellar'] });
    const steps = (text: string) => {
      const { first, members } = written(text);
      return pathSteps(first, members, context);
    };
    expect(steps('hall.bench.cushion')).toBe(2);
    expect(steps('hall.bench.count')).toBe(1);
    expect(steps('hall.bench.cushion.count')).toBe(2);
    // A name with one reading on it, a name nothing answers to, and a binding are not paths.
    expect(steps('hall.count')).toBe(0);
    expect(steps('hal.bench')).toBe(0);
    expect(steps('self.bench')).toBe(0);
    expect(steps('hall')).toBe(0);
  });

  it('reads as the object it names, typed at its kind and recorded at its last step', () => {
    const { context, scope } = writtenAt({ in: 'tree', path: ['cellar'] });
    const { expr, shown: type, said } = read('hall.bench.cushion', context);
    expect(said).toEqual([]);
    expect(type).toBe('shop.cushion');
    expect(scope.table.get(expr)).toMatchObject({
      names: 'declared',
      path: ['hall', 'bench', 'cushion'],
    });
    expect(read('hall.bench.count', context).shown).toBe('integer');
    expect(read('shop.hall.bench.count', context).said).toEqual([]);
  });

  it('in a kind’s body, is typed from the world’s name and the instance’s own, and an object otherwise', () => {
    const { context } = writtenAt(inKind(source, 'shop.Lantern'));
    expect(read('shop.hall.bench', context).shown).toBe('shop.bench');
    expect(read('shop.hall.bench.count', context).said).toEqual([]);
    expect(read('wick.flame', context).shown).toBe('shop.flame');
    expect(read('hall.bench', context).shown).toBe('an object');
  });

  it('refuses a step nothing answers to where a reading cannot stand, as a path written anywhere does', () => {
    const { context } = writtenAt({ in: 'tree', path: [] });
    const { shown: type, said } = read('hall.bench.cushon.count', context);
    expect(type).toBeNull();
    expect(said).toEqual([
      'Nothing in `hall.bench` is called `cushon`. Did you mean `cushion`? Name something written in the body of `hall.bench`.',
    ]);
    const { context: other } = writtenAt({ in: 'tree', path: [] });
    const { first, members } = written('hall.bench.cushon');
    expect(memberPathType(first, members.slice(0, 1), members[1], other)).toBeNull();
    expect(saidBy(other)).toHaveLength(1);
  });

  it('in a kind’s body, is the binding `is()` narrows where the run resolves it, named as written', () => {
    const { context } = writtenAt(inKind(source, 'shop.Lantern'));
    const { expr } = read('hall.bench', context);
    if (expr.kind !== 'member') throw new Error('`hall.bench` is not a member reading');
    expect(placedBinding(expr, context)).toMatchObject({
      name: 'hall.bench',
      type: { binds: 'object', kind: null },
      origin: 'name',
    });
    expect(placedWords(expr, 'count', context)).toEqual({
      message:
        '`hall.bench` is whatever is called that nearest each instance, so Sprout does not know what it is, and cannot count it.',
      remedy:
        'Narrow it with `is()` and read it inside the branch, as in `if (hall.bench.is(Holder)) { … }` in a body or `{if hall.bench.is(Holder)}…{/if}` in a passage.',
    });
    const fixed = read('wick.flame', context).expr;
    if (fixed.kind !== 'member') throw new Error('`wick.flame` is not a member reading');
    expect(placedBinding(fixed, context)).toBeNull();
  });

  it('reads as what `is()` narrowed it to, where a branch holds it', () => {
    const { context } = writtenAt(inKind(source, 'shop.Lantern'));
    const path = read('hall.bench', context).expr;
    if (path.kind !== 'member') throw new Error('`hall.bench` is not a member reading');
    const binding = placedBinding(path, context)!;
    const narrowed = { ...context, scope: context.scope.narrowing(binding, VESSEL) };
    expect(read('hall.bench.get(:inked)', narrowed).said).toEqual([]);
    expect(read('hall.bench', narrowed).shown).toBe('shop.Vessel');
  });

  it('is a path whole only where every member is a step of it', () => {
    const { context } = writtenAt({ in: 'tree', path: [] });
    expect(isMemberPath(expression('hall.bench'), context)).toBe(true);
    expect(isMemberPath(expression('hall.bench.cushion'), context)).toBe(true);
    for (const text of ['hall.bench.count', 'hall.bench.greeting', 'hall', 'self.bench']) {
      expect(isMemberPath(expression(text), context), text).toBe(false);
    }
  });
});

describe('an object another file declares, named in the world’s tree', () => {
  /** A vessel's body at `vantage`, in a world whose files may name only what `nameable` allows. */
  function importing(vantage: Vantage, nameable: (file: string) => boolean): CheckContext {
    const scope: NameScope = {
      source: { ...source, nameable: (file) => nameable(file) },
      vantage,
      world: null,
      table: new Map(),
    };
    return { ...bodyOf(VESSEL), names: scope };
  }

  it('is refused unimported, and says the path from the world that names it', () => {
    const context = importing({ in: 'tree', path: ['hall'] }, () => false);
    const { said, expr } = read('lamp', context);
    const file = expr.at.source.name;
    expect(said).toEqual([
      `\`lamp\` is written in \`shop.sprout\`, and this file does not import it. Name it from the world, as \`shop.hall.lamp\`.`,
    ]);
    expect(file).not.toBe('shop.sprout');
    const dotted = importing({ in: 'tree', path: ['cellar'] }, () => false);
    dottedType(path('hall.bench.cushion'), dotted);
    expect(saidBy(dotted)).toEqual([
      '`hall` is written in `shop.sprout`, and this file does not import it. Name it from the world, as `shop.hall.bench.cushion`.',
    ]);
  });

  it('is taken where the file may name it, from the world, or from a kind’s body', () => {
    expect(
      read(
        'lamp',
        importing({ in: 'tree', path: ['hall'] }, () => true),
      ).said,
    ).toEqual([]);
    const fromWorld = importing({ in: 'tree', path: ['cellar'] }, () => false);
    dottedType(path('shop.hall.lamp'), fromWorld);
    expect(saidBy(fromWorld)).toEqual([]);
    expect(
      read(
        'lamp',
        importing(inKind(source, 'shop.Lantern'), () => false),
      ).said,
    ).toEqual([]);
  });
});

describe('a place reading another place', () => {
  /** The refusals a world of a hall and a yard makes, as line, column and message. */
  function refused(hall: string, world = ''): string[][] {
    const { diagnostics } = compileWorld('yards', {
      'yards.sprout': `world yards is sprout.World {
  visitors are Person
  visitors arrive at hall${world}
  object hall is sprout.Place {
${hall}
    object toy is Toy
    object nook is sprout.Place
  }
  object yard is sprout.Place { :open true }
}
kind Person is sprout.Visitor { }
kind Toy { :new true }
`,
    });
    return diagnostics
      .filter((one) => one.severity === 'refusal')
      .map((one) => [locationOf(one.at), one.message]);
  }

  it('is refused at the name, through `get` and `is`, by a name or a path from the world', () => {
    expect(
      refused(`    grammar { exit north "north" -> yard when (yards.yard.get(:open)) }
    describe { text "A hall.{if yard.is(sprout.Place)} A yard lies north.{/if}" }`),
    ).toEqual([
      [
        'yards.sprout:5:48',
        '`yards.yard` is another place, out of range of `hall`, so `yards.yard.get(…)` can never be read from here: the world lets nothing pass between its places.',
      ],
      [
        'yards.sprout:6:33',
        '`yard` is another place, out of range of `hall`, so `yard.is(…)` can never be read from here: the world lets nothing pass between its places.',
      ],
    ]);
  });

  it('is refused from a place inside a place, of a place under another', () => {
    const { diagnostics } = compileWorld('yards', {
      'yards.sprout': `world yards is sprout.World {
  visitors are Person
  visitors arrive at hall
  object hall is sprout.Place { object nook is sprout.Place { describe { text "{if yard.get(:open)}Open.{/if}" } } }
  object yard is sprout.Place { :open true }
}
kind Person is sprout.Visitor { }
`,
    });
    expect(
      diagnostics.filter((one) => one.severity === 'refusal').map((one) => one.message),
    ).toEqual([
      '`yard` is another place, out of range of `hall.nook`, so `yard.get(…)` can never be read from here: the world lets nothing pass between its places.',
    ]);
  });

  it('is taken of what is in the same place, of a thing that may move, and where the world may pass', () => {
    expect(
      refused(
        `    describe { text "{if nook.is(sprout.Place) && toy.get(:new) && yards.get(:open)}All here.{/if}" }`,
        `
  :open true`,
      ),
    ).toEqual([]);
    expect(
      refused(
        `    describe { text "{if yard.get(:open)}Open.{/if}" }`,
        `
  pass any (self.get(:open))
  :open true`,
      ),
    ).toEqual([]);
  });
});
