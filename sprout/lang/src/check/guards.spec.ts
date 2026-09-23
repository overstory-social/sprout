import { describe, expect, it } from 'vitest';

import type { GuardDeclaration, KindDeclaration } from '../syntax/ast.js';
import { Diagnostics } from '../source/diagnostics.js';
import { parseDeclarations } from '../syntax/parse.js';
import { locationOf, SourceFile } from '../source/source.js';
import type { KindRef } from '../declare/kinds.js';
import type { ResolvedPassage } from '../declare/passages.js';
import { KINDS, VESSEL } from '../fixtures/check.js';
import { checkGuard } from './guards.js';

/** A guard as written, read from inside a kind's body. The parse must succeed. */
function guardOf(text: string): GuardDeclaration {
  const diagnostics = new Diagnostics();
  const [declared] = parseDeclarations(
    new SourceFile('g.sprout', `kind G {\n  ${text}\n}`),
    diagnostics,
  ) as [KindDeclaration];
  expect(
    diagnostics.refusals.map((d) => d.message),
    text,
  ).toEqual([]);
  const guard = declared.members[0];
  if (guard?.kind !== 'guard') throw new Error(`\`${text}\` is not a guard`);
  return guard;
}

/** `VESSEL`, with the passages `full` and `shut` a guard may refuse with. */
const CRATE: KindRef = (() => {
  const source = new SourceFile('p.sprout', 'full shut');
  const passage = (name: string, start: number): [string, ResolvedPassage] => {
    const at = source.span(start, start + name.length);
    const body = { kind: 'passage-body' as const, at, text: '' };
    return [name, { name, origin: 'shop.Vessel', yields: false, body, at }];
  };
  return { ...VESSEL, passages: new Map([passage('full', 0), passage('shut', 5)]) };
})();

/** Check a guard against `self`, with everything said as location, message and remedy. */
function check(text: string, self: KindRef = CRATE) {
  const diagnostics = new Diagnostics();
  const clean = checkGuard(guardOf(text), self, { kinds: KINDS, diagnostics });
  return {
    clean,
    said: diagnostics.refusals.map((d) => [locationOf(d.at), d.message, d.remedy]),
    messages: diagnostics.refusals.map((d) => d.message),
  };
}

describe('a guard reads and decides', () => {
  it('reads the spec’s own guards cleanly', () => {
    for (const text of [
      'accept (item, from) {\n    if (!self.get(:inked)) { refuse shut }\n    else if (self.count >= self.get(:capacity)) { refuse full }\n  }',
      'depart (to) { if (mover != self) { refuse "{self} is not something you can carry off." } }',
      'release (item, to) { if (mover != self) { refuse full } }',
      'depart (to) { if (to.is(Key)) { refuse "You cannot put that on a key." } }',
    ]) {
      expect(check(text).said, text).toEqual([]);
    }
  });

  it('binds `self` to the kind that wrote it, and `mover` and the parameters as objects', () => {
    expect(
      check('release (thing, dest) { if (thing == dest || mover == self) { allow } }').said,
    ).toEqual([]);
    // An object is read only through `is()`, so a parameter's property
    // is refused until it is narrowed, and readable after.
    expect(check('accept (item, from) { if (item.get(:wear) > 3) { allow } }').clean).toBe(false);
    expect(
      check('accept (item, from) { if (item.is(Key)) { if (item.get(:wear) > 3) { allow } } }')
        .said,
    ).toEqual([]);
  });

  it('narrows in the branch the condition guards, and nowhere else', () => {
    const { clean } = check(
      'accept (item, from) {\n    if (item.is(Key)) { allow }\n    else if (item.get(:wear) > 3) { allow }\n  }',
    );
    expect(clean).toBe(false);
  });

  it('refuses a condition that is not true or false', () => {
    expect(check('accept (item, from) { if (self.count) { allow } }').messages).toEqual([
      'A condition is true or false, and this is integer.',
    ]);
  });

  it('refuses a name nothing in the guard answers to', () => {
    expect(check('depart (to) { if (actor == self) { allow } }').clean).toBe(false);
  });

  it('refuses a parameter that takes a name already in scope', () => {
    expect(check('release (self, to) { allow }').messages).toEqual([
      '`self` already names the role-player here.',
    ]);
    expect(check('release (item, item) { allow }').messages).toEqual([
      '`item` already names a parameter of this body here.',
    ]);
  });

  it('keeps a `let` to its block', () => {
    expect(
      check('accept (item, from) { let n = self.count  if (n > 3) { refuse full } }').said,
    ).toEqual([]);
    expect(
      check('accept (item, from) { if (true) { let n = self.count }  if (n > 3) { allow } }').clean,
    ).toBe(false);
  });

  it('accepts what follows an `allow` or a `refuse`, which never runs', () => {
    expect(check('depart (to) { allow  refuse full  allow }').said).toEqual([]);
  });
});

