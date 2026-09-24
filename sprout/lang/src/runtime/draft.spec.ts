import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { shop, shopWithheld } from '../fixtures/bundle.js';
import { catalogueOf } from './catalogue.js';
import { changesBetween, Draft, storedChanges } from './draft.js';
import { declaredId, mintedId, visitKey, type InstanceId } from './ids.js';
import { initialState, loadWorld, saveWorld } from './load.js';
import { newInstance, readerOf, type Instance, type WorldState } from './state.js';

const CAPS = DEFAULT_LIMITS.caps;
const catalogue = catalogueOf(shop(), CAPS);
const JAR = catalogue.kinds.get('printers_shop.Jar')!;
const PERSON = catalogue.visitorKind!;
const id = (...path: string[]): InstanceId => declaredId('printers_shop', path);
const minted = (serial: number): InstanceId => mintedId('printers_shop', serial);
const HALL = id('hall');
const SHELF = id('hall', 'shelf');
const BOX = id('hall', 'box');
const JAR_ID = id('hall', 'shelf', 'jar');
const CUP_ID = id('hall', 'shelf', 'cup');
const TIN = id('hall', 'box', 'tin');

/** A jar spawned into `container` by `draft`, the way `spawn` will: a minted id, and an arrival after it. */
function spawnJar(draft: Draft, container: InstanceId): Instance {
  const jar = newInstance(
    draft.mint(),
    { from: 'spawned', kind: 'printers_shop.Jar' },
    JAR,
    container,
    draft.nextSerial(),
    CAPS,
  );
  draft.add(jar);
  return jar;
}

const filled = (instance: Instance, fill: number): Instance => ({
  ...instance,
  properties: new Map([...instance.properties, ['fill', fill]]),
});

describe('a draft reads through to its state and holds only what the turn changed', () => {
  it('reads the state it was opened on until something is written', () => {
    const base = initialState(catalogue);
    const draft = new Draft(base);
    expect(draft.world).toBe(base.world);
    expect(draft.instance(JAR_ID)).toBe(base.instances.get(JAR_ID));
    expect(draft.children(SHELF)).toEqual([JAR_ID, CUP_ID]);
    expect(draft.children(JAR_ID)).toEqual([]);
  });

  it('leaves the state it was opened on exactly as it was when dropped', () => {
    const base = initialState(catalogue);
    const before = JSON.stringify(saveWorld(base));
    const children = base.children.get(SHELF);
    const draft = new Draft(base);
    draft.write(filled(draft.instance(JAR_ID)!, 9));
    spawnJar(draft, SHELF);
    draft.place(CUP_ID, HALL);
    draft.remove(JAR_ID);
    expect(JSON.stringify(saveWorld(base))).toBe(before);
    expect(base.children.get(SHELF)).toBe(children);
    expect(base.children.get(SHELF)).toEqual([JAR_ID, CUP_ID]);
    expect(base.serial).toBe(0);
  });

  it('is invisible to a reader of the committed state, as a poll is', () => {
    const base = initialState(catalogue);
    const poll = readerOf(base);
    const draft = new Draft(base);
    draft.write(filled(draft.instance(JAR_ID)!, 9));
    const spawned = spawnJar(draft, HALL);
    expect(draft.instance(JAR_ID)!.properties.get('fill')).toBe(9);
    expect(poll.instance(JAR_ID)!.properties.get('fill')).toBe(3);
    expect(poll.instance(spawned.id)).toBeUndefined();
    expect(poll.children(HALL)).toEqual([SHELF, BOX]);
  });
});

describe('ids a draft mints', () => {
  it('are the same from two drafts opened on one state, as a transaction body run twice must be', () => {
    const base = initialState(catalogue);
    const run = () => {
      const draft = new Draft(base);
      return [spawnJar(draft, HALL).id, draft.mint(), draft.nextSerial()];
    };
    expect(run()).toEqual(run());
    expect(run()).toEqual([minted(1), minted(3), 4]);
  });

  it('are never issued twice, even for one destroyed', () => {
    const draft = new Draft(initialState(catalogue));
    const first = spawnJar(draft, HALL);
    expect(first.id).toBe(minted(1));
    draft.remove(first.id);
    expect(draft.mint()).toBe(minted(3));
    const { state } = draft.commit();
    expect(new Draft(state).mint()).toBe(minted(4));
  });

  it('carry on from the serial the state was saved at', () => {
    const draft = new Draft(initialState(catalogue));
    spawnJar(draft, HALL);
    const { state } = draft.commit();
    const reloaded = loadWorld(saveWorld(state), catalogue).state;
    expect(new Draft(reloaded).mint()).toBe(minted(3));
  });
});

