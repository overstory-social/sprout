import { describe, expect, it } from 'vitest';

import type { GuardName } from '../syntax/ast.js';
import { DEFAULT_LIMITS } from '../bundle/limits.js';
import type { ResolvedGuard } from '../declare/guards.js';
import type { KindLookup } from '../declare/kinds.js';
import { compiledWorld } from '../fixtures/bundle.js';
import { Budget, BudgetExhausted } from './budget.js';
import { catalogueOf } from './catalogue.js';
import { Draft } from './draft.js';
import { declaredId, type InstanceId } from './ids.js';
import { initialState } from './load.js';
import { runGuard, type GuardContext, type Refusal } from './guards.js';
import { newInstance } from './state.js';

const CAPS = DEFAULT_LIMITS.caps;

/**
 * A keep with a crate and a bin. `Crate` writes all three guards and
 * refuses through its passages, one of them a default; `Bin` composes
 * it and writes its own line of that name. The world declares its own
 * `Place`, so a bare `Place` in its bodies is not `sprout.Place`.
 */
const bundle = compiledWorld('keep', {
  'world.sprout': [
    'world keep: sprout.World { contains visitors are Person visitors arrive at hall }',
    'kind Person: sprout.Actor { :strength 5 min 0 max 9 }',
    'kind Place { contains actors }',
    'kind Fruit { :ripe true }',
    'kind Crate {',
    '  contains',
    '  :open true',
    '  :capacity 2 min 0 max 9',
    '  accept (item, from) {',
    '    if (!self.get(:open)) { refuse shut }',
    '    else if (self.count >= self.get(:capacity)) { refuse full }',
    '    else if (item.is(Person)) { refuse "No climbing in." }',
    '  }',
    '  release (item, to) {',
    '    let lid = self.get(:open)',
    '    if (lid) {',
    '      let spare = self.get(:capacity) - self.count',
    '      if (spare > 0) { allow }',
    '      refuse "It is packed too tight to get anything out."',
    '    }',
    '    refuse shut',
    '  }',
    '  depart (to) {',
    '    if (mover == self) { allow }',
    '    if (to.is(Place)) { refuse "Not in there." }',
    '    if (to.is(Person)) { if (to.get(:strength) < 3) { refuse heavy } }',
    '  }',
    '  passage shut default { {self} is shut. }',
    '  passage full { There is no room in {self}. }',
    '  passage heavy { It is too heavy to lift. }',
    '}',
    'kind Bin: Crate { passage shut { The lid of {self} is down. } }',
    'kind Plain { depart (to) { allow\n refuse "Never said." } }',
    'kind Counted { depart (to) {\n let a = 1\n if (a == 1) { allow }\n } }',
    'kind Silent { contains accept (item, from) { } }',
    'object hall: sprout.Place in keep',
    'object nook: Place in keep',
    'object crate: Crate in hall',
    'object bin: Bin in hall',
    'object apple: Fruit in hall.crate',
    'object plain: Plain in hall',
    'object counted: Counted in hall',
    'object silent: Silent in hall',
    '',
  ].join('\n'),
});
const catalogue = catalogueOf(bundle, CAPS);

const KINDS: KindLookup = {
  qualified: (library, name) =>
    bundle.kinds.find((kind) => kind.library === library && kind.name === name) ?? null,
  unqualified: (name, from) => KINDS.qualified(from, name) ?? KINDS.qualified('sprout', name),
};

const id = (...path: string[]): InstanceId => declaredId('keep', path);
const HALL = id('hall');
const NOOK = id('nook');
const CRATE = id('hall', 'crate');
const BIN = id('hall', 'bin');
const APPLE = id('hall', 'crate', 'apple');
const PLAIN = id('hall', 'plain');
const COUNTED = id('hall', 'counted');
const SILENT = id('hall', 'silent');

