import { describe, expect, it } from 'vitest';

import { letBinding, loopBinding, roleBinding, showBindingType, valueOf } from './bindings.js';
import { ACTOR } from '../declare/actors.js';
import {
  bindingType,
  checkCondition,
  checkEffectCall,
  isEffect,
  narrowingOf,
  resolveKind,
  typeOf,
  type CheckContext,
} from './check.js';
import { Diagnostics } from '../source/diagnostics.js';
import { parseExpression } from '../syntax/parse.js';
import { locationOf, SourceFile } from '../source/source.js';
import { integer } from '../declare/types.js';
import { at, bodyOf, KEY, PRINTER, saidBy, VESSEL, vessel, warded } from '../fixtures/check.js';

/** Read an expression and ask what it is. The parse must succeed first. */
function read(text: string, context: CheckContext) {
  const parsing = new Diagnostics();
  const expr = parseExpression(new SourceFile('b.sprout', text), parsing);
  expect(
    parsing.refusals.map((d) => d.message),
    `\`${text}\` did not parse`,
  ).toEqual([]);
  expect(expr, text).not.toBeNull();
  const type = typeOf(expr!, context);
  return {
    expr: expr!,
    type,
    shown: type === null ? null : showBindingType(type),
    said: context.diagnostics.all.map((d) => `${d.message} ${d.remedy ?? ''}`.trim()),
    diagnostics: context.diagnostics,
  };
}

/** What an expression is, in a body that has everything it needs. */
function shapeOf(text: string, context: CheckContext = bodyOf(VESSEL)): string | null {
  return read(text, context).shown;
}

// --- the table ------------------------------------------------------------

