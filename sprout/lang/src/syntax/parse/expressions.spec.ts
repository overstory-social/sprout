import { describe, expect, it } from 'vitest';

import { locationOf } from '../../source/source.js';
import { readExpression } from '../../fixtures/parse.js';

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

describe('a statement is not something to read', () => {
  it('refuses `spawn` where a value is wanted, once, and says how to name what it makes', () => {
    for (const text of [
      'spawn Cup in self',
      'self.holds(spawn Cup in self)',
      'spawn sprout.Container in kiln.shelf == self',
    ]) {
      const read = readExpression(text);
      expect(
        read.refusals.map((d) => d.message),
        text,
      ).toEqual(['`spawn` makes a new thing, and is not something to read.']);
      expect(read.refusals[0]!.remedy).toContain('let cup = spawn Cup in self');
    }
  });

  it('refuses `destroy` where a value is wanted, once, and says to write it on its own', () => {
    for (const text of ['destroy self', '!destroy self', 'self.holds(destroy self)']) {
      const read = readExpression(text);
      expect(
        read.refusals.map((d) => d.message),
        text,
      ).toEqual(['`destroy self` removes something, and is not something to read.']);
      expect(read.refusals[0]!.remedy).toBe('Write it on its own line, as `destroy self`.');
    }
  });

  it('reads nothing where it stood', () => {
    expect(readExpression('spawn Cup in self').expr).toBeNull();
    expect(readExpression('destroy self').expr).toBeNull();
  });

  it('points at the statement where it was written', () => {
    const read = readExpression('self.count + spawn Cup in self');
    expect(locationOf(read.refusals[0]!.at)).toBe('body.sprout:1:14');
  });
});
