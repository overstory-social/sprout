import { describe, expect, it } from 'vitest';

import { locationOf, textOf } from '../../source/source.js';
import { shape, readExpression, readLet } from '../../fixtures/parse.js';

describe('an expression', () => {
  it('reads every expression the spec writes', () => {
    // Taken from the spec's own bodies, so the suite fails if the
    // grammar drifts from what the language is written in.
    const written: [string, string][] = [
      ['self.get(:sealed)', 'self.get(:sealed)'],
      ['self.get(:wear) >= 99', '(self.get(:wear) >= 99)'],
      ['!self.get(:inked)', '(!self.get(:inked))'],
      ['tools.count(Rib) > 1', '(tools.count(Rib) > 1)'],
      ['self.get(:state) == :wet', '(self.get(:state) == :wet)'],
      ['elapsed > 7200', '(elapsed > 7200)'],
      ['p != self && chance(4)', '((p != self) && chance(4))'],
      ['self.count >= self.get(:capacity)', '(self.count >= self.get(:capacity))'],
      ['actor.recall(:visits) <= 1', '(actor.recall(:visits) <= 1)'],
      ['item.is(Creature)', 'item.is(Creature)'],
      ['from.get(:opens).includes(self.get(:ward))', 'from.get(:opens).includes(self.get(:ward))'],
      ['self.holds(target)', 'self.holds(target)'],
      ['self.adjust(:wear, 1)', 'self.adjust(:wear, 1)'],
      ['random(6)', 'random(6)'],
      ['to.is(sprout.Container)', 'to.is(sprout.Container)'],
    ];
    for (const [text, expected] of written) {
      const read = readExpression(text);
      expect(
        read.refusals.map((d) => d.message),
        text,
      ).toEqual([]);
      expect(read.shape, text).toBe(expected);
    }
  });

  it('binds operators as the spec’s own expressions assume', () => {
    const table: [string, string][] = [
      ['a || b && c', '(a || (b && c))'],
      ['a && b == c', '(a && (b == c))'],
      ['a == b < c', '(a == (b < c))'],
      ['a < b + c', '(a < (b + c))'],
      ['-a + b', '((-a) + b)'],
      ['!a && b', '((!a) && b)'],
      ['a - b - c', '((a - b) - c)'],
      ['(a || b) && c', '((a || b) && c)'],
      ['a.b.c', 'a.b.c'],
    ];
    for (const [text, expected] of table) expect(readExpression(text).shape, text).toBe(expected);
  });

  it('tells a library’s kind from a reading, by what follows the dot', () => {
    // `sprout.Container` is a kind and `actor.recall` is a reading, and
    // the only difference is the capital letter after the dot.
    expect(readExpression('sprout.Container').shape).toBe('sprout.Container');
    expect(readExpression('sprout.recall').shape).toBe('sprout.recall');
  });

  it('says what it could not read, and where', () => {
    const table: [string, string][] = [
      ['', 'the end of the file is not something to read'],
      ['&&', '`&&` is not something to read'],
      ['a +', 'the end of the file is not something to read'],
      ['(a + b', 'This bracket is never closed.'],
      ['self.get(:p', 'This bracket is never closed.'],
      ['self.', 'A dot needs the name of something to read after it.'],
      ['1.5', 'Sprout has no fractions.'],
    ];
    for (const [text, said] of table) {
      const read = readExpression(text);
      expect(read.expr, text).toBeNull();
      expect(read.refusals.map((d) => d.message).join(' '), text).toContain(said);
      for (const refusal of read.refusals) {
        expect(refusal.remedy ?? '', `${text}: no remedy`).not.toBe('');
      }
    }
  });

  it('keeps the well-formed neighbour of an argument it could not read', () => {
    const read = readExpression('self.set(:wear % , 1)');
    expect(read.shape).toBe('self.set(:wear, 1)');
  });

  it('asks for a comma only once the next thing reads', () => {
    const read = readExpression('self.set(:wear 1)');
    expect(read.refusals.map((d) => d.message)).toEqual([
      'A reading needs a comma between what it is given.',
    ]);
    expect(read.shape).toBe('self.set(:wear, 1)');
  });
});

describe('`let` names the result of an expression', () => {
  it('reads the spec’s own two', () => {
    const ribs = readLet('let ribs  = tools.count(Rib)');
    expect(ribs.refusals).toEqual([]);
    expect(ribs.statement!.name.text).toBe('ribs');
    expect(shape(ribs.statement!.value)).toBe('tools.count(Rib)');

    const state = readLet('let state = self.get(:state)');
    expect(state.statement!.name.text).toBe('state');
    expect(shape(state.statement!.value)).toBe('self.get(:state)');
  });

  it('spans from the keyword to the end of what it names', () => {
    const { statement } = readLet('let ribs = tools.count(Rib)');
    expect(textOf(statement!.at)).toBe('let ribs = tools.count(Rib)');
    expect(locationOf(statement!.name.at)).toBe('body.sprout:1:5');
  });

  it('names a whole expression, not only a simple one', () => {
    expect(
      shape(readLet('let ready = self.get(:wear) >= 99 && !self.get(:lit)').statement!.value),
    ).toBe('((self.get(:wear) >= 99) && (!self.get(:lit)))');
  });

  it('takes no type, because it takes the expression’s exactly', () => {
    const { statement, refusals } = readLet('let n: integer = 1');
    expect(statement).toBeNull();
    expect(refusals[0]!.message).toContain('takes its type from what it names');
    expect(refusals[0]!.remedy).toContain('let n = ');
  });

  it('says what is wrong with one that is not written out', () => {
    const table: [string, string][] = [
      ['let', 'A `let` needs a name.'],
      ['let =', 'A `let` needs a name.'],
      ['let 4 = 1', 'A `let` needs a name.'],
      ['let Ward = 1', 'starts with a capital'],
      ['let x', 'is not given anything to name'],
      ['let x = ', 'the end of the file is not something to read'],
      ['ribs = 1', 'does not name a value'],
    ];
    for (const [text, said] of table) {
      const { statement, refusals } = readLet(text);
      expect(statement, text).toBeNull();
      expect(refusals.map((d) => d.message).join(' '), text).toContain(said);
      for (const refusal of refusals)
        expect(refusal.remedy ?? '', `${text}: no remedy`).not.toBe('');
    }
  });
});