describe('what the compiler checks — the table, row by row', () => {
  it('`a == b`, `a != b` — same type', () => {
    expect(shapeOf('self.get(:inked) == self.get(:inked)')).toBe('boolean');
    expect(shapeOf('self.get(:capacity) != 4')).toBe('boolean');
    const mixed = read('self.get(:inked) == 4', vessel());
    expect(mixed.type).toBeNull();
    expect(mixed.said.join(' ')).toContain('compares boolean with integer');
  });

  it('`a == b`, `a != b` — not a list, refused at the left list', () => {
    const eq = read('self.get(:row) == self.get(:row)', warded());
    expect(eq.type).toBeNull();
    expect(eq.said).toEqual([
      'Two lists are not compared with `==`. Ask what a list holds instead: `self.get(:opens).includes(:oak)`, or compare its `count`.',
    ]);
    expect(locationOf(eq.diagnostics.refusals[0]!.at)).toBe('b.sprout:1:1');

    const neq = read('self.get(:row) != self.get(:row)', warded());
    expect(neq.type).toBeNull();
    expect(neq.said.join(' ')).toContain('Two lists are not compared with `!=`.');
    expect(locationOf(neq.diagnostics.refusals[0]!.at)).toBe('b.sprout:1:1');

    // A list of lists is still a list.
    const grid = read('self.get(:grid) == self.get(:grid)', warded());
    expect(grid.type).toBeNull();
    expect(grid.said.join(' ')).toContain('Two lists are not compared with `==`.');

    // What a list holds, and how many, are not lists themselves.
    expect(shapeOf('self.get(:row).count == 2', warded())).toBe('boolean');
    expect(shapeOf('tool.get(:opens).includes(:oak)', warded())).toBe('boolean');
  });

  it('`a == b` — a list against something else is a type mismatch, not the list refusal', () => {
    // The list-specific refusal is only for two lists of the same type;
    // a list against anything else falls through to the ordinary
    // "compares X with Y" mismatch, at the whole comparison.
    const withInteger = read('self.get(:row) == 4', warded());
    expect(withInteger.type).toBeNull();
    expect(withInteger.said.join(' ')).toContain('This compares [Ward] with integer.');
    expect(locationOf(withInteger.diagnostics.refusals[0]!.at)).toBe('b.sprout:1:1');

    const withObject = read('self.get(:row) == tool', warded());
    expect(withObject.type).toBeNull();
    expect(withObject.said.join(' ')).toContain('This compares [Ward] with shop.Key.');

    const withString = read('self.get(:row) == self.get(:note)', warded());
    expect(withString.type).toBeNull();
    expect(withString.said.join(' ')).toContain('This compares [Ward] with string.');

    // Exactly one refusal per comparison, not the list message too.
    for (const result of [withInteger, withObject, withString]) {
      expect(result.diagnostics.refusals).toHaveLength(1);
      expect(result.said.join(' ')).not.toContain('Two lists are not compared');
    }
  });

  it('`a == b` — a symbol literal must be one of the operand’s options', () => {
    expect(shapeOf('self.get(:state) == :wet', warded())).toBe('boolean');
    const wrong = read('self.get(:state) == :slver', warded());
    expect(wrong.type).toBeNull();
    // The one check an enum exists for: named options, not a comparison
    // that is false for ever.
    expect(wrong.said.join(' ')).toContain('`Drying` has no option `slver`');
    expect(wrong.said.join(' ')).toContain('wet, cured');
  });

  it('`a == b` — a symbol literal on the left is checked against the right, the same as on the right', () => {
    expect(shapeOf(':wet == self.get(:state)', warded())).toBe('boolean');
    expect(shapeOf(':wet != self.get(:state)', warded())).toBe('boolean');

    const leftWrong = read(':slver == self.get(:state)', warded());
    const rightWrong = read('self.get(:state) == :slver', warded());
    expect(leftWrong.type).toBeNull();
    expect(leftWrong.said).toEqual(rightWrong.said);
    expect(locationOf(leftWrong.diagnostics.refusals[0]!.at)).toBe('b.sprout:1:1');

    const leftWrongNeq = read(':slver != self.get(:state)', warded());
    expect(leftWrongNeq.type).toBeNull();
    expect(leftWrongNeq.said).toEqual(rightWrong.said);

    const leftAgainstNonEnum = read(':wet == 4', warded());
    const rightAgainstNonEnum = read('4 == :wet', warded());
    expect(leftAgainstNonEnum.type).toBeNull();
    expect(leftAgainstNonEnum.said).toEqual(rightAgainstNonEnum.said);

    // Neither side names an enum on its own, whichever side it is on.
    const bothLiterals = read(':wet == :dry', warded());
    expect(bothLiterals.type).toBeNull();
    expect(bothLiterals.said.join(' ')).toContain(
      'Neither side of this says which enum its option belongs to.',
    );
  });

  it('`< <= > >=` — both integer', () => {
    expect(shapeOf('self.get(:capacity) > 1')).toBe('boolean');
    expect(shapeOf('1 <= self.get(:capacity)')).toBe('boolean');
    const wrong = read('self.get(:inked) < 1', vessel());
    expect(wrong.type).toBeNull();
    expect(wrong.said.join(' ')).toContain('`<` reads integer, and this is boolean');
  });

  it('`a == b`, `a != b` — an integer literal outside the other operand’s range is always decided', () => {
    // `:capacity` is declared `4 min 0 max 9`.
    const eq = read('self.get(:capacity) == 12', vessel());
    expect(eq.type).toBeNull();
    expect(eq.said).toEqual([
      '12 is outside 0 to 9, so this is always false. Write a whole number from 0 to 9, or take the comparison out.',
    ]);
    expect(locationOf(eq.diagnostics.refusals[0]!.at)).toBe('b.sprout:1:24');

    // The literal on the left is refused the same way, at itself.
    const eqLeft = read('12 == self.get(:capacity)', vessel());
    expect(eqLeft.type).toBeNull();
    expect(eqLeft.said).toEqual(eq.said);
    expect(locationOf(eqLeft.diagnostics.refusals[0]!.at)).toBe('b.sprout:1:1');

    const neq = read('self.get(:capacity) != 12', vessel());
    expect(neq.type).toBeNull();
    expect(neq.said.join(' ')).toContain('12 is outside 0 to 9, so this is always true.');

    // A negated literal is a written number too.
    const negated = read('-1 == self.get(:capacity)', vessel());
    expect(negated.type).toBeNull();
    expect(negated.said.join(' ')).toContain('-1 is outside 0 to 9, so this is always false.');
  });

  it('`a == b` — a literal at either end of the range is untouched', () => {
    expect(shapeOf('self.get(:capacity) == 9')).toBe('boolean');
    expect(shapeOf('self.get(:capacity) == 0')).toBe('boolean');
  });

  it('`a == b` — a full-range integer against any literal is untouched', () => {
    const withLet = bodyOf(VESSEL, letBinding('n', valueOf(integer()), at('n')));
    expect(shapeOf('n == 1000000', withLet)).toBe('boolean');
    expect(shapeOf('self.get(:row).count == 1000000', warded())).toBe('boolean');
  });

  it('`a == b` — two operands with no declared range are untouched', () => {
    expect(shapeOf('self.get(:capacity) == self.get(:capacity)')).toBe('boolean');
  });

  it('`a == b` — a literal against a mismatched type keeps its one type-mismatch refusal', () => {
    const mixed = read('"a" == 12', vessel());
    expect(mixed.type).toBeNull();
    expect(mixed.diagnostics.refusals).toHaveLength(1);
    expect(mixed.said.join(' ')).toContain('This compares string with integer.');
  });

  it('`< <= > >=` — an integer literal outside the other operand’s range is always decided', () => {
    const above = read('self.get(:capacity) < 12', vessel());
    expect(above.type).toBeNull();
    expect(above.said.join(' ')).toContain('12 is outside 0 to 9, so this is always true.');

    const aboveLe = read('self.get(:capacity) <= 12', vessel());
    expect(aboveLe.said.join(' ')).toContain('12 is outside 0 to 9, so this is always true.');

    const aboveGt = read('self.get(:capacity) > 12', vessel());
    expect(aboveGt.said.join(' ')).toContain('12 is outside 0 to 9, so this is always false.');

    const aboveGe = read('self.get(:capacity) >= 12', vessel());
    expect(aboveGe.said.join(' ')).toContain('12 is outside 0 to 9, so this is always false.');

    const below = read('self.get(:capacity) < -1', vessel());
    expect(below.said.join(' ')).toContain('-1 is outside 0 to 9, so this is always false.');

    const belowLe = read('self.get(:capacity) <= -1', vessel());
    expect(belowLe.said.join(' ')).toContain('-1 is outside 0 to 9, so this is always false.');

    const belowGt = read('self.get(:capacity) > -1', vessel());
    expect(belowGt.said.join(' ')).toContain('-1 is outside 0 to 9, so this is always true.');

    const belowGe = read('self.get(:capacity) >= -1', vessel());
    expect(belowGe.said.join(' ')).toContain('-1 is outside 0 to 9, so this is always true.');

    // A literal on the left flips which end of the range decides it.
    const literalLeft = read('12 < self.get(:capacity)', vessel());
    expect(literalLeft.said.join(' ')).toContain('12 is outside 0 to 9, so this is always false.');
  });

  it('`< <= > >=` — a literal within the range is untouched', () => {
    expect(shapeOf('self.get(:capacity) < 5')).toBe('boolean');
    expect(shapeOf('5 <= self.get(:capacity)')).toBe('boolean');
  });

  it('`+ -`, unary `-` — integer', () => {
    expect(shapeOf('self.get(:capacity) + 1')).toBe('integer');
    expect(shapeOf('self.get(:capacity) - 1')).toBe('integer');
    expect(shapeOf('-self.get(:capacity)')).toBe('integer');
    expect(read('-self.get(:inked)', vessel()).type).toBeNull();
  });

  it('`&& || !` — operands boolean, with no truthiness and no coercion', () => {
    expect(shapeOf('self.get(:inked) && self.get(:inked)')).toBe('boolean');
    expect(shapeOf('!self.get(:inked)')).toBe('boolean');
    for (const text of ['1 && self.get(:inked)', 'self.get(:inked) || 0', '!1']) {
      const wrong = read(text, vessel());
      expect(wrong.type, text).toBeNull();
      expect(wrong.said.join(' '), text).toMatch(/truthiness|number/);
    }
  });

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

  it('`self.set(:p, e)` — `e` is `p`’s declared type', () => {
    expect(effect('self.set(:inked, true)', vessel())).toBe(true);
    expect(effect('self.set(:state, :cured)', warded())).toBe(true);
    expect(effect('self.set(:note, "a line")', warded())).toBe(true);
    expect(effect('self.set(:inked, 1)', vessel())).toBe(false);
  });

  it('`self.set(:p, e)` — an integer within its range, where the compiler can tell', () => {
    expect(effect('self.set(:capacity, 9)', vessel())).toBe(true);
    expect(effect('self.set(:capacity, 0)', vessel())).toBe(true);

    const over = vessel();
    expect(effect('self.set(:capacity, 10)', over)).toBe(false);
    expect(over.diagnostics.refusals[0]!.message).toBe('10 is outside 0 to 9.');
    expect(effect('self.set(:capacity, -1)', vessel())).toBe(false);

    // And where it cannot tell, it says nothing: a value read at run
    // time carries the whole range, and the runtime faults.
    expect(effect('self.set(:capacity, self.get(:capacity) + 1)', vessel())).toBe(true);
  });

  it('`self.adjust(:p, e)` — both integer; the step is not bound by the range', () => {
    expect(effect('self.adjust(:capacity, 1)', vessel())).toBe(true);
    // The RESULT is clamped rather than refused, so a step outside the
    // property's own range is ordinary.
    expect(effect('self.adjust(:capacity, -50)', vessel())).toBe(true);
    expect(effect('self.adjust(:inked, 1)', vessel())).toBe(false);
  });

  it('`self.add(:p, e)`, `self.remove(:p, e)` — `p` a list, `e` its element type', () => {
    expect(effect('self.add(:opens, :silver)', bodyOf(KEY))).toBe(true);
    expect(effect('self.remove(:opens, :oak)', bodyOf(KEY))).toBe(true);

    const wrongOption = bodyOf(KEY);
    expect(effect('self.add(:opens, :brass)', wrongOption)).toBe(false);
    expect(wrongOption.diagnostics.refusals[0]!.message).toContain('`Ward` has no option `brass`');

    const notAList = bodyOf(KEY);
    expect(effect('self.add(:wear, 1)', notAList)).toBe(false);
    expect(notAList.diagnostics.refusals[0]!.message).toContain('changes a list');
  });

  it('`self.add(:p, e)`, `self.remove(:p, e)` — a list of lists takes a whole list', () => {
    // A list's element type may itself be a list, and the only
    // expression of list type is a `get` of a list property.
    expect(effect('self.add(:grid, self.get(:row))', warded())).toBe(true);
    expect(effect('self.remove(:grid, self.get(:row))', warded())).toBe(true);

    const wrong = warded();
    expect(effect('self.add(:grid, self.get(:ward))', wrong)).toBe(false);
    expect(wrong.diagnostics.refusals[0]!.message).toBe('This holds [Ward], and Ward is not one.');
  });

  it('`x.get(:p)` — `p` declared on `x`’s type', () => {
    expect(shapeOf('self.get(:capacity)')).toBe('integer 0 to 9');
    expect(shapeOf('tool.get(:wear)', warded())).toBe('integer 0 to 99');
    expect(shapeOf('tool.get(:opens)', warded())).toBe('[Ward]');

    const missing = vessel();
    expect(read('self.get(:inkd)', missing).type).toBeNull();
    expect(saidBy(missing).join(' ')).toContain('Did you mean `:inked`?');
  });

  it('`x.get(:p)` — `x` is not of object type', () => {
    const open = vessel();
    const refused = read('here.get(:capacity)', open);
    expect(refused.type).toBeNull();
    expect(refused.said.join(' ')).toContain('Narrow it first');
  });

  it('`x.recall(:p)` — `x` composes `sprout.Actor`, `p` in `self`’s `:remembers`', () => {
    expect(shapeOf('actor.recall(:visits)', bodyOf(PRINTER))).toBe('integer 0 to 99');
    expect(effect('actor.remember(:handled, true)', bodyOf(PRINTER))).toBe(true);
    expect(effect('actor.adjust(:visits, 1)', bodyOf(PRINTER))).toBe(true);

    const notActor = bodyOf(PRINTER);
    expect(read('self.get(:capacity)', bodyOf(VESSEL)).type).not.toBeNull();
    expect(read('actor.recall(:capacity)', notActor).type).toBeNull();
    expect(saidBy(notActor).join(' ')).toContain('remembers nothing called `:capacity`');
  });

  it('`x.recall(:p)` — refuses a receiver that is not an actor, by name', () => {
    const notActor = bodyOf(
      VESSEL,
      roleBinding('tool', { role: 'kind', kind: KEY }, null, at('tool'), new Diagnostics())!,
    );
    expect(read('tool.recall(:visits)', notActor).type).toBeNull();
    expect(saidBy(notActor).join(' ')).toContain('`shop.Key` is not someone');
    expect(saidBy(notActor).join(' ')).toContain(ACTOR);
  });

  it('`x.recall(:p)` — `p` is in SELF’s `:remembers`, never the receiver’s', () => {
    // `actor` is a Printer, which remembers `:visits`. Asked from
    // inside a Vessel, which remembers nothing, it is still refused:
    // memory is keyed to the object that declared it, and no object
    // reads another object's memory of anyone.
    const fromVessel = bodyOf(VESSEL);
    expect(read('actor.recall(:visits)', fromVessel).type).toBeNull();
    expect(saidBy(fromVessel).join(' ')).toContain('remembers nothing called `:visits`');

    // The same reading, from inside the kind that declared it, is fine.
    expect(shapeOf('actor.recall(:visits)', bodyOf(PRINTER))).toBe('integer 0 to 99');
  });

  it('`x.remember(:p, e)` — the same rule, and the same refusal', () => {
    const fromVessel = bodyOf(VESSEL);
    expect(effect('actor.remember(:handled, true)', fromVessel)).toBe(false);
    expect(saidBy(fromVessel).join(' ')).toContain('remembers nothing called `:handled`');
  });

  it('nothing but `remember` writes memory, for any of the four that write', () => {
    // The line `get` draws: a `set` that reached memory would write one
    // object's idea of everybody at once.
    for (const text of [
      'self.set(:visits, 5)',
      'self.adjust(:visits, 1)',
      'self.add(:seen, :silver)',
      'self.remove(:seen, :oak)',
    ]) {
      const context = bodyOf(PRINTER);
      expect(effect(text, context), text).toBe(false);
      expect(saidBy(context).join(' '), text).toContain('remembered about each actor');
      expect(saidBy(context).join(' '), text).toContain('remember');
    }
    // And the word that does write memory still does.
    expect(effect('actor.remember(:visits, 5)', bodyOf(PRINTER))).toBe(true);
  });

  it('sends `adjust` to `adjust`, not to `remember`, which would lose the step', () => {
    // Stepping by one is not overwriting with one. An author who
    // follows the remedy literally must end up with what they asked
    // for, so only `adjust` is told to step it on the actor.
    const stepping = bodyOf(PRINTER);
    expect(effect('self.adjust(:visits, 1)', stepping)).toBe(false);
    expect(saidBy(stepping).join(' ')).toContain('actor.adjust(:visits');
    // The remedy, not the message — which says "remembered about each
    // actor" and so contains the word either way.
    expect(stepping.diagnostics.refusals[0]!.remedy).not.toContain('remember');

    const writing = bodyOf(PRINTER);
    expect(effect('self.set(:visits, 1)', writing)).toBe(false);
    expect(saidBy(writing).join(' ')).toContain('actor.remember(:visits');

    // The reading it points at is the one that works.
    expect(effect('actor.adjust(:visits, 1)', bodyOf(PRINTER))).toBe(true);
  });

  it('`get` does not read memory, and says which word does', () => {
    const context = bodyOf(PRINTER);
    expect(read('self.get(:visits)', context).type).toBeNull();
    expect(saidBy(context).join(' ')).toContain('remembered about each actor');
    expect(saidBy(context).join(' ')).toContain('recall');
  });

  it('`recall` does not read a property the object holds, and says which word does', () => {
    const context = bodyOf(PRINTER);
    expect(read('actor.recall(:capacity)', context).type).toBeNull();
    expect(saidBy(context).join(' ')).toContain('remembers nothing called `:capacity`');
  });

  it('`x.includes(e)` — `x` a list or a set role, `e` its element type', () => {
    expect(shapeOf('tool.get(:opens).includes(:oak)', warded())).toBe('boolean');
    expect(shapeOf('tools.includes(target)', vessel())).toBe('boolean');

    const wrong = warded();
    expect(read('tool.get(:opens).includes(:wet)', wrong).type).toBeNull();
    expect(saidBy(wrong).join(' ')).toContain('`Ward` has no option `wet`');
  });

  it('`x.includes(e)` — a list of lists is asked after a whole list', () => {
    expect(shapeOf('self.get(:grid).includes(self.get(:row))', warded())).toBe('boolean');

    const wrong = warded();
    expect(read('self.get(:grid).includes(self.get(:ward))', wrong).type).toBeNull();
    expect(saidBy(wrong).join(' ')).toContain('This holds [Ward], and Ward is not one.');
  });

  it('`x.count`, `x.count(K)` — `x` a container or a set role', () => {
    expect(shapeOf('self.count', vessel())).toBe('integer');
    expect(shapeOf('tools.count', vessel())).toBe('integer');
    expect(shapeOf('tools.count(Rib)', vessel())).toBe('integer');
    expect(shapeOf('self.count(Rib)', vessel())).toBe('integer');

    const notContainer = warded();
    expect(read('self.count', notContainer).type).toBeNull();
    expect(saidBy(notContainer).join(' ')).toContain('holds nothing');

    const noSuchKind = vessel();
    expect(read('self.count(Kiln)', noSuchKind).type).toBeNull();
    expect(saidBy(noSuchKind).join(' ')).toContain('Nothing here is a `Kiln`');
  });

  it('`x.count` — a list too, which the checker’s own table leaves out', () => {
    // Lists names `count` as one of a list's four operations; the
    // checker's table names only a container and a set role. The
    // fuller sentence wins.
    expect(shapeOf('tool.get(:opens).count', warded())).toBe('integer');

    // `count(K)` counts contents that compose a kind, which a list has
    // none of.
    const kinded = warded();
    expect(read('tool.get(:opens).count(Rib)', kinded).type).toBeNull();
    expect(saidBy(kinded).join(' ')).toContain('not things of a kind');
  });

  it('`x.holds(y)` — `x` a container, `y` an object binding', () => {
    expect(shapeOf('self.holds(target)', vessel())).toBe('boolean');
    const value = vessel();
    expect(read('self.holds(1)', value).type).toBeNull();
    expect(saidBy(value).join(' ')).toContain('asks after a thing');
  });

  it('`x.is(K)` — `K` a kind in scope, `x` an object binding', () => {
    expect(shapeOf('tool.is(Key)', warded())).toBe('boolean');
    expect(shapeOf('here.is(sprout.Container)', warded())).toBe('boolean');
    const value = vessel();
    expect(read('self.get(:capacity).is(Rib)', value).type).toBeNull();
    expect(saidBy(value).join(' ')).toContain('asks what a thing is');
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

  it('types a name by what it is bound to, and refuses one nothing answers to', () => {
    const context = vessel();
    const name = (text: string) => {
      const expr = written(text);
      if (expr.kind !== 'binding') throw new Error(`${text} is not a name`);
      return expr.name;
    };
    expect(bindingType(name('self'), context)).toEqual({ binds: 'object', kind: VESSEL });
    expect(bindingType(name('shelf'), context)).toBeNull();
    expect(saidBy(context).join(' ')).toContain('Nothing here is called `shelf`.');
  });

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
      'chance(4)',
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

  it('refuses a bare option and a bare kind, which are not values', () => {
    const option = vessel();
    expect(read(':wet', option).type).toBeNull();
    expect(saidBy(option).join(' ')).toContain('does not say which enum');

    const bare = vessel();
    expect(read('Key', bare).type).toBeNull();
    expect(saidBy(bare).join(' ')).toContain('is a kind, not a value');
  });

  it('refuses a free call, because `chance` and `random` are not read yet', () => {
    const context = vessel();
    expect(read('chance(30)', context).type).toBeNull();
    expect(context.diagnostics.refusals[0]!.message).toContain('`chance`');
  });

  it('refuses a call that writes where a value is wanted', () => {
    const context = vessel();
    expect(read('self.set(:inked, true) && self.get(:inked)', context).type).toBeNull();
    expect(saidBy(context).join(' ')).toContain('it is not a value');
  });

  it('suggests a name in reach when one is misspelt', () => {
    const context = bodyOf(VESSEL, loopBinding('thing', null, at('thing')));
    expect(read('thnig', context).type).toBeNull();
    expect(saidBy(context).join(' ')).toContain('Did you mean `thing`?');
  });
});

// --- helpers that read like the thing they assert -------------------------

function effect(text: string, context: CheckContext): boolean {
  return effectSaid(text, context).ok;
}

function effectSaid(text: string, context: CheckContext): { ok: boolean; messages: string[] } {
  const parsing = new Diagnostics();
  const expr = parseExpression(new SourceFile('b.sprout', text), parsing);
  expect(
    parsing.refusals.map((d) => d.message),
    `\`${text}\` did not parse`,
  ).toEqual([]);
  expect(expr !== null && isEffect(expr), `\`${text}\` is not a call that writes`).toBe(true);
  const ok = checkEffectCall(expr as Parameters<typeof checkEffectCall>[0], context);
  return {
    ok,
    messages: context.diagnostics.all.map((d) => `${d.message} ${d.remedy ?? ''}`.trim()),
  };
}
