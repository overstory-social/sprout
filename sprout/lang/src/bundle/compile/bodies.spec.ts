import { describe, expect, it } from 'vitest';

import type { KindDeclaration } from '../../syntax/ast.js';
import type { VerbDeclaration } from '../../syntax/ast-verbs.js';
import { Diagnostics } from '../../source/diagnostics.js';
import { parseDeclarations } from '../../syntax/parse.js';
import { locationOf, SourceFile } from '../../source/source.js';
import { EnumTable } from '../../declare/enums.js';
import { kindName, KindTable } from '../../declare/kinds.js';
import { hereKindOf } from '../../declare/places.js';
import { MessageTable } from '../../declare/messages.js';
import { placeObjects } from '../../declare/tree.js';
import { VerbNames } from '../../declare/roles.js';
import { VerbTable } from '../../declare/verbs.js';
import { checkBodies } from './bodies.js';

/** Every kind and verb in `text`, resolved in `shop`, then every body checked: what that said. */
function checked(text: string): string[][] {
  return checking(text).said;
}

/** The same, with the slots of prose that render an option. */
function checking(text: string) {
  const setup = new Diagnostics();
  const declared = parseDeclarations(new SourceFile('shop.sprout', text), setup);
  const verbDeclarations = declared.filter((d): d is VerbDeclaration => d.kind === 'verb');
  const names = new VerbNames();
  names.add('shop', verbDeclarations);
  const enums = new EnumTable();
  enums.add(
    'shop',
    declared.filter((d) => d.kind === 'enum'),
    setup,
  );
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
  const options = checkBodies(
    kinds.all().map((kind) => ({
      kind,
      vantage: { in: 'kind' as const, giver: kindName(kind), path: [], self: kind },
    })),
    {
      kinds,
      here: hereKindOf(kinds.all(), kinds),
      verbs,
      diagnostics,
      messages: { lookup: new MessageTable() },
      source: { tree: placeObjects([], { world: 'shop', diagnostics }), contents: new Map() },
      world: null,
      names: new Map(),
    },
  );
  return {
    said: diagnostics.refusals.map((d) => [locationOf(d.at), d.message]),
    options: [...options].map((slot) => locationOf(slot.at)),
  };
}

describe('each body is checked once, against the kind that wrote it', () => {
  it('says a problem in a composed guard once, however many kinds compose it', () => {
    expect(
      checked(`kind Lid { :open true  depart (to) { self.set(:open, false) } }
kind Crate is Lid { }
kind Chest is Lid { }
kind Trunk is Crate, Chest { }`),
    ).toEqual([['shop.sprout:1:38', '`self.set` writes, and a guard only reads and decides.']]);
  });

  it('reads a guard’s `self` as the kind that wrote it, whatever composes it later', () => {
    // `:open` is `Lid`'s, which its own guard reads; `Crate` composes it,
    // and reads it in its own guard as any composed property.
    expect(
      checked(`kind Lid { :open true  depart (to) { if (!self.get(:open)) { refuse "Shut." } } }
kind Crate is Lid { accept (item, from) { if (self.get(:open)) { allow } } }`),
    ).toEqual([]);
  });

  it('asks the kind that wrote the guard for the passage it refuses with', () => {
    expect(
      checked(`kind Lid { depart (to) { refuse shut } }
kind Crate is Lid { passage shut { {self} is shut. } }`),
    ).toEqual([['shop.sprout:1:33', '`Lid` has no passage `shut`.']]);
  });

  it('says a problem in a composed play once, against the kind that wrote it', () => {
    expect(
      checked(`verb pull { role target  "pull [target]" }
kind Lever { :up true  as target for pull { permit { self.set(:up, false) } } }
kind Brass is Lever { }
kind Iron is Lever { }
kind Both is Brass, Iron { }`),
    ).toEqual([['shop.sprout:2:54', '`self.set` writes, and a `permit` only reads and decides.']]);
  });

  it('says a problem in a composed exit once, against the kind that wrote it', () => {
    expect(
      checked(`kind Doorway { grammar { exit out "out" -> yard } }
kind Hall is Doorway { contains actors }
kind Porch is Doorway { contains actors }`),
    ).toEqual([
      ['shop.sprout:1:31', '`Doorway` is not a place, so nobody stands in it to take a way out.'],
    ]);
  });

  it('reads a play’s passage on the kind that wrote it', () => {
    expect(
      checked(`verb pull { role target  "pull [target]" }
kind Lever { as target for pull { do { say pulled } } }
kind Brass is Lever { passage pulled { Clunk. } }`),
    ).toEqual([['shop.sprout:2:44', '`Lever` has no passage `pulled`.']]);
  });
});

describe('then every passage, against the bodies that say it', () => {
  it('refuses a passage said where what it renders is not bound, where it is said', () => {
    expect(
      checked(`verb pull { role target  "pull [target]" }
kind Lever {
  contains
  accept (item, from) { refuse stuck }
  as target for pull { do { say stuck } }
  passage stuck { {actor} cannot move {self}. }
}`),
    ).toEqual([
      [
        'shop.sprout:4:32',
        'The passage `stuck` renders `{actor}`, and nothing here is called `actor`.',
      ],
    ]);
  });

  it('gives back each slot that renders an option, wherever it was checked', () => {
    const { said, options } = checking(`enum Mood { wet, dry }
verb pull { role target  "pull [target]" }
kind Lever {
  :mood Mood default dry
  as target for pull { do { say "It is {self.get(:mood)}."  say mood } }
  passage mood { {self.get(:mood)}, and {self.get(:mood)}. }
}`);
    expect(said).toEqual([]);
    expect(options.sort()).toEqual(['shop.sprout:5:40', 'shop.sprout:6:18', 'shop.sprout:6:41']);
  });
});
