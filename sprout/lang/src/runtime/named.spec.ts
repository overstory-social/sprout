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
import { spawnInstance } from './lifecycle.js';
import { readerOf } from './state.js';

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
    names: 'given',
    giver: 'bus.Lantern',
    path: ['wick'],
    depth: 0,
    kind: null,
  };

  it('is the declared object, the world, or the copy its holder was given', () => {
    const one = eventTurn();
    expect(objectNamed(declared('hall', 'lamp'), one.draft, LAMP)).toBe(LAMP);
    expect(objectNamed({ names: 'world' }, one.draft, LAMP)).toBe(BUS_WORLD);
    expect(objectNamed(wick, one.draft, LANTERN)).toBe(WICK);
    // From the wick's own body, one out is the lantern that holds it.
    expect(objectNamed({ ...wick, depth: 1 }, one.draft, WICK)).toBe(WICK);
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