/** A fresh turn, with a visitor of the given strength standing in the hall. */
function turn(strength = 5): { draft: Draft; visitor: InstanceId } {
  const draft = new Draft(initialState(catalogue));
  const visitor = draft.mint();
  const made = newInstance(
    visitor,
    { from: 'visitor' },
    catalogue.visitorKind!,
    HALL,
    draft.nextSerial(),
    CAPS,
  );
  draft.add({ ...made, properties: new Map([...made.properties, ['strength', strength]]) });
  return { draft, visitor };
}

/** The one guard of this name that `self`'s kind runs. */
function guardOf(draft: Draft, self: InstanceId, name: GuardName): ResolvedGuard {
  const guards = draft.instance(self)!.kind.guards[name];
  expect(guards).toHaveLength(1);
  return guards[0]!;
}

interface Asked {
  readonly draft: Draft;
  readonly self: InstanceId;
  readonly mover: InstanceId;
  readonly parameters: readonly InstanceId[];
  readonly budget?: Budget;
}

function ask(guard: GuardName, asked: Asked): 'allow' | Refusal {
  const context: GuardContext = {
    state: asked.draft,
    kinds: KINDS,
    budget: asked.budget ?? new Budget(DEFAULT_LIMITS.budgets),
    caps: CAPS,
    self: asked.self,
    mover: asked.mover,
    parameters: asked.parameters,
  };
  return runGuard(guardOf(asked.draft, asked.self, guard), context);
}

/** What a refusal said: the passage's name and origin with its raw words, or the quoted text. */
function said(outcome: 'allow' | Refusal): string {
  if (outcome === 'allow') return 'allow';
  if ('text' in outcome.said) return `"${outcome.said.text}"`;
  const { passage } = outcome.said;
  return `${passage.origin} ${passage.name}: ${passage.body.text.trim()}`;
}

describe('how a guard ends', () => {
  it('allows when it reaches its end having said nothing', () => {
    const { draft, visitor } = turn();
    // Room for one more, the lid open, and the item not a person.
    const pear = { draft, self: BIN, mover: visitor, parameters: [APPLE, CRATE] };
    expect(ask('accept', pear)).toBe('allow');
    const empty = { draft, self: SILENT, mover: visitor, parameters: [APPLE, CRATE] };
    expect(ask('accept', empty)).toBe('allow');
  });

  it('allows at `allow`, and nothing after it runs', () => {
    const { draft, visitor } = turn();
    const budget = new Budget(DEFAULT_LIMITS.budgets);
    expect(ask('depart', { draft, self: PLAIN, mover: visitor, parameters: [HALL], budget })).toBe(
      'allow',
    );
    // The `allow` alone: the `refuse` after it is never charged.
    expect(budget.spentSteps).toBe(1);
  });

  it('refuses with words in quotes', () => {
    const { draft, visitor } = turn();
    const outcome = ask('accept', {
      draft,
      self: BIN,
      mover: visitor,
      parameters: [visitor, HALL],
    });
    expect(outcome).toEqual({
      guard: 'accept',
      by: BIN,
      origin: 'keep.Crate',
      said: { text: 'No climbing in.' },
    });
  });

  it('refuses with a passage, carrying its origin and its words unrendered', () => {
    const { draft, visitor } = turn(1);
    const outcome = ask('depart', { draft, self: CRATE, mover: visitor, parameters: [visitor] });
    expect(outcome).not.toBe('allow');
    expect((outcome as Refusal).by).toBe(CRATE);
    expect((outcome as Refusal).origin).toBe('keep.Crate');
    expect(said(outcome)).toBe('keep.Crate heavy: It is too heavy to lift.');
  });

  it("looks a passage up on the refusing instance's kind, so a composer's own line replaces a default", () => {
    const { draft, visitor } = turn();
    for (const box of [CRATE, BIN]) {
      const instance = draft.instance(box)!;
      draft.write({ ...instance, properties: new Map([...instance.properties, ['open', false]]) });
    }
    const crate = ask('accept', { draft, self: CRATE, mover: visitor, parameters: [APPLE, HALL] });
    const bin = ask('accept', { draft, self: BIN, mover: visitor, parameters: [APPLE, CRATE] });
    expect(said(crate)).toBe('keep.Crate shut: {self} is shut.');
    expect(said(bin)).toBe('keep.Bin shut: The lid of {self} is down.');
    // The guard is still `Crate`'s: only the words are the bin's.
    expect((bin as Refusal).origin).toBe('keep.Crate');
  });
});

