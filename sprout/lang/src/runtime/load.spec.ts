import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { compiledWorld, SHOP, shop, shopWithheld } from '../fixtures/bundle.js';
import { catalogueOf, type Catalogue } from './catalogue.js';
import { declaredId, mintedId, visitKey, type InstanceId } from './ids.js';
import { isLive } from './live.js';
import { emptyWorld, initialState, loadWorld, saveWorld, type Loaded } from './load.js';
import { Draft } from './draft.js';
import { newInstance, readerOf } from './state.js';
import { StoredStateUnreadable, type StoredInstance, type StoredWorld } from './stored.js';

const CAPS = DEFAULT_LIMITS.caps;
const id = (...path: string[]): InstanceId => declaredId('printers_shop', path);
const minted = (serial: number): InstanceId => mintedId('printers_shop', serial);

const published = catalogueOf(shop(), CAPS);
const withheld = catalogueOf(shopWithheld(), CAPS);

/** What a new shop saves as. */
const fresh = (): StoredWorld => saveWorld(initialState(published));

/** A stored record with nothing in it but what a case says, its keys in the order a store writes them. */
function record(
  over: Partial<StoredInstance> & Pick<StoredInstance, 'id' | 'made'>,
): StoredInstance {
  const { id: recordId, made, ...rest } = over;
  return {
    id: recordId,
    made,
    container: 'printers_shop.hall',
    arrival: null,
    properties: {},
    links: {},
    wakes: [],
    memory: {},
    lastTick: null,
    ...rest,
  };
}

/** A stored world with records replaced or added by id, and the serial raised to `serial`. */
function storing(base: StoredWorld, records: StoredInstance[], serial = base.serial): StoredWorld {
  const by = new Map(base.instances.map((one) => [one.id, one]));
  for (const one of records) by.set(one.id, one);
  return { ...base, serial, instances: [...by.values()] };
}

const stored = (world: StoredWorld, instanceId: string): StoredInstance =>
  world.instances.find((one) => one.id === instanceId)!;

describe('a new world is an empty store, loaded', () => {
  const loaded = loadWorld(emptyWorld(published.world), published);

  it('is what `initialState` gives', () => {
    expect(saveWorld(initialState(published))).toEqual(saveWorld(loaded.state));
    expect(emptyWorld(published.world)).toEqual({
      world: 'printers_shop',
      serial: 0,
      instances: [],
      visitors: [],
      tombstones: [],
    });
  });

  it('creates the world and every declared object whose kind composed, at its defaults, in declared order', () => {
    expect(loaded.created).toEqual([
      published.world,
      id('hall'),
      id('yard'),
      id('hall', 'shelf'),
      id('hall', 'box'),
      id('yard', 'kiln'),
      id('hall', 'shelf', 'jar'),
      id('hall', 'shelf', 'cup'),
      id('hall', 'box', 'tin'),
    ]);
    const jar = loaded.state.instances.get(id('hall', 'shelf', 'jar'))!;
    expect(Object.fromEntries(jar.properties)).toEqual({ glaze: 'none', fill: 3 });
    expect(jar.container).toBe(id('hall', 'shelf'));
    expect(jar.arrival).toBeNull();
    expect(jar.made).toEqual({ from: 'declared' });
  });

  it('makes the world an instance of what it composes, holding its properties at the root', () => {
    const world = loaded.state.instances.get(published.world)!;
    expect(world.kind).toBe(published.worldKind);
    expect(Object.fromEntries(world.properties)).toEqual({ open: true });
    expect(world.container).toBeNull();
    expect(loaded.dormant).toEqual([]);
  });

  it('keeps the world as an empty record where the bundle has no world kind', () => {
    const closed = loadWorld(emptyWorld(published.world), { ...published, worldKind: null });
    expect(closed.state.instances.has(published.world)).toBe(false);
    expect(closed.dormant).toEqual([published.world]);
    expect(closed.state.dormant.get(published.world)).toEqual(
      record({ id: 'printers_shop', made: { from: 'world' }, container: null }),
    );
  });

  it('has issued no serial, holds no visitor, and dropped nothing', () => {
    expect(loaded.state.serial).toBe(0);
    expect(loaded.state.visitors.size).toBe(0);
    expect(loaded.dropped).toEqual([]);
  });
});

