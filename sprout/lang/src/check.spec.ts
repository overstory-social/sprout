import { describe, expect, it } from 'vitest';

import {
  actorBinding,
  hereBinding,
  letBinding,
  loopBinding,
  roleBinding,
  Scope,
  selfBinding,
  setRoleBinding,
  showBindingType,
  valueOf,
  type Binding,
  type KindRef,
} from './bindings.js';
import {
  ACTOR,
  checkCondition,
  checkEffect,
  narrowingOf,
  typeOf,
  type CheckContext,
  type KindLookup,
} from './check.js';
import { Diagnostics } from './diagnostics.js';
import { EnumTable } from './enums.js';
import { parseDeclarations, parseExpression, parseProperty } from './parse.js';
import { resolveProperty, type ResolvedProperty } from './properties.js';
import { locationOf, SourceFile } from './source.js';
import { integer } from './types.js';

// --- the printer's shop, far enough built to ask real questions -----------

const NAMES = new SourceFile(
  'shop.sprout',
  'self actor here target tool tools item thing topic n note\n',
);
const at = (word: string) => {
  const start = NAMES.text.indexOf(word);
  if (start < 0) throw new Error(`the fixture has no \`${word}\``);
  return NAMES.span(start, start + word.length);
};

const ENUMS = (() => {
  const table = new EnumTable();
  const diagnostics = new Diagnostics();
  table.add(
    'shop',
    parseDeclarations(
      new SourceFile(
        'enums.sprout',
        'enum Ward { oak, silver }\nenum Drying { wet, cured }\nenum Topic { bridge, toll }\n',
      ),
      diagnostics,
    ).filter((d) => d.kind === 'enum'),
    diagnostics,
  );
  expect(diagnostics.refusals).toHaveLength(0);
  return table;
})();

function property(text: string, remembered = false): ResolvedProperty {
  const diagnostics = new Diagnostics();
  const declared = parseProperty(new SourceFile('p.sprout', text), diagnostics);
  const resolved =
    declared === null ? null : resolveProperty(declared, ENUMS, 'shop', diagnostics, remembered);
  expect(diagnostics.refusals, text).toHaveLength(0);
  return resolved!;
}

function kind(
  name: string,
  properties: ResolvedProperty[],
  composes: string[] = [],
  contains = false,
  library = 'shop',
): KindRef {
  return {
    library,
    name,
    composes: new Set([`${library}.${name}`, ...composes]),
    properties: new Map(properties.map((p) => [p.name, p])),
    contains,
  };
}

const KEY = kind('Key', [
  property(':wear 0 min 0 max 99'),
  property(':opens [Ward] default [oak]'),
]);
const WARDED = kind('Warded', [
  property(':sealed false'),
  property(':ward Ward default oak'),
  property(':state Drying default wet'),
  property(':note string default ""'),
]);
const RIB = kind('Rib', [property(':cracked false')]);
const VESSEL = kind(
  'Vessel',
  [property(':capacity 4 min 0 max 9'), property(':inked false')],
  ['sprout.Container'],
  true,
);
const PRINTER = kind(
  'Printer',
  [
    property(':visits 0 min 0 max 99', true),
    property(':handled false', true),
    property(':seen [Ward] default [oak]', true),
  ],
  [ACTOR],
  true,
);
const CONTAINER = kind('Container', [], [], true, 'sprout');

const ALL = [KEY, WARDED, RIB, VESSEL, PRINTER, CONTAINER];
const KINDS: KindLookup = {
  qualified: (library, name) => ALL.find((k) => k.library === library && k.name === name) ?? null,
  unqualified: (name, from) => KINDS.qualified(from, name) ?? KINDS.qualified('sprout', name),
};

/** A body of `selfKind`, with the bindings a role-player has. */
function bodyOf(selfKind: KindRef, ...extra: Binding[]): CheckContext {
  const scope = Scope.root();
  const setting = new Diagnostics();
  for (const binding of [
    selfBinding(selfKind, at('self')),
    actorBinding(PRINTER, at('actor')),
    hereBinding(at('here')),
    ...extra,
  ]) {
    expect(scope.introduce(binding, setting), binding.name).toBe(true);
  }
  expect(setting.refusals).toHaveLength(0);
  return { scope, kinds: KINDS, from: 'shop', self: selfKind, diagnostics: new Diagnostics() };
}

/** Everything a context has said so far, message and remedy together. */
function saidBy(context: CheckContext): string[] {
  return context.diagnostics.all.map((d) => `${d.message} ${d.remedy ?? ''}`.trim());
}

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

const warded = () =>
  bodyOf(
    WARDED,
    roleBinding('tool', { role: 'kind', kind: KEY }, null, at('tool'), new Diagnostics())!,
  );
const vessel = () =>
  bodyOf(
    VESSEL,
    setRoleBinding('tools', RIB, at('tools')),
    roleBinding('target', { role: 'open' }, null, at('target'), new Diagnostics())!,
  );

// --- the table ------------------------------------------------------------

describe('what the compiler checks — the table, row by row', () => {
  it('`a == b`, `a != b` — same type', () => {
    expect(shapeOf('self.get(:inked) == self.get(:inked)')).toBe('boolean');
    expect(shapeOf('self.get(:capacity) != 4')).toBe('boolean');
    const mixed = read('self.get(:inked) == 4', vessel());
    expect(mixed.type).toBeNull();
    expect(mixed.said.join(' ')).toContain('compares boolean with integer');
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

  it('`< <= > >=` — both integer', () => {
    expect(shapeOf('self.get(:capacity) > 1')).toBe('boolean');
    expect(shapeOf('1 <= self.get(:capacity)')).toBe('boolean');
    const wrong = read('self.get(:inked) < 1', vessel());
    expect(wrong.type).toBeNull();
    expect(wrong.said.join(' ')).toContain('`<` reads integer, and this is boolean');
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
    // `get` drew this line and the four that write did not, so a `set`
    // reached memory and wrote one object's idea of everybody at once.
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

describe('it never guesses, and never dies', () => {
  it('types a chain with no bracket in it, however long', () => {
    // A tree is as deep as its longest chain of operators, and this one
    // has nothing in it to count against the nesting cap. A recursive
    // walk answers it with a stack overflow instead of a type.
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

  it('refuses a value where a statement is wanted', () => {
    const context = vessel();
    const expr = parseExpression(new SourceFile('b.sprout', 'self.get(:inked)'), new Diagnostics());
    expect(checkEffect(expr!, context)).toBe(false);
    expect(context.diagnostics.refusals[0]!.message).toContain('reads something');
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
  const ok = checkEffect(expr!, context);
  return {
    ok,
    messages: context.diagnostics.all.map((d) => `${d.message} ${d.remedy ?? ''}`.trim()),
  };
}
