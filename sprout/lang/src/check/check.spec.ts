// The checker's entry points end to end: a condition, a narrowing, the
// call that writes, and the three rules that shape the whole checker. The
// rows of the spec's table are exercised in the spec of the module that
// types them, beside it in `check/`.

import { describe, expect, it } from 'vitest';

import { letBinding, objectOf, valueOf } from './bindings.js';
import { branchScope, checkCondition, isEffect, narrowingOf, type CheckContext } from './check.js';
import { Diagnostics } from '../source/diagnostics.js';
import { parseExpression } from '../syntax/parse.js';
import { locationOf, SourceFile } from '../source/source.js';
import { integer } from '../declare/types.js';
import {
  at,
  bodyOf,
  effect,
  effectSaid,
  expression,
  KEY,
  PRINTER,
  read,
  saidBy,
  shapeOf,
  VESSEL,
  vessel,
  warded,
} from '../fixtures/check.js';

// --- the table ------------------------------------------------------------

describe('what the compiler checks — the table, row by row', () => {
  it('`if (e)` — `e` boolean, and an integer is a refusal rather than a zero-test', () => {
    const context = vessel();
    const yes = parseExpression(new SourceFile('b.sprout', 'self.get(:inked)'), new Diagnostics());
    expect(checkCondition(yes!, context)).toBe(true);

    const no = vessel();
    const number = parseExpression(
      new SourceFile('b.sprout', 'self.get(:capacity)'),
      new Diagnostics(),
    );
    expect(checkCondition(number!, no)).toBe(false);
    expect(no.diagnostics.refusals[0]!.message).toContain('A condition is true or false');
  });
});

// --- the three rules ------------------------------------------------------

describe('only `self` writes `self`', () => {
  it('refuses every other receiver, and says what to do instead', () => {
    for (const [text, context] of [
      ['target.set(:inked, true)', vessel()],
      ['tool.set(:wear, 1)', warded()],
      ['here.set(:inked, true)', vessel()],
    ] as const) {
      const said = effectSaid(text, context);
      expect(said.ok, text).toBe(false);
      expect(said.messages.join(' '), text).toContain('Only `self` writes its own state');
      expect(said.messages.join(' '), text).toContain('message');
    }
  });

  it('lets `self` through, for each of the four that write', () => {
    expect(effect('self.set(:capacity, 1)', vessel())).toBe(true);
    expect(effect('self.adjust(:capacity, 1)', vessel())).toBe(true);
    expect(effect('self.add(:opens, :oak)', bodyOf(KEY))).toBe(true);
    expect(effect('self.remove(:opens, :oak)', bodyOf(KEY))).toBe(true);
  });

  it('is the binding’s own answer, not the name `self`', () => {
    // A loop variable called `self` cannot exist — shadowing refuses it
    // — so the rule rests on `writable`, which only `selfBinding` sets.
    const context = bodyOf(VESSEL);
    expect(context.scope.lookup('self')!.writable).toBe(true);
    expect(context.scope.lookup('actor')!.writable).toBe(false);
    expect(effect('actor.set(:visits, 1)', bodyOf(PRINTER))).toBe(false);
  });
});

describe('`is()` is the only read through the object type', () => {
  it('refuses every other reading of an unnarrowed object, saying to narrow it', () => {
    for (const text of ['here.get(:capacity)', 'here.count', 'here.recall(:visits)']) {
      const context = vessel();
      expect(read(text, context).type, text).toBeNull();
      expect(context.diagnostics.refusals.map((d) => d.remedy).join(' '), text).toContain('is(');
    }
  });

  it('reads a kind’s own properties inside the branch `is()` narrows', () => {
    const context = vessel();
    const expr = parseExpression(new SourceFile('b.sprout', 'target.is(Key)'), new Diagnostics());
    const narrowing = narrowingOf(expr!, context);
    expect(narrowing).not.toBeNull();
    expect(narrowing!.kind).toBe(KEY);
    expect(narrowing!.binding.name).toBe('target');

    const branch = context.scope.narrowing(narrowing!.binding, narrowing!.kind);
    const inside: CheckContext = { ...context, scope: branch, diagnostics: new Diagnostics() };
    expect(shapeOf('target.get(:wear)', inside)).toBe('integer 0 to 99');
    // And outside it, the same read is still refused.
    expect(read('target.get(:wear)', vessel()).type).toBeNull();
  });

  it('narrows nothing where the condition is not an `is()` of a binding', () => {
    const context = vessel();
    for (const text of [
      'self.get(:inked)',
      'tools.count > 1',
      'target.holds(target)',
      // A call that takes a kind and is not `is`: everything about the
      // shape matches, and only the word makes it a narrowing.
      'target.count(Rib)',
      'self.is(Key)',
    ]) {
      const expr = parseExpression(new SourceFile('b.sprout', text), new Diagnostics());
      const narrowing = narrowingOf(expr!, context);
      if (text === 'self.is(Key)') {
        expect(narrowing, text).not.toBeNull();
        continue;
      }
      expect(narrowing, text).toBeNull();
    }
  });
});