describe('a declared object is read against its kind now', () => {
  const jar = 'printers_shop.hall.shelf.jar';
  const loadJar = (
    properties: StoredInstance['properties'],
    memory: StoredInstance['memory'] = {},
  ) =>
    loadWorld(
      storing(
        fresh(),
        [
          record({
            id: jar,
            made: { from: 'declared' },
            container: 'printers_shop.hall.shelf',
            properties,
            memory,
          }),
        ],
        2,
      ),
      published,
    );

  it('keeps each stored value that still fits', () => {
    const loaded = loadJar({
      glaze: { type: 'printers_shop.Glaze', value: 'shino' },
      fill: { type: 'integer', value: 7 },
    });
    expect(Object.fromEntries(loaded.state.instances.get(jar as InstanceId)!.properties)).toEqual({
      glaze: 'shino',
      fill: 7,
    });
    expect(loaded.dropped).toEqual([]);
    expect(loaded.created).not.toContain(jar);
  });

  it('gives a property nothing was stored for its default, and drops nothing for it', () => {
    const loaded = loadJar({ glaze: { type: 'printers_shop.Glaze', value: 'shino' } });
    expect(loaded.state.instances.get(jar as InstanceId)!.properties.get('fill')).toBe(3);
    expect(loaded.dropped).toEqual([]);
  });

  it('drops a property no longer declared', () => {
    const loaded = loadJar({ colour: { type: 'string', value: 'blue' } });
    expect(loaded.state.instances.get(jar as InstanceId)!.properties.has('colour')).toBe(false);
    expect(loaded.dropped).toEqual([
      { id: jar, property: 'colour', actor: null, why: 'undeclared' },
    ]);
  });

  it('drops a value stored under another type, even one that would fit, and the default stands', () => {
    const loaded = loadJar({ glaze: { type: 'string', value: 'shino' } });
    expect(loaded.state.instances.get(jar as InstanceId)!.properties.get('glaze')).toBe('none');
    expect(loaded.dropped).toEqual([{ id: jar, property: 'glaze', actor: null, why: 'retyped' }]);
  });

  it('drops a value that no longer fits, rather than clamping it', () => {
    const loaded = loadJar({ fill: { type: 'integer', value: 12 } });
    expect(loaded.state.instances.get(jar as InstanceId)!.properties.get('fill')).toBe(3);
    expect(loaded.dropped).toEqual([
      { id: jar, property: 'fill', actor: null, why: 'no-longer-fits' },
    ]);
  });

  it('never holds a remembered property among its properties, and drops one stored there', () => {
    const loaded = loadJar({ seen: { type: 'boolean', value: true } });
    expect(loaded.state.instances.get(jar as InstanceId)!.properties.has('seen')).toBe(false);
    expect(loaded.dropped).toEqual([{ id: jar, property: 'seen', actor: null, why: 'retyped' }]);
  });

  it('keeps memory that fits, and deletes what misfits or is no longer remembered', () => {
    const marta = minted(1);
    const loaded = loadJar(
      {},
      {
        [marta]: { seen: { type: 'boolean', value: true } },
        [minted(2)]: {
          seen: { type: 'integer', value: 1 },
          fill: { type: 'integer', value: 4 },
          gone: { type: 'boolean', value: true },
        },
      },
    );
    const memory = loaded.state.instances.get(jar as InstanceId)!.memory;
    expect([...memory.keys()]).toEqual([marta]);
    expect(Object.fromEntries(memory.get(marta)!)).toEqual({ seen: true });
    expect(loaded.dropped).toEqual([
      { id: jar, property: 'fill', actor: minted(2), why: 'retyped' },
      { id: jar, property: 'gone', actor: minted(2), why: 'undeclared' },
      { id: jar, property: 'seen', actor: minted(2), why: 'retyped' },
    ]);
  });

  it('keeps a value written under an old default when the default changes in source', () => {
    const saved = fresh();
    const changed = catalogueOf(
      compiledWorld('printers_shop', {
        ...SHOP,
        'world.sprout': SHOP['world.sprout']!.replace(':fill 3 min', ':fill 5 min'),
      }),
      CAPS,
    );
    const loaded = loadWorld(saved, changed);
    expect(loaded.state.instances.get(id('hall', 'shelf', 'jar'))!.properties.get('fill')).toBe(3);
    expect(
      initialState(changed)
        .instances.get(id('hall', 'shelf', 'jar'))!
        .properties.get('fill'),
    ).toBe(5);
  });

  it('keeps links, wakes and the last tick as stored', () => {
    const links = { cellar: 'printers_shop.yard' };
    const wakes = [{ serial: 2, askedAt: 100, dueAt: 160 }];
    const loaded = loadWorld(
      storing(
        fresh(),
        [
          record({
            id: 'printers_shop.hall',
            made: { from: 'declared' },
            container: 'printers_shop',
            links,
            wakes,
            lastTick: 90,
          }),
        ],
        2,
      ),
      published,
    );
    const hall = loaded.state.instances.get(id('hall'))!;
    expect(Object.fromEntries(hall.links)).toEqual(links);
    expect(hall.wakes).toEqual(wakes);
    expect(hall.lastTick).toBe(90);
  });

  it('creates a declared object added to source since the store was saved', () => {
    const before = catalogueOf(
      compiledWorld('printers_shop', {
        ...SHOP,
        'world.sprout': SHOP['world.sprout']!.replace('      object cup is Jar\n', ''),
      }),
      CAPS,
    );
    const loaded = loadWorld(saveWorld(initialState(before)), published);
    expect(loaded.created).toEqual([id('hall', 'shelf', 'cup')]);
  });
});

