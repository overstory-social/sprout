import { describe, expect, it } from 'vitest';

import type { KindDeclaration } from '../syntax/ast.js';
import type { VerbDeclaration } from '../syntax/ast-verbs.js';
import { Diagnostics } from '../source/diagnostics.js';
import { parseDeclarations } from '../syntax/parse.js';
import { locationOf, SourceFile } from '../source/source.js';
import { EnumTable } from '../declare/enums.js';
import { KindTable } from '../declare/kinds.js';
import { MessageTable } from '../declare/messages.js';
import { VerbNames } from '../declare/roles.js';
import { VerbTable } from '../declare/verbs.js';
import { checkHandler, checkHook, checkPass } from './handlers.js';

const SPROUT_TEXT = 'kind Actor { contains :capacity 8 }\nkind Visitor is Actor { }\n';

const DECLARED = `message :illuminating with boolean
message :gust
message :pong with integer
verb purr { role target }
`;

/**
 * Every handler, hook and pass rule in `text` checked against the kind
 * that wrote it, after the messages above. What was said, as location,
 * message and remedy, and each body's verdict in the order checked.
 */
function checked(text: string) {
  const setup = new Diagnostics();
  const sprout = parseDeclarations(new SourceFile('sprout.sprout', SPROUT_TEXT), setup);
  const shop = parseDeclarations(new SourceFile('shop.sprout', `${DECLARED}${text}`), setup);
  const enums = new EnumTable();
  const messages = new MessageTable();
  messages.add(
    'shop',
    shop.filter((d) => d.kind === 'message'),
    enums,
    setup,
  );
  const verbDeclarations = shop.filter((d): d is VerbDeclaration => d.kind === 'verb');
  const names = new VerbNames();
  names.add('shop', verbDeclarations);
  const kinds = new KindTable();
  kinds.add(
    'sprout',
    sprout.filter((d): d is KindDeclaration => d.kind === 'kind'),
    setup,
  );
  kinds.add(
    'shop',
    shop.filter((d): d is KindDeclaration => d.kind === 'kind'),
    setup,
  );
  kinds.resolve('shop', enums, setup, undefined, { verbs: names, messages });
  const verbs = new VerbTable();
  verbs.add('shop', verbDeclarations, { kinds, enums, diagnostics: setup });
  expect(
    setup.all.map((d) => d.message),
    'the setup',
  ).toEqual([]);

  const diagnostics = new Diagnostics();
  const setting = { kinds, verbs, diagnostics };
  const clean: boolean[] = [];
  for (const kind of kinds.all().filter((one) => one.library === 'shop')) {
    for (const runs of kind.handlers.values()) {
      for (const one of runs) clean.push(checkHandler(one, kind, setting));
    }
    for (const runs of kind.hooks.values()) {
      for (const one of runs) clean.push(checkHook(one, kind, setting));
    }
    const { any, messages: rules } = kind.passes;
    for (const one of [...(any === null ? [] : [any]), ...rules.values()]) {
      clean.push(checkPass(one, kind, setting));
    }
  }
  return {
    clean,
    said: diagnostics.refusals.map((d) => [locationOf(d.at), d.message, d.remedy]),
    messages: diagnostics.refusals.map((d) => d.message),
  };
}

