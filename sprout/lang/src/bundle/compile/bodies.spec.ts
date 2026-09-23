import { describe, expect, it } from 'vitest';

import type { KindDeclaration, VerbDeclaration } from '../../syntax/ast.js';
import { Diagnostics } from '../../source/diagnostics.js';
import { parseDeclarations } from '../../syntax/parse.js';
import { locationOf, SourceFile } from '../../source/source.js';
import { EnumTable } from '../../declare/enums.js';
import { KindTable } from '../../declare/kinds.js';
import { VerbNames } from '../../declare/roles.js';
import { VerbTable } from '../../declare/verbs.js';
import { checkBodies } from './bodies.js';

/** Every kind and verb in `text`, resolved in `shop`, then every body checked: what that said. */
function checked(text: string): string[][] {
  const setup = new Diagnostics();
  const declared = parseDeclarations(new SourceFile('shop.sprout', text), setup);
  const verbDeclarations = declared.filter((d): d is VerbDeclaration => d.kind === 'verb');
  const names = new VerbNames();
  names.add('shop', verbDeclarations);
  const enums = new EnumTable();
  const kinds = new KindTable();
  kinds.add(
    'shop',
    declared.filter((d): d is KindDeclaration => d.kind === 'kind'),
    setup,
  );
  kinds.resolve('shop', enums, setup, undefined, { verbs: names });
  const verbs = new VerbTable();
  verbs.add('shop', verbDeclarations, { kinds, enums, diagnostics: setup });
  expect(
    setup.refusals.map((d) => d.message),
    'the fixture composes',
  ).toEqual([]);
  const diagnostics = new Diagnostics();
  checkBodies(kinds.all(), { kinds, verbs, visitor: null, diagnostics });
  return diagnostics.refusals.map((d) => [locationOf(d.at), d.message]);
}

describe('each body is checked once, against the kind that wrote it', () => {
  it('says a problem in a composed guard once, however many kinds compose it', () => {
    expect(
      checked(`kind Lid { :open true  depart (to) { self.set(:open, false) } }
kind Crate: Lid { }
kind Chest: Lid { }
kind Trunk: Crate, Chest { }`),
    ).toEqual([['shop.sprout:1:38', '`self.set` writes, and a guard only reads and decides.']]);
  });

  it('reads a guard’s `self` as the kind that wrote it, whatever composes it later', () => {
    // `:open` is `Lid`'s, which its own guard reads; `Crate` composes it,
    // and reads it in its own guard as any composed property.
    expect(
      checked(`kind Lid { :open true  depart (to) { if (!self.get(:open)) { refuse "Shut." } } }
kind Crate: Lid { accept (item, from) { if (self.get(:open)) { allow } } }`),
    ).toEqual([]);
  });

  it('asks the kind that wrote the guard for the passage it refuses with', () => {
    expect(
      checked(`kind Lid { depart (to) { refuse shut } }
kind Crate: Lid { passage shut { {self} is shut. } }`),
    ).toEqual([['shop.sprout:1:33', '`Lid` has no passage `shut`.']]);
  });

  it('says a problem in a composed play once, against the kind that wrote it', () => {
    expect(
      checked(`verb pull { role target  "pull [target]" }
kind Lever { :up true  as target for pull { permit { self.set(:up, false) } } }
kind Brass: Lever { }
kind Iron: Lever { }
kind Both: Brass, Iron { }`),
    ).toEqual([['shop.sprout:2:54', '`self.set` writes, and a `permit` only reads and decides.']]);
  });

  it('reads a play’s passage on the kind that wrote it', () => {
    expect(
      checked(`verb pull { role target  "pull [target]" }
kind Lever { as target for pull { do { say pulled } } }
kind Brass: Lever { passage pulled { Clunk. } }`),
    ).toEqual([['shop.sprout:2:44', '`Lever` has no passage `pulled`.']]);
  });
});