describe('a declared object destroyed is gone for good', () => {
  /** The shop saved after a turn that destroyed `path`. */
  function destroyed(catalogue: Catalogue, ...path: string[]): StoredWorld {
    const draft = new Draft(initialState(catalogue));
    draft.remove(id(...path));
    return saveWorld(draft.commit().state);
  }

  it('is never made again at load, nor anything declared inside it', () => {
    const saved = destroyed(published, 'hall', 'shelf');
    expect(saved.tombstones).toEqual([
      id('hall', 'shelf'),
      id('hall', 'shelf', 'cup'),
      id('hall', 'shelf', 'jar'),
    ]);
    const loaded = loadWorld(saved, published);
    expect(loaded.created).toEqual([]);
    for (const one of saved.tombstones) {
      expect(loaded.state.instances.has(one as InstanceId)).toBe(false);
      expect(loaded.state.tombstones.has(one as InstanceId)).toBe(true);
    }
    expect(loaded.state.children.get(id('hall'))).toEqual([id('hall', 'box')]);
    expect(saveWorld(loaded.state)).toEqual(saved);
  });

  it('is not made from a new store either: the tombstone is what a store keeps', () => {
    const saved = destroyed(published, 'yard');
    const reloaded = loadWorld({ ...saved, instances: [] }, published);
    expect(reloaded.created).not.toContain(id('yard'));
    expect(reloaded.created).not.toContain(id('yard', 'kiln'));
    expect(reloaded.created).toContain(id('hall'));
  });

  it('holds nothing source adds inside it later, which has nowhere to be', () => {
    const later = catalogueOf(
      compiledWorld('printers_shop', {
        ...SHOP,
        'world.sprout': SHOP['world.sprout']!.replace(
          '      object cup is Jar\n',
          '      object cup is Jar\n      object bowl is Jar\n',
        ),
      }),
      CAPS,
    );
    const loaded = loadWorld(destroyed(published, 'hall', 'shelf'), later);
    expect(loaded.created).toEqual([]);
    expect(loaded.state.instances.has(id('hall', 'shelf', 'bowl'))).toBe(false);
    // Only a destroy writes a tombstone.
    expect(loaded.state.tombstones.has(id('hall', 'shelf', 'bowl'))).toBe(false);
  });

  it('takes what a kind gave it with it, the copies being declared too', () => {
    const lantern = catalogueOf(
      compiledWorld('printers_shop', {
        ...SHOP,
        'world.sprout': SHOP['world.sprout']!.replace(
          '    object kiln is Crate\n',
          '    object kiln is Crate\n    object lamp is Lantern\n',
        ).concat('kind Lantern { contains object wick is Jar }\n'),
      }),
      CAPS,
    );
    expect(lantern.declared.has(id('yard', 'lamp', 'wick'))).toBe(true);
    const saved = destroyed(lantern, 'yard', 'lamp');
    expect(saved.tombstones).toEqual([id('yard', 'lamp'), id('yard', 'lamp', 'wick')]);
    const loaded = loadWorld(saved, lantern);
    expect(loaded.created).toEqual([]);
    expect(loaded.state.instances.has(id('yard', 'lamp', 'wick'))).toBe(false);
  });

  it('writes no tombstone for what was spawned inside it, which is simply removed', () => {
    const draft = new Draft(initialState(published));
    const jar = published.kinds.get('printers_shop.Jar')!;
    const spawned = newInstance(
      draft.mint(),
      { from: 'spawned', kind: 'printers_shop.Jar' },
      jar,
      id('yard'),
      draft.nextSerial(),
      CAPS,
    );
    draft.add(spawned);
    draft.remove(id('yard'));
    const saved = saveWorld(draft.commit().state);
    expect(saved.tombstones).toEqual([id('yard'), id('yard', 'kiln')]);
    expect(saved.instances.map((one) => one.id)).not.toContain(spawned.id);
  });
});

