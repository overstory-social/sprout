import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { shop } from '../fixtures/bundle.js';
import { catalogueOf } from './catalogue.js';
import { Draft } from './draft.js';
import { declaredId, mintedId, type InstanceId } from './ids.js';
import { initialState } from './load.js';
import {
  DestroyedReference,
  namedObject,
  NameOutOfRange,
  objectNamed,
  reachedByName,
} from './named.js';
import {
  eventTurn,
  HALL,
  LAMP,
  LANTERN,
  STRAY,
  WICK,
  WORLD as BUS_WORLD,
  type EventTurn,
} from '../fixtures/events.js';
import type { Named } from '../declare/names.js';
import type { Frame } from './evaluate.js';
import { spawnInstance, type LifecycleContext } from './lifecycle.js';
import { readerOf } from './state.js';
import { compiledWorld } from '../fixtures/bundle.js';
import { Budget } from './budget.js';
import { passRules } from './passes.js';
import type { Bundle } from '../bundle/bundle.js';

const catalogue = catalogueOf(shop(), DEFAULT_LIMITS.caps);
const id = (...path: string[]): InstanceId => declaredId('printers_shop', path);
const JAR = id('hall', 'shelf', 'jar');

/** What `read` threw, or null where it threw nothing. */
function thrown(read: () => unknown): unknown {
  try {
    read();
    return null;
  } catch (fault) {
    return fault;
  }
}

describe('a name read at run time', () => {
  it('reaches the declared object it names', () => {
    const state = initialState(catalogue);
    expect(namedObject(readerOf(state), JAR)).toBe(state.instances.get(JAR));
  });

  it('faults on a declared object destroyed, from the moment the destroy takes effect', () => {
    const draft = new Draft(initialState(catalogue));
    draft.remove(id('hall', 'shelf'));
    const fault = thrown(() => namedObject(draft, JAR));
    expect(fault).toBeInstanceOf(DestroyedReference);
    expect((fault as DestroyedReference).object).toBe(JAR);
    expect((fault as DestroyedReference).message).toBe(
      '`printers_shop.hall.shelf.jar` was destroyed, and a declared object destroyed is gone for good.',
    );
    // A binding to it is not a name, and reads it as it was.
    expect(draft.destroyed(JAR)).toBeDefined();
  });

  it('faults on one destroyed in an earlier turn, and not on its neighbour', () => {
    const draft = new Draft(initialState(catalogue));
    draft.remove(JAR);
    const reader = readerOf(draft.commit().state);
    expect(thrown(() => namedObject(reader, JAR))).toBeInstanceOf(DestroyedReference);
    expect(namedObject(reader, id('hall', 'shelf', 'cup'))).not.toBeNull();
  });

  it('gives null for a declared id nothing is decoded under, which is absent and not destroyed', () => {
    const reader = readerOf(initialState(catalogue));
    expect(namedObject(reader, id('hall', 'nowhere'))).toBeNull();
  });

  it('never reaches a minted id, since a name reaches only what is declared', () => {
    const reader = readerOf(initialState(catalogue));
    expect(() => namedObject(reader, mintedId('printers_shop', 1))).toThrow(/minted/);
  });
});

describe('what a name a body wrote reaches while the world runs', () => {
  const declared = (...path: string[]): Named => ({ names: 'declared', path, kind: null });
  const wick: Named = {
    names: 'own',
    parts: ['wick'],
    steps: [{ in: 'kind', giver: 'bus.Lantern', path: ['wick'] }],
    kind: null,
  };

  it('is the declared object, the world, or the copy the running instance was given', () => {
    const one = eventTurn();
    expect(objectNamed(declared('hall', 'lamp'), one.draft, LAMP)).toBe(LAMP);
    expect(objectNamed({ names: 'world' }, one.draft, LAMP)).toBe(BUS_WORLD);
    expect(objectNamed(wick, one.draft, LANTERN)).toBe(WICK);
  });

  it('finds a spawned instance’s copy inside it, where no path names it', () => {
    const one = eventTurn();
    const lantern = spawnInstance(one.lifecycle, HALL, 'bus.Lantern', HALL);
    const found = objectNamed(wick, one.draft, lantern.id);
    expect(found).toBe(lantern.contents[0]);
    expect(found).not.toBe(WICK);
  });

  it('is nothing where nothing is decoded there now', () => {
    const one = eventTurn();
    expect(objectNamed(declared('hall', 'nowhere'), one.draft, LAMP)).toBeNull();
  });

  function frameOver(turn: EventTurn, self: typeof LAMP): Frame {
    return {
      state: turn.draft,
      kinds: turn.catalogue.lookup,
      library: 'bus',
      self,
      bindings: new Map(),
      budget: turn.budget,
      caps: turn.catalogue.caps,
      names: turn.catalogue.names,
      passes: turn.passes,
    };
  }

  it('is read through only in range, and faults where it is out of range or absent', () => {
    const one = eventTurn();
    expect(reachedByName(declared('hall', 'lantern'), 'lantern', frameOver(one, LAMP))).toBe(
      LANTERN,
    );
    const far = thrown(() =>
      reachedByName(declared('yard', 'stray'), 'yard.stray', frameOver(one, LAMP)),
    );
    expect(far).toBeInstanceOf(NameOutOfRange);
    expect((far as NameOutOfRange).object).toBe(STRAY);
    expect((far as NameOutOfRange).message).toBe(
      '`bus.yard.stray` is out of range of `bus.hall.lamp`, so it could not be read through `yard.stray`.',
    );
    const gone = thrown(() =>
      reachedByName(declared('hall', 'nowhere'), 'nowhere', frameOver(one, LAMP)),
    );
    expect((gone as NameOutOfRange).message).toBe(
      '`nowhere` reaches nothing here now, so `bus.hall.lamp` could not read through it.',
    );
  });
});