describe('writing, placing, adding and removing', () => {
  it('writes a record in place, and refuses one that moves it', () => {
    const draft = new Draft(initialState(catalogue));
    const jar = draft.instance(JAR_ID)!;
    expect(() => draft.write({ ...jar, container: HALL })).toThrow(/moved with `place`/);
    expect(() => draft.write({ ...jar, arrival: 1 })).toThrow(/moved with `place`/);
    expect(() => draft.write({ ...jar, id: minted(9) })).toThrow(/not an instance/);
    draft.write(filled(jar, 1));
    expect(draft.instance(JAR_ID)!.properties.get('fill')).toBe(1);
  });

  it('places something after whatever its new container already holds, under a new serial', () => {
    const draft = new Draft(initialState(catalogue));
    const spawned = spawnJar(draft, SHELF);
    draft.place(JAR_ID, SHELF);
    expect(draft.children(SHELF)).toEqual([CUP_ID, spawned.id, JAR_ID]);
    expect(draft.instance(JAR_ID)!.arrival).toBe(3);
    draft.place(CUP_ID, HALL);
    expect(draft.children(HALL)).toEqual([SHELF, BOX, CUP_ID]);
    expect(draft.children(SHELF)).toEqual([spawned.id, JAR_ID]);
  });

  it('never places the world, nor anything inside itself, nor into what is not there', () => {
    const draft = new Draft(initialState(catalogue));
    expect(() => draft.place(draft.world, HALL)).toThrow(/world/);
    expect(() => draft.place(HALL, SHELF)).toThrow(/inside itself/);
    expect(() => draft.place(SHELF, SHELF)).toThrow(/inside itself/);
    expect(() => draft.place(JAR_ID, id('cellar'))).toThrow(/not an instance/);
    expect(() => draft.place(JAR_ID, null)).toThrow(/not a visitor/);
    draft.place(HALL, draft.world);
    expect(draft.children(draft.world)).toEqual([id('yard'), HALL]);
  });

  it('takes a visitor out of the tree while they are away, without an arrival', () => {
    const draft = new Draft(initialState(catalogue));
    const marta = newInstance(
      draft.mint(),
      { from: 'visitor' },
      PERSON,
      HALL,
      draft.nextSerial(),
      CAPS,
    );
    draft.add(marta);
    expect(draft.children(HALL)).toEqual([SHELF, BOX, marta.id]);
    draft.place(marta.id, null);
    expect(draft.children(HALL)).toEqual([SHELF, BOX]);
    expect(draft.instance(marta.id)!.container).toBeNull();
    expect(draft.instance(marta.id)!.arrival).toBe(2);
    expect(draft.nextSerial()).toBe(3);
  });

  it('adds only under an id no instance has had', () => {
    const loaded = loadWorld(
      saveWorld(initialState(catalogue)),
      catalogueOf(shopWithheld(), CAPS),
    ).state;
    const draft = new Draft(loaded);
    const at = (instanceId: InstanceId) =>
      newInstance(instanceId, { from: 'spawned', kind: 'printers_shop.Jar' }, JAR, HALL, 1, CAPS);
    expect(() => draft.add(at(JAR_ID))).toThrow(/taken/);
    expect(() => draft.add(at(draft.world))).toThrow(/taken/);
    // Dormant, and still the kiln's.
    expect(() => draft.add(at(id('yard', 'kiln')))).toThrow(/taken/);
    const spawned = spawnJar(draft, HALL);
    draft.remove(spawned.id);
    expect(() => draft.add({ ...spawned })).toThrow(/taken/);
    expect(() => draft.add({ ...at(minted(9)), arrival: null })).toThrow(/arrival/);
  });

  it('removes what it names and everything inside it, all the way down, and never the world', () => {
    const draft = new Draft(initialState(catalogue));
    const held = draft.held;
    expect(() => draft.remove(draft.world)).toThrow(/world/);
    const inner = spawnJar(draft, SHELF);
    expect(draft.remove(HALL)).toEqual([HALL, SHELF, JAR_ID, CUP_ID, inner.id, BOX, TIN]);
    expect(draft.held).toBe(held + 1 - 7);
    expect(draft.children(draft.world)).toEqual([id('yard')]);
    for (const one of [HALL, SHELF, JAR_ID, CUP_ID, inner.id, BOX, TIN]) {
      expect(draft.instance(one)).toBeUndefined();
      expect(draft.children(one)).toEqual([]);
    }
    // Each stays readable where it was, inside what was removed with it.
    expect(draft.destroyed(TIN)!.container).toBe(BOX);
    expect(() => draft.remove(SHELF)).toThrow(/not an instance/);
  });

  it('removes the dormant records inside what it removes, and the decoded ones they hold', () => {
    // `Crate` is absent, so the box is dormant and the tin in it is decoded but not live.
    const base = loadWorld(
      saveWorld(initialState(catalogue)),
      catalogueOf(shopWithheld(), CAPS),
    ).state;
    expect(base.dormant.has(BOX)).toBe(true);
    expect(base.instances.get(TIN)!.container).toBe(BOX);
    const draft = new Draft(base);
    const held = draft.held;
    expect(draft.subtree(HALL)).toEqual([HALL, SHELF, JAR_ID, CUP_ID, BOX, TIN]);
    expect(draft.dormant(BOX)).toBe(base.dormant.get(BOX));
    expect(draft.remove(HALL)).toEqual([HALL, SHELF, JAR_ID, CUP_ID, BOX, TIN]);
    expect(draft.held).toBe(held - 6);
    expect(draft.dormant(BOX)).toBeUndefined();
    expect(draft.subtree(id('yard'))).toEqual([id('yard'), id('yard', 'kiln')]);
    const { state, changes } = draft.commit();
    expect(changes.removed).toEqual([HALL, SHELF, JAR_ID, CUP_ID, BOX, TIN].sort());
    // The dormant box was declared, so it is gone for good with the rest.
    expect(changes.tombstoned).toEqual([HALL, SHELF, JAR_ID, CUP_ID, BOX, TIN].sort());
    expect(state.dormant.has(BOX)).toBe(false);
    expect(state.dormant.has(id('yard', 'kiln'))).toBe(true);
    expect(state.children.has(BOX)).toBe(false);
    expect(state.instances.size + state.dormant.size).toBe(held - 6);
    // A reload finds none of it stored, dormant or otherwise.
    const saved = saveWorld(state).instances.map((one) => one.id);
    for (const one of [BOX, TIN, SHELF]) expect(saved).not.toContain(one);
  });

  it('tombstones every declared object it removes, and nothing that was spawned', () => {
    const base = initialState(catalogue);
    const draft = new Draft(base);
    const inner = spawnJar(draft, SHELF);
    draft.remove(HALL);
    for (const one of [HALL, SHELF, JAR_ID, CUP_ID, BOX, TIN]) {
      expect(draft.tombstoned(one)).toBe(true);
    }
    expect(draft.tombstoned(inner.id)).toBe(false);
    expect(draft.tombstoned(id('yard'))).toBe(false);
    // The committed state knows nothing of it until the turn commits.
    expect(readerOf(base).tombstoned(HALL)).toBe(false);
    const { state, changes } = draft.commit();
    expect(changes.tombstoned).toEqual([HALL, SHELF, JAR_ID, CUP_ID, BOX, TIN].sort());
    expect([...state.tombstones].sort()).toEqual(changes.tombstoned);
    // A later turn still knows, and nothing may take the id again.
    const next = new Draft(state);
    expect(next.tombstoned(JAR_ID)).toBe(true);
    const again = newInstance(JAR_ID, { from: 'declared' }, JAR, id('yard'), 1, CAPS);
    expect(() => next.add(again)).toThrow(/never reused/);
  });

  it('counts what the world stores, dormant included, up for an add and down for a remove', () => {
    const base = loadWorld(
      saveWorld(initialState(catalogue)),
      catalogueOf(shopWithheld(), CAPS),
    ).state;
    expect(base.dormant.size).toBeGreaterThan(0);
    const draft = new Draft(base);
    const stored = base.instances.size + base.dormant.size;
    expect(draft.held).toBe(stored);
    const spawned = spawnJar(draft, HALL);
    expect(draft.held).toBe(stored + 1);
    draft.remove(spawned.id);
    draft.remove(JAR_ID);
    expect(draft.held).toBe(stored - 1);
    draft.place(CUP_ID, HALL);
    expect(draft.held).toBe(stored - 1);
    const { state } = draft.commit();
    expect(state.instances.size + state.dormant.size).toBe(stored - 1);
  });

  it('keeps what it removed readable, as it was, for the rest of the turn', () => {
    const draft = new Draft(initialState(catalogue));
    draft.write(filled(draft.instance(JAR_ID)!, 8));
    draft.remove(JAR_ID);
    expect(draft.instance(JAR_ID)).toBeUndefined();
    expect(draft.destroyed(JAR_ID)!.properties.get('fill')).toBe(8);
    expect(draft.destroyed(CUP_ID)).toBeUndefined();
  });

  it('records a visitor, over the one committed', () => {
    const base = initialState(catalogue);
    const draft = new Draft(base);
    const visit = visitKey('v-1');
    draft.putVisitor({ visit, nickname: 'Marta', instance: minted(1), lastPlace: null });
    expect(draft.visitor(visit)!.nickname).toBe('Marta');
    expect(base.visitors.has(visit)).toBe(false);
  });
});