describe('what cannot be decoded now is kept dormant, untouched', () => {
  it('keeps an object whose kind’s file is withheld, and saves it back byte for byte', () => {
    const kiln = record({
      id: 'printers_shop.yard.kiln',
      made: { from: 'declared' },
      container: 'printers_shop.yard',
      properties: { lid: { type: 'boolean', value: true }, zz: { type: 'string', value: 'x' } },
      memory: { 'printers_shop#1': { odd: { type: 'integer', value: 1 } } },
      lastTick: 12,
    });
    const store = storing(fresh(), [kiln], 1);
    const loaded = loadWorld(store, withheld);
    expect(loaded.state.instances.has(id('yard', 'kiln'))).toBe(false);
    expect(loaded.dormant).toContain(id('yard', 'kiln'));
    expect(loaded.dropped).toEqual([]);
    const again = stored(saveWorld(loaded.state), kiln.id);
    expect(JSON.stringify(again)).toBe(JSON.stringify(kiln));
    // And a file restored brings it back as it was.
    const restored = loadWorld(saveWorld(loaded.state), published);
    expect(restored.state.instances.get(id('yard', 'kiln'))!.properties.get('lid')).toBe(true);
  });

  it('keeps an object moved in source, which is a new object at its defaults', () => {
    const moved = catalogueOf(
      compiledWorld('printers_shop', {
        ...SHOP,
        'world.sprout': SHOP['world.sprout']!.replace('      object cup is Jar\n', '').replace(
          '    object kiln is Crate\n',
          '    object kiln is Crate\n    object cup is Jar\n',
        ),
      }),
      CAPS,
    );
    const store = storing(fresh(), [
      record({
        id: 'printers_shop.hall.shelf.cup',
        made: { from: 'declared' },
        container: 'printers_shop.hall.shelf',
        properties: { fill: { type: 'integer', value: 8 } },
      }),
    ]);
    const loaded = loadWorld(store, moved);
    expect(loaded.dormant).toContain(id('hall', 'shelf', 'cup'));
    expect(loaded.created).toEqual([id('yard', 'cup')]);
    expect(loaded.state.instances.get(id('yard', 'cup'))!.properties.get('fill')).toBe(3);
  });

  it('keeps an object of an absent kind, and decodes what it holds without making it live', () => {
    const loaded = loadWorld(fresh(), withheld);
    expect(loaded.state.instances.has(id('hall', 'box'))).toBe(false);
    expect(loaded.dormant).toContain(id('hall', 'box'));
    const tin = loaded.state.instances.get(id('hall', 'box', 'tin'))!;
    expect(tin.container).toBe(id('hall', 'box'));
    expect(isLive(readerOf(loaded.state), tin.id)).toBe(false);
    expect(isLive(readerOf(loaded.state), id('hall', 'shelf', 'jar'))).toBe(true);
  });

  it('keeps a spawn of a kind no longer declared, and decodes one whose kind is', () => {
    const store = storing(
      fresh(),
      [
        record({
          id: 'printers_shop#1',
          made: { from: 'spawned', kind: 'printers_shop.Crate' },
          arrival: 1,
        }),
        record({
          id: 'printers_shop#2',
          made: { from: 'spawned', kind: 'printers_shop.Jar' },
          arrival: 2,
          properties: { fill: { type: 'integer', value: 6 } },
        }),
      ],
      2,
    );
    const loaded = loadWorld(store, withheld);
    expect(loaded.dormant).toContain(minted(1));
    const jar = loaded.state.instances.get(minted(2))!;
    expect(jar.kind).toBe(withheld.kinds.get('printers_shop.Jar'));
    expect(jar.properties.get('fill')).toBe(6);
    expect(loaded.state.children.get(id('hall'))).toEqual([id('hall', 'shelf'), minted(2)]);
  });

  it('decodes a spawned instance’s content against what its kind’s body writes there now', () => {
    const lanterns = catalogueOf(
      compiledWorld('printers_shop', {
        ...SHOP,
        'kiln.sprout': `${SHOP['kiln.sprout']!}kind Lantern { contains object wick is Jar }\n`,
      }),
      CAPS,
    );
    const store = storing(
      fresh(),
      [
        record({
          id: 'printers_shop#1',
          made: { from: 'spawned', kind: 'printers_shop.Lantern' },
          container: 'printers_shop.hall',
          arrival: 1,
        }),
        record({
          id: 'printers_shop#2',
          made: { from: 'given', kind: 'printers_shop.Lantern', path: ['wick'] },
          container: 'printers_shop#1',
          arrival: 2,
          properties: { fill: { type: 'integer', value: 6 } },
        }),
        record({
          id: 'printers_shop#3',
          made: { from: 'given', kind: 'printers_shop.Lantern', path: ['flame'] },
          container: 'printers_shop#1',
          arrival: 3,
        }),
      ],
      3,
    );
    const loaded = loadWorld(store, lanterns);
    const wick = loaded.state.instances.get(minted(2))!;
    expect(wick.kind).toBe(lanterns.contents.get('printers_shop.Lantern')![0]!.kind);
    expect(wick.properties.get('fill')).toBe(6);
    expect(loaded.state.children.get(minted(1))).toEqual([minted(2)]);
    // Nothing is written at `flame` now, so what was stored there is kept as it was.
    expect(loaded.dormant).toEqual([minted(3)]);
    // With the kind's file withheld, the lantern and its wick are both kept.
    expect(loadWorld(store, withheld).dormant).toEqual(
      expect.arrayContaining([minted(1), minted(2), minted(3)]),
    );
  });

  it('keeps a stored spawn of `sprout.World` dormant, since the world is never spawned', () => {
    const spawnedWorld = record({
      id: 'printers_shop#1',
      made: { from: 'spawned', kind: 'sprout.World' },
      arrival: 1,
    });
    const loaded = loadWorld(storing(fresh(), [spawnedWorld], 1), published);
    expect(loaded.state.instances.has(minted(1))).toBe(false);
    expect(loaded.dormant).toContain(minted(1));
    expect(JSON.stringify(stored(saveWorld(loaded.state), spawnedWorld.id))).toBe(
      JSON.stringify(spawnedWorld),
    );
  });

  it('decodes an instance whose container is dormant or was never there, and it is not live', () => {
    const store = storing(
      fresh(),
      [
        record({
          id: 'printers_shop#1',
          made: { from: 'spawned', kind: 'printers_shop.Jar' },
          container: 'printers_shop.yard.kiln',
          arrival: 1,
        }),
        record({
          id: 'printers_shop#2',
          made: { from: 'spawned', kind: 'printers_shop.Jar' },
          container: 'printers_shop.cellar',
          arrival: 2,
        }),
      ],
      2,
    );
    const loaded = loadWorld(store, withheld);
    const reader = readerOf(loaded.state);
    for (const one of [minted(1), minted(2)]) {
      expect(loaded.state.instances.has(one)).toBe(true);
      expect(isLive(reader, one)).toBe(false);
    }
  });
});

