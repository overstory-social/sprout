import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS, limitsFrom } from '../bundle/limits.js';
import { WORLD_PASSES_ANYTHING } from '../declare/world.js';
import { compiledWorld, SHOP, shopWithheld } from '../fixtures/bundle.js';
import { chooser } from '../fixtures/parse.js';
import { Budget, BudgetExhausted } from './budget.js';
import { catalogueOf, type Catalogue } from './catalogue.js';
import { Draft } from './draft.js';
import { declaredId, mintedId, visitKey, type InstanceId } from './ids.js';
import {
  destroyInstance,
  LifecycleFault,
  spawnInstance,
  type LifecycleContext,
  type LifecycleFaultReason,
} from './lifecycle.js';
import { isLive } from './live.js';
import { initialState, loadWorld, saveWorld } from './load.js';
import type { PassRule } from './range.js';
import { newInstance, type Instance, type WorldState } from './state.js';

const CAPS = DEFAULT_LIMITS.caps;

/** The shop, with a `Cup` to spawn and a cat, an NPC, asleep in the kiln. */
const catalogueSource = `${SHOP['world.sprout']!}kind Cup { :full false }\nobject cat: Person in yard.kiln\n`;
const catalogue = catalogueOf(
  compiledWorld('printers_shop', { ...SHOP, 'world.sprout': catalogueSource }),
  CAPS,
);
const PERSON = catalogue.kinds.get('printers_shop.Person')!;
const CUP = 'printers_shop.Cup';
const CRATE = 'printers_shop.Crate';

const id = (...path: string[]): InstanceId => declaredId('printers_shop', path);
const minted = (serial: number): InstanceId => mintedId('printers_shop', serial);
const WORLD_ID = id();
const HALL = id('hall');
const YARD = id('yard');
const SHELF = id('hall', 'shelf');
const BOX = id('hall', 'box');
const JAR = id('hall', 'shelf', 'jar');
const CUP_ID = id('hall', 'shelf', 'cup');
const KILN = id('yard', 'kiln');
const CAT = id('yard', 'kiln', 'cat');
const TIN = id('hall', 'box', 'tin');

/** The shop saved and loaded with `kiln.sprout` withheld: `Crate` is absent, so the kiln and the box are dormant. */
const withheld = (): WorldState =>
  loadWorld(
    saveWorld(initialState(catalogue)),
    catalogueOf(
      compiledWorld(
        'printers_shop',
        { ...SHOP, 'world.sprout': catalogueSource },
        {
          mode: 'load',
          withheld: ['kiln.sprout'],
        },
      ),
      CAPS,
    ),
  ).state;

/** The world refuses, as its unwritten rule does; the ids in `shut` refuse; everything else relays. */
const passing =
  (...shut: InstanceId[]): PassRule<InstanceId> =>
  (container) =>
    container === WORLD_ID ? WORLD_PASSES_ANYTHING : !shut.includes(container);

function context(
  draft: Draft,
  over: Partial<Omit<LifecycleContext, 'draft'>> = {},
): LifecycleContext {
  return {
    draft,
    catalogue,
    passes: passing(),
    budget: new Budget(DEFAULT_LIMITS.budgets),
    mayHold: null,
    ...over,
  };
}

/** A visitor standing in `container`, as arrival will add one. */
function visitorIn(draft: Draft, container: InstanceId): InstanceId {
  const visitor = newInstance(
    draft.mint(),
    { from: 'visitor' },
    PERSON,
    container,
    draft.nextSerial(),
    CAPS,
  );
  draft.add(visitor);
  return visitor.id;
}

/** What `run` throws, which must be a `LifecycleFault`. */
function faultOf(run: () => unknown): LifecycleFault {
  try {
    run();
  } catch (error) {
    if (error instanceof LifecycleFault) return error;
    throw error;
  }
  throw new Error('expected a fault, and nothing faulted.');
}

/** Run `run` over a draft of `base`, expect the fault named, and prove nothing was written. */
function faultsWritingNothing(
  base: WorldState,
  run: (draft: Draft) => unknown,
  reason: LifecycleFaultReason,
): LifecycleFault {
  const draft = new Draft(base);
  const held = draft.held;
  const fault = faultOf(() => run(draft));
  expect(fault.reason).toBe(reason);
  expect(draft.held).toBe(held);
  const { state, changes } = draft.commit();
  expect(changes).toEqual({ serial: base.serial, written: [], removed: [], visitors: [] });
  expect(JSON.stringify(saveWorld(state))).toBe(JSON.stringify(saveWorld(base)));
  return fault;
}