describe('committing', () => {
  /** A turn that fills the jar, spawns one jar and destroys it, spawns another, moves the cup and removes the shelf's contents. */
  function turn(base: WorldState) {
    const draft = new Draft(base);
    draft.write(filled(draft.instance(JAR_ID)!, 9));
    const passing = spawnJar(draft, HALL);
    draft.remove(passing.id);
    const kept = spawnJar(draft, SHELF);
    draft.place(CUP_ID, HALL);
    draft.remove(JAR_ID);
    draft.putVisitor({
      visit: visitKey('v-1'),
      nickname: 'Marta',
      instance: kept.id,
      lastPlace: HALL,
    });
    return { draft, kept };
  }

  it('lists exactly what was written and what was removed', () => {
    const { draft, kept } = turn(initialState(catalogue));
    const { changes } = draft.commit();
    expect(changes).toEqual({
      serial: 5,
      written: [CUP_ID, kept.id].sort(),
      removed: [JAR_ID],
      tombstoned: [JAR_ID],
      visitors: ['v-1'],
    });
  });

  it('gives a state in which the turn happened', () => {
    const { draft, kept } = turn(initialState(catalogue));
    const { state } = draft.commit();
    expect(state.serial).toBe(5);
    expect(state.instances.has(JAR_ID)).toBe(false);
    expect(state.instances.has(minted(1))).toBe(false);
    expect(state.children.get(SHELF)).toEqual([kept.id]);
    expect(state.children.get(HALL)).toEqual([SHELF, BOX, CUP_ID]);
    expect(state.visitors.get(visitKey('v-1'))!.instance).toBe(kept.id);
  });

  it('closes the draft', () => {
    const { draft } = turn(initialState(catalogue));
    draft.commit();
    expect(() => draft.commit()).toThrow(/closed/);
    expect(() => draft.mint()).toThrow(/closed/);
  });

  it('hands a store exactly the records a full save would hold for what changed', () => {
    const base = initialState(catalogue);
    const { draft } = turn(base);
    const { state, changes } = draft.commit();
    const written = storedChanges(state, changes);
    const saved = saveWorld(state);
    expect(written.serial).toBe(saved.serial);
    expect(written.upsert).toEqual(
      saved.instances.filter((one) => changes.written.includes(one.id as InstanceId)),
    );
    expect(written.remove).toEqual([JAR_ID]);
    expect(written.tombstones).toEqual([JAR_ID]);
    expect([...saveWorld(base).tombstones, ...written.tombstones]).toEqual(saved.tombstones);
    expect(written.visitors).toEqual(saved.visitors);
    // Applying the change set to the base's save gives the new state's save.
    const before = saveWorld(base);
    const applied = new Map(before.instances.map((one) => [one.id, one]));
    for (const one of written.remove) applied.delete(one);
    for (const one of written.upsert) applied.set(one.id, one);
    expect([...applied.values()].sort((a, b) => (a.id < b.id ? -1 : 1))).toEqual(saved.instances);
  });
});