describe('a guard may not write, make or remove anything', () => {
  const REMEDY = 'Move it to a handler or a `do`; a guard ends in `allow` or `refuse`.';

  it('refuses every write, and memory, naming the call as written', () => {
    for (const [call, shown] of [
      ['self.set(:inked, true)', 'self.set'],
      ['self.adjust(:capacity, 1)', 'self.adjust'],
      ['item.remember(:visits, 1)', 'item.remember'],
    ] as const) {
      expect(check(`accept (item, from) { if (true) { ${call} } }`).said, call).toEqual([
        ['g.sprout:2:37', `\`${shown}\` writes, and a guard only reads and decides.`, REMEDY],
      ]);
    }
  });

  it('refuses `spawn`, alone or named by a `let`, and `destroy self`', () => {
    expect(check('release (item, to) { spawn Vessel in self }').said).toEqual([
      ['g.sprout:2:24', '`spawn` makes a new thing, and a guard only reads and decides.', REMEDY],
    ]);
    expect(check('release (item, to) { let v = spawn Vessel in self }').said).toEqual([
      ['g.sprout:2:32', '`spawn` makes a new thing, and a guard only reads and decides.', REMEDY],
    ]);
    expect(check('depart (to) { destroy self }').said).toEqual([
      [
        'g.sprout:2:17',
        '`destroy self` removes something, and a guard only reads and decides.',
        REMEDY,
      ],
    ]);
  });

  it('refuses a `say`, which has nobody to speak to in a guard', () => {
    expect(check('accept (item, from) { say "Hello." }').said).toEqual([
      [
        'g.sprout:2:25',
        '`say` has nobody to speak to inside `accept`.',
        "It belongs in a role's `do`.",
      ],
    ]);
  });

  it('refuses a reading written as a statement, which does nothing', () => {
    expect(check('depart (to) { self.count }').messages).toEqual([
      'This reads something rather than doing something.',
    ]);
  });
});

describe('`refuse` names a passage of the kind that wrote the guard', () => {
  it('accepts one the kind has, and words in quotes', () => {
    expect(check('depart (to) { refuse full }').said).toEqual([]);
    expect(check('depart (to) { refuse "No." }').said).toEqual([]);
  });

  it('refuses one it has not, with the one it most likely meant', () => {
    expect(check('depart (to) { refuse ful }').said).toEqual([
      [
        'g.sprout:2:24',
        '`Vessel` has no passage `ful`. Did you mean `full`?',
        'Write `refuse full`, or write `passage ful { … }` in `Vessel`.',
      ],
    ]);
    expect(check('depart (to) { refuse gone }').said).toEqual([
      [
        'g.sprout:2:24',
        '`Vessel` has no passage `gone`.',
        'Write `passage gone { … }` in `Vessel`, or give the words in quotes, as in `refuse "No room here."`.',
      ],
    ]);
  });

  it('asks only the kind that wrote the guard', () => {
    expect(check('depart (to) { refuse full }', VESSEL).messages).toEqual([
      '`Vessel` has no passage `full`.',
    ]);
  });
});