describe('the statements', () => {
  it('takes the first branch of an `else if` chain whose condition holds, and only that one', () => {
    const { draft, visitor } = turn();
    // The crate holds the apple; filling it to capacity makes it full, and
    // `full` is decided before the item is asked about.
    const crate = draft.instance(CRATE)!;
    draft.write({ ...crate, properties: new Map([...crate.properties, ['capacity', 1]]) });
    const full = ask('accept', { draft, self: CRATE, mover: visitor, parameters: [visitor, HALL] });
    expect(said(full)).toBe('keep.Crate full: There is no room in {self}.');
  });

  it('reads a `let` for the rest of its block, and inner ones inside theirs', () => {
    const { draft, visitor } = turn();
    const out = { draft, self: CRATE, mover: visitor, parameters: [APPLE, HALL] };
    expect(ask('release', out)).toBe('allow');

    const crate = draft.instance(CRATE)!;
    draft.write({ ...crate, properties: new Map([...crate.properties, ['capacity', 1]]) });
    expect(said(ask('release', out))).toBe('"It is packed too tight to get anything out."');

    draft.write({
      ...crate,
      properties: new Map([...crate.properties, ['open', false]]),
    });
    expect(said(ask('release', out))).toBe('keep.Crate shut: {self} is shut.');
  });

  it('binds `mover` and the parameters, positionally, under the names the guard gives them', () => {
    const { draft, visitor } = turn();
    // `mover == self` allows before anything else is asked.
    expect(ask('depart', { draft, self: CRATE, mover: CRATE, parameters: [NOOK] })).toBe('allow');
    expect(said(ask('depart', { draft, self: CRATE, mover: visitor, parameters: [NOOK] }))).toBe(
      '"Not in there."',
    );
  });

  it('resolves a bare kind from the library of the kind that wrote the guard', () => {
    const { draft, visitor } = turn();
    // The world's `Place` is not `sprout.Place`, so the hall is not one.
    expect(ask('depart', { draft, self: CRATE, mover: visitor, parameters: [HALL] })).toBe('allow');
  });
});

describe('what a guard is charged', () => {
  it('charges one step for every statement executed and every expression node evaluated', () => {
    const { draft, visitor } = turn();
    const budget = new Budget(DEFAULT_LIMITS.budgets);
    expect(
      ask('depart', { draft, self: COUNTED, mover: visitor, parameters: [HALL], budget }),
    ).toBe('allow');
    // `let` and its `1`; `if` and `a == 1`, three nodes; `allow`.
    expect(budget.spentSteps).toBe(7);
  });

  it('throws `BudgetExhausted` at the step past the bound, and not before', () => {
    const { draft, visitor } = turn();
    const at = (steps: number) => new Budget({ ...DEFAULT_LIMITS.budgets, steps });
    const asked = { draft, self: COUNTED, mover: visitor, parameters: [HALL] };
    expect(() => ask('depart', { ...asked, budget: at(6) })).toThrow(BudgetExhausted);
    expect(ask('depart', { ...asked, budget: at(7) })).toBe('allow');
  });

  it('refuses to run with the wrong number of parameters, as an engine error', () => {
    const { draft, visitor } = turn();
    expect(() => ask('depart', { draft, self: PLAIN, mover: visitor, parameters: [] })).toThrow(
      /takes one parameter and was given 0/,
    );
  });
});