describe('what changed between two states', () => {
  it('is what one draft committed, where one draft took one to the other', () => {
    const base = initialState(catalogue);
    const draft = new Draft(base);
    draft.write(filled(draft.instance(JAR_ID)!, 9));
    const passing = spawnJar(draft, HALL);
    draft.remove(passing.id);
    const kept = spawnJar(draft, SHELF);
    draft.place(CUP_ID, HALL);
    draft.remove(JAR_ID);
    draft.putVisitor({
      visit: visitKey('v-1'),
      nickname: 'Marta',
      instance: kept.id,
      lastPlace: HALL,
    });
    const { state, changes } = draft.commit();
    expect(changesBetween(base, state)).toEqual(changes);
  });

  it('spans several drafts, each opened on the last one’s state, as one change set', () => {
    const base = initialState(catalogue);
    const first = new Draft(base);
    const made = spawnJar(first, HALL);
    first.write(filled(first.instance(JAR_ID)!, 9));
    const middle = first.commit().state;
    const second = new Draft(middle);
    // Made by the first, removed by the second: in neither list.
    second.remove(made.id);
    second.remove(TIN);
    const after = second.commit().state;
    expect(changesBetween(base, after)).toEqual({
      serial: after.serial,
      written: [JAR_ID],
      removed: [TIN],
      tombstoned: [TIN],
      visitors: [],
    });
    expect(changesBetween(after, after)).toEqual({
      serial: after.serial,
      written: [],
      removed: [],
      tombstoned: [],
      visitors: [],
    });
  });
});
