import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { shop } from '../fixtures/bundle.js';
import { catalogueOf } from './catalogue.js';
import { declaredId, mintedId, visitKey, type InstanceId } from './ids.js';
import {
  childrenOf,
  codeUnitOrder,
  contentsOrder,
  newInstance,
  readerOf,
  type Instance,
  type WorldState,
} from './state.js';

const CAPS = DEFAULT_LIMITS.caps;
const catalogue = catalogueOf(shop(), CAPS);
const JAR = catalogue.kinds.get('printers_shop.Jar')!;
const id = (...path: string[]): InstanceId => declaredId('printers_shop', path);
const minted = (serial: number): InstanceId => mintedId('printers_shop', serial);

describe('a new instance starts at its kind’s defaults', () => {
  const jar = newInstance(
    minted(1),
    { from: 'spawned', kind: 'printers_shop.Jar' },
    JAR,
    id('hall'),
    1,
    CAPS,
  );

  it('holds every property its kind declares plainly, each at its declared default', () => {
    expect(Object.fromEntries(jar.properties)).toEqual({ glaze: 'none', fill: 3 });
  });

  it('holds no remembered property among its properties, and remembers nothing yet', () => {
    expect(JAR.properties.get('seen')!.remembered).toBe(true);
    expect(jar.properties.has('seen')).toBe(false);
    expect(jar.memory.size).toBe(0);
  });

  it('has no links, no wakes and has never ticked', () => {
    expect(jar.links.size).toBe(0);
    expect(jar.wakes).toEqual([]);
    expect(jar.lastTick).toBeNull();
  });

  it('is where it was put, made as it was made', () => {
    expect(jar.container).toBe(id('hall'));
    expect(jar.arrival).toBe(1);
    expect(jar.made).toEqual({ from: 'spawned', kind: 'printers_shop.Jar' });
    expect(jar.kind).toBe(JAR);
  });
});

/** A jar at `container`, declared where it is (arrival null) or arrived under `arrival`. */
const at = (instanceId: InstanceId, container: InstanceId, arrival: number | null): Instance =>
  newInstance(instanceId, { from: 'declared' }, JAR, container, arrival, CAPS);

describe('a container’s contents are in one order', () => {
  const shelf = id('hall', 'shelf');
  const rank = (instanceId: InstanceId) =>
    catalogue.declared.get(instanceId)?.rank ?? Number.MAX_SAFE_INTEGER;

  it('puts declared objects still where they were declared first, in declared order', () => {
    const jar = at(id('hall', 'shelf', 'jar'), shelf, null);
    const cup = at(id('hall', 'shelf', 'cup'), shelf, null);
    expect(childrenOf([cup, jar], rank).get(shelf)).toEqual([jar.id, cup.id]);
  });

  it('puts what arrived after them, by arrival', () => {
    const cup = at(id('hall', 'shelf', 'cup'), shelf, null);
    const late = at(minted(9), shelf, 9);
    const early = at(minted(2), shelf, 2);
    expect(childrenOf([late, cup, early], rank).get(shelf)).toEqual([cup.id, early.id, late.id]);
  });

  it('puts a declared object taken and put back last, since it arrived', () => {
    const jar = at(id('hall', 'shelf', 'jar'), shelf, 7);
    const cup = at(id('hall', 'shelf', 'cup'), shelf, null);
    const spawned = at(minted(3), shelf, 3);
    expect(childrenOf([jar, cup, spawned], rank).get(shelf)).toEqual([cup.id, spawned.id, jar.id]);
  });

  it('gives the same order whatever order the instances come in', () => {
    const all = [
      at(id('hall', 'shelf', 'jar'), shelf, null),
      at(id('hall', 'shelf', 'cup'), shelf, 4),
      at(minted(2), shelf, 2),
      at(minted(5), shelf, 5),
    ];
    const once = childrenOf(all, rank).get(shelf);
    expect(childrenOf([...all].reverse(), rank).get(shelf)).toEqual(once);
    expect(childrenOf([all[2]!, all[0]!, all[3]!, all[1]!], rank).get(shelf)).toEqual(once);
  });

  it('is total, falling to the id where nothing else decides', () => {
    const order = contentsOrder(() => 0);
    const a = at(minted(1), shelf, null);
    const b = at(minted(2), shelf, null);
    expect(order(a, b)).toBeLessThan(0);
    expect(order(b, a)).toBeGreaterThan(0);
    expect(order(a, a)).toBe(0);
  });

  it('holds nothing for what has no container', () => {
    const away = newInstance(minted(4), { from: 'visitor' }, JAR, null, 4, CAPS);
    expect([...childrenOf([away], rank).keys()]).toEqual([]);
  });
});

describe('sorting is by code unit, the same on every host', () => {
  it('orders upper case before lower and `#` before `.`', () => {
    expect(['b', 'B', 'a.b', 'a#b'].sort(codeUnitOrder)).toEqual(['B', 'a#b', 'a.b', 'b']);
  });
});

describe('a reader of committed state', () => {
  const jar = at(id('hall', 'shelf', 'jar'), id('hall', 'shelf'), null);
  const visit = visitKey('v-1');
  const state: WorldState = {
    world: catalogue.world,
    serial: 0,
    instances: new Map([[jar.id, jar]]),
    dormant: new Map(),
    visitors: new Map([
      [visit, { visit, nickname: 'Marta', instance: minted(1), lastPlace: null }],
    ]),
    tombstones: new Set([id('hall', 'lamp')]),
    children: new Map([[id('hall', 'shelf'), [jar.id]]]),
  };
  const reader = readerOf(state);

  it('reads instances, contents and visitors as committed', () => {
    expect(reader.world).toBe('printers_shop');
    expect(reader.instance(jar.id)).toBe(jar);
    expect(reader.children(id('hall', 'shelf'))).toEqual([jar.id]);
    expect(reader.visitor(visit)!.nickname).toBe('Marta');
  });

  it('knows a declared object destroyed for good by its tombstone', () => {
    expect(reader.tombstoned(id('hall', 'lamp'))).toBe(true);
    expect(reader.tombstoned(jar.id)).toBe(false);
  });

  it('answers nothing for what is not there, and no contents for what holds nothing', () => {
    expect(reader.instance(minted(3))).toBeUndefined();
    expect(reader.children(jar.id)).toEqual([]);
    expect(reader.visitor(visitKey('v-2'))).toBeUndefined();
  });
});