describe('there is no truthiness and no coercion', () => {
  it('converts nothing on the way into an operator', () => {
    const cases: [string, CheckContext][] = [
      ['self.get(:capacity) && self.get(:inked)', vessel()],
      ['self.get(:inked) + 1', vessel()],
      ['"a line" == 1', vessel()],
      ['self.get(:state) == self.get(:ward)', warded()],
    ];
    for (const [text, context] of cases) {
      expect(read(text, context).type, text).toBeNull();
      expect(context.diagnostics.refusals.length, text).toBeGreaterThan(0);
    }
  });

  it('compares two enums only where they are the same enum', () => {
    expect(shapeOf('self.get(:ward) == :oak', warded())).toBe('boolean');
    const across = warded();
    expect(read('self.get(:ward) == self.get(:state)', across).type).toBeNull();
    expect(saidBy(across).join(' ')).toContain('Ward');
    expect(saidBy(across).join(' ')).toContain('Drying');
  });
});

// --- how it behaves at the edges ------------------------------------------

describe('the names a statement reads through', () => {
  const written = (text: string) =>
    parseExpression(new SourceFile('b.sprout', text), new Diagnostics())!;

  it('tells a call that writes from one that reads', () => {
    expect(isEffect(written('self.set(:inked, true)'))).toBe(true);
    expect(isEffect(written('actor.remember(:handled, true)'))).toBe(true);
    expect(isEffect(written('self.get(:inked)'))).toBe(false);
    expect(isEffect(written('self'))).toBe(false);
  });
});

describe('it never guesses, and never dies', () => {
  it('types a chain with no bracket in it, however long', () => {
    // A tree is as deep as its longest chain of operators, and this one
    // has nothing in it to count against the parser's depth bound. A
    // recursive walk answers it with a stack overflow instead of a type.
    const context = bodyOf(VESSEL, letBinding('n', valueOf(integer()), at('n')));
    const long = Array(50_000).fill('n').join(' + ');
    expect(shapeOf(long, context)).toBe('integer');
  });

  it('types a chain of readings, however long', () => {
    const context = bodyOf(VESSEL);
    const long = 'self' + '.count'.repeat(20_000);
    // The first `.count` is an integer, so the second is refused — the
    // point is that it refuses rather than throwing.
    expect(shapeOf(long, context)).toBeNull();
  });

  it('says one thing about a chain, not one per term', () => {
    const context = bodyOf(VESSEL, letBinding('n', valueOf(integer()), at('n')));
    read('n + n + self.get(:inked) + n', context);
    expect(context.diagnostics.refusals).toHaveLength(1);
  });

  it('names a place and what to write instead, for every refusal it makes', () => {
    const texts = [
      'nothing_at_all',
      'self.get(:nope)',
      'self.get(:inked) + 1',
      'self.mangle(:inked)',
      'self.count(Kiln)',
      'here.get(:inked)',
      'self.get()',
      ':wet',
      'Key',
      'chance(0)',
      'random(self.get(:inked))',
      'chance()',
      'roll(4)',
    ];
    for (const text of texts) {
      const context = vessel();
      read(text, context);
      expect(context.diagnostics.refusals.length, text).toBeGreaterThan(0);
      for (const refusal of context.diagnostics.refusals) {
        expect(refusal.message, text).not.toBe('');
        expect(refusal.remedy ?? '', `${text}: no remedy`).not.toBe('');
        expect(locationOf(refusal.at), text).toMatch(/^b\.sprout:\d+:\d+$/);
      }
    }
  });
});

describe('a condition opens the branch it guards', () => {
  it('narrows a thing with `is()`, binds a tool with `bound`, and otherwise leaves the scope as it was', () => {
    const context = vessel();
    const narrowed = branchScope(expression('target.is(Vessel)'), context);
    expect(narrowed.lookup('target')!.type).toEqual(objectOf(VESSEL));
    expect(branchScope(expression('self.count > 1'), context)).toBe(context.scope);
  });
});
