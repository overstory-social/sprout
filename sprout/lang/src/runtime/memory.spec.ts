import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { shop, shopWithheld } from '../fixtures/bundle.js';
import { catalogueOf } from './catalogue.js';
import { declaredId, mintedId, type InstanceId } from './ids.js';
import { initialState, loadWorld, saveWorld } from './load.js';
import { rememberedAbout } from './memory.js';
import type { StoredInstance, StoredWorld } from './stored.js';

const CAPS = DEFAULT_LIMITS.caps;
const id = (...path: string[]): InstanceId => declaredId('printers_shop', path);
const minted = (serial: number): InstanceId => mintedId('printers_shop', serial);
const seen = (value: boolean) => ({ seen: { type: 'boolean', value } });

/** The shop with two visitors, and memory of them on the jar, the cup and a spawned crate. */
function store(): StoredWorld {
  const base = saveWorld(initialState(catalogueOf(shop(), CAPS)));
  const visitor = (serial: number): StoredInstance => ({
    id: minted(serial),
    made: { from: 'visitor' },
    container: id('hall'),
    arrival: serial,
    properties: {},
    links: {},
    wakes: [],
    memory: {},
    lastTick: null,
  });
  const remembering = (instanceId: string, memory: StoredInstance['memory']) => ({
    ...base.instances.find((one) => one.id === instanceId)!,
    memory,
  });
  const crate: StoredInstance = {
    ...visitor(3),
    made: { from: 'spawned', kind: 'printers_shop.Crate' },
    memory: { [minted(1)]: { opened: { type: 'integer', value: 2 } } },
  };
  const changed = new Map<string, StoredInstance>([
    [minted(1), visitor(1)],
    [minted(2), visitor(2)],
    [crate.id, crate],
    [
      id('hall', 'shelf', 'jar'),
      remembering(id('hall', 'shelf', 'jar'), {
        [minted(1)]: seen(true),
        [minted(2)]: seen(false),
      }),
    ],
    [
      id('hall', 'shelf', 'cup'),
      remembering(id('hall', 'shelf', 'cup'), { [minted(1)]: seen(true) }),
    ],
  ]);
  const instances = [...base.instances.filter((one) => !changed.has(one.id)), ...changed.values()];
  return {
    ...base,
    serial: 3,
    instances,
    visitors: [
      { visit: 'v-1', nickname: 'Marta', instance: minted(1), lastPlace: id('hall') },
      { visit: 'v-2', nickname: 'Ann', instance: minted(2), lastPlace: id('hall') },
    ],
  };
}

describe('the memory panel shows everything every object remembers about one actor', () => {
  it('lists what each object wrote about them, by object and then property', () => {
    const { state } = loadWorld(store(), catalogueOf(shop(), CAPS));
    // The crate's `:opened` is not something `Crate` declares, so the
    // load dropped it; only what is remembered now is shown.
    expect(rememberedAbout(state, minted(1))).toEqual([
      { object: id('hall', 'shelf', 'cup'), property: 'seen', value: true },
      { object: id('hall', 'shelf', 'jar'), property: 'seen', value: true },
    ]);
  });

  it('lists nothing another actor is remembered for, and nothing never written', () => {
    const { state } = loadWorld(store(), catalogueOf(shop(), CAPS));
    // The cup never wrote about Ann, so its default is not a memory of her.
    expect(rememberedAbout(state, minted(2))).toEqual([
      { object: id('hall', 'shelf', 'jar'), property: 'seen', value: false },
    ]);
    expect(rememberedAbout(state, minted(9))).toEqual([]);
  });

  it('shows what a dormant object remembers, as it was stored', () => {
    // With `kiln.sprout` withheld, `Crate` is absent and the spawned crate
    // is kept dormant; what it remembers is still about Marta.
    const loaded = loadWorld(store(), catalogueOf(shopWithheld(), CAPS));
    expect(loaded.dormant).toContain(minted(3));
    expect(rememberedAbout(loaded.state, minted(1))).toEqual([
      { object: minted(3), property: 'opened', value: 2 },
      { object: id('hall', 'shelf', 'cup'), property: 'seen', value: true },
      { object: id('hall', 'shelf', 'jar'), property: 'seen', value: true },
    ]);
  });

  it('gives the same list whatever order the state holds its instances in', () => {
    const { state } = loadWorld(store(), catalogueOf(shopWithheld(), CAPS));
    const reversed = {
      ...state,
      instances: new Map([...state.instances].reverse()),
      dormant: new Map([...state.dormant].reverse()),
    };
    expect(rememberedAbout(reversed, minted(1))).toEqual(rememberedAbout(state, minted(1)));
  });
});