describe('a spawn', () => {
  it('makes an instance of the kind at its defaults, under a minted id, last in its container', () => {
    const draft = new Draft(initialState(catalogue));
    const spawned = spawnInstance(context(draft), JAR, CUP, SHELF);
    expect(spawned.id).toBe(minted(1));
    const cup = draft.instance(spawned.id)!;
    expect(cup.made).toEqual({ from: 'spawned', kind: CUP });
    expect(cup.kind).toBe(catalogue.kinds.get(CUP));
    expect(cup.properties).toEqual(new Map([['full', false]]));
    expect(cup.container).toBe(SHELF);
    expect(cup.arrival).toBe(2);
    expect(draft.children(SHELF)).toEqual([JAR, CUP_ID, spawned.id]);
  });

  it('tells the container `:entered` and then the new instance `:spawned`, each from the spawner', () => {
    const draft = new Draft(initialState(catalogue));
    const spawned = spawnInstance(context(draft), JAR, CUP, SHELF);
    expect(spawned.sends).toEqual([
      { message: 'entered', recipient: SHELF, item: spawned.id, from: JAR },
      { message: 'spawned', recipient: spawned.id, from: JAR },
    ]);
  });

  it('faults past the turn’s cap, writing nothing more', () => {
    const draft = new Draft(initialState(catalogue));
    const budget = new Budget(limitsFrom({ budgets: { spawnsPerTurn: 2 } }).budgets);
    spawnInstance(context(draft, { budget }), JAR, CUP, SHELF);
    spawnInstance(context(draft, { budget }), JAR, CUP, SHELF);
    const held = draft.held;
    const children = draft.children(SHELF);
    let thrown: unknown;
    try {
      spawnInstance(context(draft, { budget }), JAR, CUP, SHELF);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(BudgetExhausted);
    expect((thrown as BudgetExhausted).limit).toBe('spawnsPerTurn');
    expect(draft.held).toBe(held);
    expect(draft.children(SHELF)).toEqual(children);
  });

  it('faults when the host will hold no more, counting everything stored', () => {
    const base = initialState(catalogue);
    const mayHold = new Draft(base).held + 1;
    const draft = new Draft(base);
    spawnInstance(context(draft, { mayHold }), JAR, CUP, SHELF);
    const fault = faultOf(() => spawnInstance(context(draft, { mayHold }), JAR, CUP, SHELF));
    expect(fault.reason).toBe('instances');
    expect(fault.message).toBe(
      'the host will hold no more instances in this world, so `Cup` could not be spawned.',
    );
    faultsWritingNothing(
      base,
      (fresh) => spawnInstance(context(fresh, { mayHold: fresh.held }), JAR, CUP, SHELF),
      'instances',
    );
  });

  it('counts dormant instances toward the host’s bound', () => {
    const withheld = catalogueOf(shopWithheld(), CAPS);
    const loaded = loadWorld(saveWorld(initialState(catalogue)), withheld).state;
    expect(loaded.dormant.size).toBeGreaterThan(0);
    expect(new Draft(loaded).held).toBe(loaded.instances.size + loaded.dormant.size);
    const bound = loaded.instances.size + 1;
    const run = (draft: Draft) =>
      spawnInstance(
        { ...context(draft), catalogue: withheld, mayHold: bound },
        JAR,
        'printers_shop.Jar',
        SHELF,
      );
    faultsWritingNothing(loaded, run, 'instances');
  });

  it('is unbounded where the host sets no bound', () => {
    const draft = new Draft(initialState(catalogue));
    const budget = new Budget(limitsFrom({ budgets: { spawnsPerTurn: 40 } }).budgets);
    for (let n = 0; n < 40; n++) spawnInstance(context(draft, { budget }), JAR, CUP, SHELF);
    expect(draft.children(SHELF)).toHaveLength(42);
  });

  it('faults for a container out of range, with its text, writing nothing', () => {
    const base = initialState(catalogue);
    const fault = faultsWritingNothing(
      base,
      (draft) => spawnInstance(context(draft), JAR, CUP, YARD),
      'out-of-range',
    );
    expect(fault.object).toBe(YARD);
    expect(fault.message).toBe(
      '`printers_shop.yard` is out of range of `printers_shop.hall.shelf.jar`, so nothing could be spawned in it.',
    );
    faultsWritingNothing(
      base,
      (draft) => spawnInstance(context(draft, { passes: passing(SHELF) }), JAR, CUP, BOX),
      'out-of-range',
    );
  });

  it('charges the range check to the turn’s steps', () => {
    const draft = new Draft(initialState(catalogue));
    const budget = new Budget(DEFAULT_LIMITS.budgets);
    spawnInstance(context(draft, { budget }), JAR, CUP, BOX);
    expect(budget.spentSteps).toBeGreaterThan(0);
    expect(budget.spentSpawns).toBe(1);
  });

  it('faults for a container that holds nothing, with its text, writing nothing', () => {
    const fault = faultsWritingNothing(
      initialState(catalogue),
      (draft) => spawnInstance(context(draft), JAR, CUP, CUP_ID),
      'holds-nothing',
    );
    expect(fault.message).toBe(
      '`printers_shop.hall.shelf.cup` holds nothing, so `Cup` could not be spawned in it.',
    );
  });

  it('faults for a kind that is absent, the world’s own included, writing nothing', () => {
    const base = initialState(catalogue);
    const teapot = faultsWritingNothing(
      base,
      (draft) => spawnInstance(context(draft), JAR, 'printers_shop.Teapot', SHELF),
      'kind-absent',
    );
    expect(teapot.message).toBe('`Teapot` is absent, so it could not be spawned.');
    faultsWritingNothing(
      base,
      (draft) => spawnInstance(context(draft), JAR, 'sprout.World', SHELF),
      'kind-absent',
    );
    const withheld = catalogueOf(shopWithheld(), CAPS);
    const loaded = loadWorld(saveWorld(base), withheld).state;
    faultsWritingNothing(
      loaded,
      (draft) => spawnInstance({ ...context(draft), catalogue: withheld }, JAR, CRATE, SHELF),
      'kind-absent',
    );
  });

  it('may be made into the world where the world is in range', () => {
    const base = initialState(catalogue);
    const draft = new Draft(base);
    const spawned = spawnInstance(context(draft), JAR, CUP, WORLD_ID);
    expect(draft.children(WORLD_ID)).toEqual([HALL, YARD, spawned.id]);
    faultsWritingNothing(
      base,
      (fresh) => spawnInstance(context(fresh, { passes: passing(HALL) }), JAR, CUP, WORLD_ID),
      'out-of-range',
    );
  });

  it('may be made into the spawner itself', () => {
    const draft = new Draft(initialState(catalogue));
    const spawned = spawnInstance(context(draft, { passes: passing(SHELF) }), SHELF, CUP, SHELF);
    expect(draft.children(SHELF)).toEqual([JAR, CUP_ID, spawned.id]);
  });
});

describe('a destroy', () => {
  it('destroys what it held with it, all the way down, and sends nothing', () => {
    const base = initialState(catalogue);
    const draft = new Draft(base);
    const held = draft.held;
    const spawned = spawnInstance(context(draft), JAR, CUP, SHELF).id;
    const destroyed = destroyInstance(draft, HALL);
    const all = [HALL, SHELF, JAR, CUP_ID, spawned, BOX, TIN];
    expect(destroyed).toEqual({ id: HALL, removed: all });
    expect(Object.keys(destroyed)).not.toContain('sends');
    for (const one of all) expect(draft.instance(one)).toBeUndefined();
    expect(draft.children(WORLD_ID)).toEqual([YARD]);
    expect(draft.held).toBe(held + 1 - all.length);
    const { changes } = draft.commit();
    expect(changes.removed).toEqual(all.filter((one) => one !== spawned).sort());
    expect(changes.written).toEqual([]);
  });

  it('takes the pending wakes of everything inside it with their records', () => {
    const draft = new Draft(initialState(catalogue));
    const box = draft.instance(BOX)!;
    draft.write({ ...box, wakes: [{ serial: draft.nextSerial(), askedAt: 0, dueAt: 60 }] });
    destroyInstance(draft, HALL);
    const { state } = draft.commit();
    const waking = [...state.instances.values()].filter((one) => one.wakes.length > 0);
    expect(waking).toEqual([]);
  });

  it('destroys the dormant records inside it, and what they hold', () => {
    const base = withheld();
    expect(base.dormant.has(KILN)).toBe(true);
    const draft = new Draft(base);
    const destroyed = destroyInstance(draft, YARD);
    expect(destroyed.removed).toEqual([YARD, KILN, CAT]);
    const { state } = draft.commit();
    expect(state.dormant.has(KILN)).toBe(false);
    expect(state.instances.has(CAT)).toBe(false);
    expect(saveWorld(state).instances.map((one) => one.id)).not.toContain(KILN);
  });

  it('holds nothing afterwards, so a destroyed object held nothing to be told of', () => {
    const draft = new Draft(initialState(catalogue));
    const destroyed = destroyInstance(draft, JAR);
    expect(destroyed).toEqual({ id: JAR, removed: [JAR] });
    expect(draft.children(SHELF)).toEqual([CUP_ID]);
  });

  it('leaves each destroyed record readable, holding the state it had and where it was', () => {
    const draft = new Draft(initialState(catalogue));
    const cup = spawnInstance(context(draft), JAR, CUP, BOX).id;
    const record = draft.instance(cup)!;
    draft.write({ ...record, properties: new Map([['full', true]]) });
    destroyInstance(draft, HALL);
    expect(draft.instance(cup)).toBeUndefined();
    const final = draft.destroyed(cup)!;
    expect(final.properties.get('full')).toBe(true);
    expect(final.container).toBe(BOX);
    expect(draft.destroyed(BOX)!.container).toBe(HALL);
  });

  it('faults for the world and a visitor, writing nothing', () => {
    const empty = initialState(catalogue);
    const world = faultsWritingNothing(empty, (draft) => destroyInstance(draft, WORLD_ID), 'world');
    expect(world.message).toBe('the world cannot be destroyed.');

    const opened = new Draft(empty);
    const marta = visitorIn(opened, HALL);
    const base = opened.commit().state;
    const visitor = faultsWritingNothing(base, (draft) => destroyInstance(draft, marta), 'visitor');
    expect(visitor.message).toBe(
      '`printers_shop#1` is a visitor, and a person is never destroyed.',
    );
  });

  it('faults for a visitor anywhere inside, however deep, writing nothing', () => {
    const opened = new Draft(initialState(catalogue));
    const marta = visitorIn(opened, BOX);
    const base = opened.commit().state;
    const direct = faultsWritingNothing(
      base,
      (draft) => destroyInstance(draft, BOX),
      'visitor-inside',
    );
    expect(direct.object).toBe(BOX);
    const deep = faultsWritingNothing(
      base,
      (draft) => destroyInstance(draft, HALL),
      'visitor-inside',
    );
    expect(deep.object).toBe(HALL);
    expect(deep.message).toBe(
      `\`printers_shop.hall\` has the visitor \`${marta}\` inside it, and a person is never destroyed.`,
    );
    // Nothing else in the hall made the fault: without her, it is destroyed.
    const away = new Draft(base);
    away.place(marta, null);
    expect(destroyInstance(away, HALL).removed).toContain(BOX);
  });

  it('faults for a visitor kept dormant inside, writing nothing', () => {
    const opened = new Draft(initialState(catalogue));
    const marta = visitorIn(opened, KILN);
    opened.putVisitor({
      visit: visitKey('v-1'),
      nickname: 'Marta',
      instance: marta,
      lastPlace: KILN,
    });
    // Without a visitor kind, the visitor's record is kept dormant, still in the kiln.
    const base = loadWorld(saveWorld(opened.commit().state), {
      ...catalogue,
      visitorKind: null,
    }).state;
    expect(base.dormant.get(minted(1))!.container).toBe(KILN);
    faultsWritingNothing(base, (draft) => destroyInstance(draft, YARD), 'visitor-inside');
  });

  it('destroys an NPC inside it with everything else', () => {
    const draft = new Draft(initialState(catalogue));
    expect(draft.children(KILN)).toEqual([CAT]);
    expect(destroyInstance(draft, KILN).removed).toEqual([KILN, CAT]);
    expect(draft.children(YARD)).toEqual([]);
    expect(draft.destroyed(CAT)!.container).toBe(KILN);
  });

  it('nets to nothing after a spawn in the same turn', () => {
    const base = initialState(catalogue);
    const draft = new Draft(base);
    const held = draft.held;
    const cup = spawnInstance(context(draft), JAR, CUP, SHELF).id;
    expect(draft.held).toBe(held + 1);
    destroyInstance(draft, cup);
    expect(draft.held).toBe(held);
    const { state, changes } = draft.commit();
    expect(changes.removed).toEqual([]);
    expect(changes.written).toEqual([]);
    expect(state.instances.size + state.dormant.size).toBe(held);
  });

  it('never frees an id to be minted again', () => {
    const draft = new Draft(initialState(catalogue));
    const first = spawnInstance(context(draft), JAR, CUP, SHELF).id;
    destroyInstance(draft, first);
    const second = spawnInstance(context(draft), JAR, CUP, SHELF).id;
    expect(second).not.toBe(first);
    destroyInstance(draft, second);
    const { state } = draft.commit();
    const later = spawnInstance(context(new Draft(state)), JAR, CUP, SHELF).id;
    expect(new Set([first, second, later]).size).toBe(3);
    expect(later).toBe(minted(state.serial + 1));
  });
});

describe('what the engine sends', () => {
  it('names the recipient apart from the bindings its handler receives, as the spec names them', () => {
    const draft = new Draft(initialState(catalogue));
    const spawned = spawnInstance(context(draft), JAR, CUP, SHELF);
    const shapes = spawned.sends.map((send) => Object.keys(send).join(' '));
    // `:entered (item, from)` and `:spawned (from)`.
    expect(new Set(shapes)).toEqual(
      new Set(['message recipient item from', 'message recipient from']),
    );
  });
});

describe('any run of spawns, destroys and moves', () => {
  /** Everything the draft holds, by id, as far as `known` names it. */
  function existing(draft: Draft, known: Iterable<InstanceId>): Instance[] {
    return [...known].flatMap((one) => draft.instance(one) ?? []);
  }

  function run(seed: number, catalogueNow: Catalogue): void {
    const choose = chooser(seed);
    const base = initialState(catalogueNow);
    const draft = new Draft(base);
    const known = new Set<InstanceId>([...base.instances.keys()].filter((one) => one !== WORLD_ID));
    known.add(visitorIn(draft, HALL));
    const kinds = [...catalogueNow.kinds.keys(), 'printers_shop.Teapot'];
    const budget = new Budget(limitsFrom({ budgets: { spawnsPerTurn: 1000 } }).budgets);
    const lifecycle = { ...context(draft, { budget }), catalogue: catalogueNow };
    for (let step = 0; step < 60; step++) {
      const here = existing(draft, known).map((one) => one.id);
      const anywhere = [WORLD_ID, ...here];
      const action = choose.below(3);
      const before = JSON.stringify(
        [...anywhere].map((one) => [one, draft.instance(one)?.container, draft.children(one)]),
      );
      const heldBefore = draft.held;
      try {
        if (action === 0) {
          const spawned = spawnInstance(
            lifecycle,
            choose.one(here),
            choose.one(kinds),
            choose.one(anywhere),
          );
          known.add(spawned.id);
        } else if (action === 1) {
          const target = choose.one(anywhere);
          const inside = anywhere.filter((one) => {
            for (let at: InstanceId | null = one; at !== null; at = draft.instance(at)!.container) {
              if (at === target) return true;
            }
            return false;
          });
          const { removed } = destroyInstance(draft, target);
          // Exactly what was inside it, itself included, is gone, and nothing else.
          expect(new Set(removed), `seed ${seed}, step ${step}`).toEqual(new Set(inside));
          for (const one of removed) expect(draft.instance(one)).toBeUndefined();
        } else {
          const moving = choose.one(here);
          if (draft.instance(moving)!.made.from === 'visitor') continue;
          draft.place(moving, choose.one(anywhere));
        }
      } catch (error) {
        if (!(error instanceof LifecycleFault) && action !== 2) throw error;
        // A fault, or a move the draft refuses, writes nothing.
        const after = JSON.stringify(
          [...anywhere].map((one) => [one, draft.instance(one)?.container, draft.children(one)]),
        );
        expect(after, `seed ${seed}, step ${step}`).toBe(before);
        expect(draft.held).toBe(heldBefore);
      }
      const now = existing(draft, known);
      for (const one of now) {
        expect(isLive(draft, one.id), `seed ${seed}: ${one.id} is live`).toBe(true);
        const siblings = draft.children(one.container!);
        expect(siblings.filter((sibling) => sibling === one.id)).toHaveLength(1);
      }
      for (const holder of [WORLD_ID, ...now.map((one) => one.id)]) {
        for (const child of draft.children(holder)) {
          expect(draft.instance(child)?.container, `seed ${seed}: ${child} in ${holder}`).toBe(
            holder,
          );
        }
      }
      // The world, and everything else stored.
      expect(draft.held).toBe(1 + now.length + base.dormant.size);
    }
    const { state } = draft.commit();
    expect(state.instances.size + state.dormant.size).toBe(draft.held);
  }

  for (const seed of [1, 2, 3, 5, 8, 13, 21, 34]) {
    it(`keeps every container live, contents agreeing with containers, and the count true (seed ${seed})`, () => {
      run(seed, catalogue);
    });
  }
});