describe('visitors and the world', () => {
  const marta = record({
    id: 'printers_shop#1',
    made: { from: 'visitor' },
    arrival: 1,
    properties: { score: { type: 'integer', value: 4 } },
  });
  const visitors = [
    {
      visit: 'v-1',
      nickname: 'Marta',
      instance: 'printers_shop#1',
      lastPlace: 'printers_shop.hall',
    },
  ];
  const store: StoredWorld = { ...storing(fresh(), [marta], 1), visitors };

  it('keeps a visitor’s instance dormant where the bundle has no visitor kind, and their record', () => {
    const loaded = loadWorld(store, { ...published, visitorKind: null });
    expect(loaded.dormant).toContain(minted(1));
    expect(loaded.state.visitors.get(visitKey('v-1'))).toEqual({
      visit: 'v-1',
      nickname: 'Marta',
      instance: minted(1),
      lastPlace: id('hall'),
    });
  });

  it('decodes a visitor’s instance against the visitor kind', () => {
    const loaded = loadWorld(store, published);
    const instance = loaded.state.instances.get(minted(1))!;
    expect(instance.kind).toBe(published.visitorKind);
    expect(instance.properties.get('score')).toBe(4);
    // What `sprout.Actor` declares arrives with it, at its default.
    expect(instance.properties.get('capacity')).toBe(8);
    expect(loaded.dormant).toEqual([]);
  });

  it('keeps a visitor whose place and last place are gone', () => {
    const gone = {
      ...store,
      visitors: [{ ...visitors[0]!, lastPlace: 'printers_shop.yard.kiln' }],
    };
    const away = storing(gone, [{ ...marta, container: 'printers_shop.yard.kiln' }]);
    const loaded = loadWorld(away, withheld);
    expect(loaded.state.visitors.get(visitKey('v-1'))!.lastPlace).toBe(id('yard', 'kiln'));
  });

  it('makes the world an instance of whatever world kind the catalogue has, at the tree’s root', () => {
    const catalogue: Catalogue = {
      ...published,
      worldKind: published.kinds.get('printers_shop.Room')!,
    };
    const loaded = loadWorld(emptyWorld(catalogue.world), catalogue);
    const world = loaded.state.instances.get(catalogue.world)!;
    expect(world.id).toBe('printers_shop');
    expect(world.container).toBeNull();
    expect(world.made).toEqual({ from: 'world' });
    expect(Object.fromEntries(world.properties)).toEqual({ lit: true });
    expect(loaded.created[0]).toBe(catalogue.world);
    expect(loaded.dormant).toEqual([]);
  });

  it('keeps the world at the root whatever its record says', () => {
    const catalogue = published;
    const misplaced = record({ id: 'printers_shop', made: { from: 'world' }, arrival: 1 });
    const world = loadWorld(storing(fresh(), [misplaced], 1), catalogue).state.instances.get(
      catalogue.world,
    )!;
    expect(world.container).toBeNull();
    expect(world.arrival).toBeNull();
  });

  it('keeps a stored world record as it was while there is no world kind', () => {
    const world = record({
      id: 'printers_shop',
      made: { from: 'world' },
      container: null,
      lastTick: 5,
    });
    const closed: Catalogue = { ...published, worldKind: null };
    const loaded = loadWorld(storing(fresh(), [world]), closed);
    expect(stored(saveWorld(loaded.state), 'printers_shop')).toEqual(world);
  });
});