describe('a handler', () => {
  it('binds the sender as an object and the value as its declaration types it', () => {
    const { clean, said } = checked(
      'kind Lamp { :lit false  on :illuminating (from, value) { self.set(:lit, value) } }',
    );
    expect(said).toEqual([]);
    expect(clean).toEqual([true]);
  });

  it('reads the sender only through `is()`', () => {
    const { messages } = checked(
      'kind Key { :cut true }\nkind Lock { :locked true  on :gust (from) { if (from.get(:cut)) { self.set(:locked, false) } } }',
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('from');
  });

  it('binds an engine message’s parameters positionally, under the author’s names', () => {
    const { said } = checked(
      'kind Room { contains :n 0 min 0 max 9  on :entered (thing, _) { if (thing.is(Room)) { self.adjust(:n, 1) } } }',
    );
    expect(said).toEqual([]);
  });

  it('refuses `say`, in the spec’s own words', () => {
    const { said } = checked('kind Cat { on :gust { say "Miaow." } }');
    expect(said).toEqual([
      [
        'shop.sprout:5:23',
        '`say` has nobody to speak to inside `on :gust`.',
        'Use `tell` to speak to the room, or `tell p` to one person.',
      ],
    ]);
  });

  it('refuses `refuse` and `allow`, since nobody waits for an answer', () => {
    const { messages } = checked('kind Cat { on :gust { refuse "No." } on :pong { allow } }');
    expect(messages).toEqual([
      '`refuse` answers someone, and nobody waits on `on :gust` for an answer.',
      '`allow` answers someone, and nobody waits on `on :pong` for an answer.',
    ]);
  });

  it('refuses `actor` and `here`, which nothing binds when a message arrives', () => {
    const { messages } = checked(
      'kind Cat { :n 0  on :gust { if (actor == here) { self.set(:n, 1) } } }',
    );
    expect(messages).toEqual([
      '`actor` is not bound inside `on :gust`: nobody is acting when a message arrives.',
    ]);
  });

  it('lets an engine message’s parameter take the name `actor`, as `:arrived` passes one', () => {
    const { said } = checked(
      'kind Dog is sprout.Actor { :n 0  on :arrived (actor, from) { if (actor != self) { self.set(:n, 1) } } }',
    );
    expect(said).toEqual([]);
  });

  it('refuses a value on a message that carries none', () => {
    expect(checked('kind Cat { on :gust (from, value) { } }').messages).toEqual([
      '`:gust` carries no value.',
    ]);
  });

  it('may `act` where its kind is an actor, and not where it is not', () => {
    expect(
      checked(
        'kind Cat is sprout.Actor { as actor for purr { do { } } on :gust { act purr (target: self) } }',
      ).messages,
    ).toEqual([]);
    expect(checked('kind Rock { on :gust { act purr (target: self) } }').messages).toEqual([
      'Only an actor acts, and `Rock` does not compose `sprout.Actor`.',
    ]);
  });
});

describe('a hook', () => {
  it('binds the value the property had, typed as the property is', () => {
    const { said } = checked(
      'kind Lamp { :lit false :n 0 min 0 max 9  changed :lit (was) { if (was == true) { self.adjust(:n, 1) } } }',
    );
    expect(said).toEqual([]);
  });

  it('refuses a property the kind does not hold, with the one most likely meant', () => {
    expect(checked('kind Lamp { :lit false  changed :lt { } }').said).toEqual([
      [
        'shop.sprout:5:33',
        '`Lamp` holds no `:lt`, so `changed :lt` has nothing to watch. Did you mean `:lit`?',
        'Name a property `Lamp` holds, as in `changed :lit (was) { … }`.',
      ],
    ]);
  });

  it('refuses a remembered property, which is held about each actor', () => {
    expect(checked('kind Lamp { :remembers [seen: false]  changed :seen { } }').messages).toEqual([
      '`:seen` is remembered about each actor, and `changed` watches what `Lamp` holds itself.',
    ]);
  });

  it('refuses a second parameter', () => {
    expect(checked('kind Lamp { :lit false  changed :lit (was, now) { } }').messages).toEqual([
      '`changed :lit` binds the value it had before, and nothing else.',
    ]);
  });
});

describe('a pass rule', () => {
  it('is a condition over the container', () => {
    const { said, clean } = checked(
      'kind Case { contains :open false  pass :illuminating (true)  pass any (self.get(:open)) }',
    );
    expect(said).toEqual([]);
    expect(clean).toEqual([true, true]);
  });

  it('refuses a rule that is not true or false', () => {
    expect(checked('kind Case { contains :n 0  pass any (self.get(:n)) }').said).toEqual([
      [
        'shop.sprout:5:38',
        '`pass any` lets a message through or not, so its rule is true or false, and this is integer.',
        'Write `pass any (true)`, `pass any (false)`, or a condition, as in `pass any (self.get(:open))`.',
      ],
    ]);
  });

  it('binds nothing but `self`', () => {
    expect(checked('kind Case { contains  pass any (actor == self) }').messages).toHaveLength(1);
  });
});