/**
 * `lamps`: a hall and a yard each holding a lamp and a lantern, a bare
 * cellar, and a lamp directly in the world. A lantern names `lamp` from its
 * kind's body, and its wick names the lantern's `oil` from its own.
 */
const LAMPS: Bundle = compiledWorld('lamps', {
  'world.sprout': `world lamps is sprout.World {
  visitors are Person
  visitors arrive at hall

  object hall is sprout.Place {
    object lamp is Lamp
    object lantern is Lantern
  }
  object yard is sprout.Place {
    object lamp is Lamp
    object lantern is Lantern
  }
  object cellar is sprout.Place
  object lamp is Lamp
}
`,
  'person.sprout': 'kind Person is sprout.Visitor { }\n',
  'lamp.sprout': 'message :stir\nkind Lamp {\n  on :stir { }\n}\n',
  'lantern.sprout': `kind Lantern {
  contains
  on :stir { send lamp :stir }
  object wick is Wick
  object oil is Oil
}
`,
  'wick.sprout': 'kind Wick {\n  on :stir { send oil :stir }\n}\n',
  'oil.sprout': 'kind Oil {\n  on :stir { }\n}\n',
});
const inLamps = (...path: string[]): InstanceId => declaredId('lamps', path);

/** What the bundle recorded for `name` where a kind's body writes it and the run decides. */
function placedName(name: string): Named {
  const found = [...LAMPS.names.values()].find(
    (named) =>
      named.names === 'placed' &&
      named.candidates.some((one) => one.steps.at(-1)!.path.at(-1) === name),
  );
  if (found === undefined) throw new Error(`nothing records \`${name}\` as placed.`);
  return found;
}

/** A fresh turn over `LAMPS` as declared. */
function lampsTurn(): LifecycleContext {
  const catalogue = catalogueOf(LAMPS, DEFAULT_LIMITS.caps);
  const draft = new Draft(initialState(catalogue));
  const budget = new Budget(DEFAULT_LIMITS.budgets);
  const passes = passRules({
    state: draft,
    kinds: catalogue.lookup,
    caps: catalogue.caps,
    budget,
    names: catalogue.names,
  });
  return { draft, catalogue, passes, budget, mayHold: null, now: 0 };
}

describe('a name in a kind’s body, while the world runs', () => {
  it('reaches a different object for each instance, by where each sits', () => {
    const turn = lampsTurn();
    const lamp = placedName('lamp');
    expect(objectNamed(lamp, turn.draft, inLamps('hall', 'lantern'))).toBe(inLamps('hall', 'lamp'));
    expect(objectNamed(lamp, turn.draft, inLamps('yard', 'lantern'))).toBe(inLamps('yard', 'lamp'));
  });

  it('counts outward from a spawned instance, to the world’s where nothing nearer has one', () => {
    const turn = lampsTurn();
    const lamp = placedName('lamp');
    const lantern = spawnInstance(turn, inLamps('cellar'), 'lamps.Lantern', inLamps('cellar'));
    expect(objectNamed(lamp, turn.draft, lantern.id)).toBe(inLamps('lamp'));
    turn.draft.place(lantern.id, inLamps('yard'));
    expect(objectNamed(lamp, turn.draft, lantern.id)).toBe(inLamps('yard', 'lamp'));
  });

  it('from a copy’s body, reaches what its holder’s body gives, wherever that holder was made', () => {
    const turn = lampsTurn();
    const oil = placedName('oil');
    expect(objectNamed(oil, turn.draft, inLamps('hall', 'lantern', 'wick'))).toBe(
      inLamps('hall', 'lantern', 'oil'),
    );
    const lantern = spawnInstance(turn, inLamps('cellar'), 'lamps.Lantern', inLamps('cellar'));
    const [wick, spawnedOil] = lantern.contents;
    expect(objectNamed(oil, turn.draft, wick!)).toBe(spawnedOil);
  });

  it('reaches nothing where no body around the instance declares the name, and faults read through', () => {
    const turn = lampsTurn();
    const oil = placedName('oil');
    const wick = inLamps('hall', 'lantern', 'wick');
    turn.draft.place(wick, inLamps('cellar'));
    expect(objectNamed(oil, turn.draft, wick)).toBeNull();
    const frame: Frame = {
      state: turn.draft,
      kinds: turn.catalogue.lookup,
      library: 'lamps',
      self: wick,
      bindings: new Map(),
      budget: turn.budget,
      caps: turn.catalogue.caps,
      names: turn.catalogue.names,
      passes: turn.passes,
    };
    const fault = thrown(() => reachedByName(oil, 'oil', frame));
    expect(fault).toBeInstanceOf(NameOutOfRange);
    expect((fault as NameOutOfRange).message).toBe(
      '`oil` reaches nothing here now, so `lamps.hall.lantern.wick` could not read through it.',
    );
  });
});
