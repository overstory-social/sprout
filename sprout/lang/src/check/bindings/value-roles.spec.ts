// A role-player narrows its own options: `from` bounds a symbol role by
// a property's enum, an integer role by a property's range or a literal
// `from … to …`, and each mismatch — a symbol with nothing to narrow, a
// range on a symbol, a list on an integer, a downward range, a `from` on
// a role with nothing to narrow — is refused in its own words.

import { describe, expect, it } from 'vitest';

import { roleBinding, valueOf, type RoleDeclaredAs } from '../bindings.js';
import { integer } from '../../declare/types.js';
import {
  at,
  ENUMS,
  fromProperty,
  fromRange,
  KNOWS,
  LOCKABLE,
  SIZES,
  trying,
  WEAR,
} from '../../fixtures/bindings.js';

describe('a role-player narrows its own options', () => {
  it('types a symbol role by the list’s element type, so `== :toll` checks against `Topic`', () => {
    const { made } = trying((d) =>
      roleBinding('topic', { role: 'symbol' }, fromProperty(KNOWS), at('topic'), d),
    );
    expect(made!.type).toEqual(
      valueOf({ type: 'symbol', of: ENUMS.unqualified('Topic', 'printers_shop')! }),
    );
  });

  it('bounds an integer role by the range of the property named', () => {
    const { made, said } = trying((d) =>
      roleBinding('n', { role: 'integer' }, fromProperty(WEAR), at('n'), d),
    );
    expect(said).toEqual([]);
    expect(made!.type).toEqual(valueOf(integer(0, 99)));
  });

  it('takes a literal range — `from 1 to 12`', () => {
    const { made } = trying((d) =>
      roleBinding('n', { role: 'integer' }, fromRange(1, 12), at('n'), d),
    );
    expect(made!.type).toEqual(valueOf(integer(1, 12)));
  });

  it('refuses a symbol role that has not said what it hears, naming what to write', () => {
    const { made, said } = trying((d) =>
      roleBinding('topic', { role: 'symbol' }, null, at('topic'), d),
    );
    expect(made).toBeNull();
    expect(said.join(' ')).toContain('has not said which options it hears');
  });

  it('refuses a symbol role narrowed by a range, and an integer one by a list', () => {
    const symbol = trying((d) =>
      roleBinding('topic', { role: 'symbol' }, fromRange(1, 12), at('topic'), d),
    );
    expect(symbol.made).toBeNull();
    expect(symbol.said.join(' ')).toContain('not a set of options');

    const number = trying((d) =>
      roleBinding('n', { role: 'integer' }, fromProperty(KNOWS), at('n'), d),
    );
    expect(number.made).toBeNull();
    expect(number.said.join(' ')).toContain('[Topic]');
  });

  it('refuses a symbol role narrowed by a list of something else', () => {
    const { made, said } = trying((d) =>
      roleBinding('topic', { role: 'symbol' }, fromProperty(SIZES), at('topic'), d),
    );
    expect(made).toBeNull();
    expect(said.join(' ')).toContain('[integer]');
  });

  it('refuses a range that counts downward', () => {
    const { made, said } = trying((d) =>
      roleBinding('n', { role: 'integer' }, fromRange(12, 1), at('n'), d),
    );
    expect(made).toBeNull();
    expect(said.join(' ')).toContain('A range counts upward');
  });

  it('refuses a `from` on a role filled by a thing, where there is nothing to narrow', () => {
    for (const declared of [
      { role: 'kind', kind: LOCKABLE },
      { role: 'open' },
    ] as RoleDeclaredAs[]) {
      const { made, said } = trying((d) =>
        roleBinding('target', declared, fromProperty(KNOWS), at('target'), d),
      );
      expect(made).toBeNull();
      expect(said.join(' ')).toContain('nothing for `from` to narrow');
    }
  });

  it('takes an integer role with no `from` as the whole integer range', () => {
    const { made, said } = trying((d) => roleBinding('n', { role: 'integer' }, null, at('n'), d));
    expect(said).toEqual([]);
    expect(made!.type).toEqual(valueOf(integer()));
  });
});