describe('what a store holds, and in what order, never changes what loads', () => {
  const rich = (): StoredWorld =>
    ({
      ...storing(
        fresh(),
        [
          record({
            id: 'printers_shop.hall.shelf.jar',
            made: { from: 'declared' },
            container: 'printers_shop.hall.shelf',
            properties: {
              fill: { type: 'integer', value: 12 },
              glaze: { type: 'printers_shop.Glaze', value: 'tenmoku' },
            },
            memory: { 'printers_shop#1': { seen: { type: 'boolean', value: true } } },
          }),
          record({ id: 'printers_shop#1', made: { from: 'visitor' }, arrival: 1 }),
          record({ id: 'printers_shop#3', made: { from: 'visitor' }, arrival: 2 }),
          record({
            id: 'printers_shop#2',
            made: { from: 'spawned', kind: 'printers_shop.Jar' },
            container: 'printers_shop.hall.shelf',
            arrival: 3,
          }),
          record({
            id: 'printers_shop#4',
            made: { from: 'spawned', kind: 'printers_shop.Crate' },
            arrival: 4,
          }),
        ],
        4,
      ),
      visitors: [
        { visit: 'v-2', nickname: 'Ann', instance: 'printers_shop#3', lastPlace: null },
        { visit: 'v-1', nickname: 'Marta', instance: 'printers_shop#1', lastPlace: null },
      ],
    }) satisfies StoredWorld;

  it('saves by id, so save(load(save(s))) is save(s)', () => {
    const once = saveWorld(loadWorld(rich(), withheld).state);
    expect(once.instances.map((one) => one.id)).toEqual(
      [...once.instances.map((one) => one.id)].sort(),
    );
    expect(once.visitors.map((one) => one.visit)).toEqual(['v-1', 'v-2']);
    expect(saveWorld(loadWorld(once, withheld).state)).toEqual(once);
    expect(JSON.stringify(saveWorld(loadWorld(once, withheld).state))).toBe(JSON.stringify(once));
  });

  it('gives the same state and says the same whatever order the instances were stored in', () => {
    const shuffle = <T>(items: readonly T[], seed: number): T[] => {
      const out = [...items];
      let n = seed;
      for (let i = out.length - 1; i > 0; i--) {
        n = (n * 1103515245 + 12345) % 2147483648;
        const j = n % (i + 1);
        [out[i], out[j]] = [out[j]!, out[i]!];
      }
      return out;
    };
    const summary = (loaded: Loaded) => ({
      saved: JSON.stringify(saveWorld(loaded.state)),
      created: loaded.created,
      dormant: loaded.dormant,
      dropped: loaded.dropped,
      children: [...loaded.state.children].sort(([a], [b]) => (a < b ? -1 : 1)),
    });
    const base = summary(loadWorld(rich(), withheld));
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const store = rich();
      const shuffled = {
        ...store,
        instances: shuffle(store.instances, seed),
        visitors: shuffle(store.visitors, seed),
      };
      expect(summary(loadWorld(shuffled, withheld))).toEqual(base);
    }
  });
});

describe('a store that cannot be read is the host’s defect', () => {
  it('throws for a store the schema refuses', () => {
    expect(() => loadWorld({ world: 'printers_shop' }, published)).toThrow(StoredStateUnreadable);
  });

  it('throws for another world’s store', () => {
    expect(() => loadWorld(emptyWorld(declaredId('bakery', [])), published)).toThrow(
      'the store holds `bakery`, and this is `printers_shop`.',
    );
  });
});
