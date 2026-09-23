import { describe, expect, it } from 'vitest';

import { emptyState, type StoredInstance, type StoredState } from './records.js';
import { applyChanges } from './state.js';

// One turn's change set applied to a whole stored state, as the memory
// store and the document store keep one.

const record = (id: string, over: Partial<StoredInstance> = {}): StoredInstance => ({
  id,
  made: { from: 'declared' },
  container: 'shop',
  arrival: null,
  properties: {},
  links: {},
  wakes: [],
  memory: {},
  lastTick: null,
  ...over,
});

const change = (over: Partial<Parameters<typeof applyChanges>[1]> = {}) => ({
  serial: 0,
  upsert: [],
  remove: [],
  tombstones: [],
  visitors: [],
  ...over,
});

describe('applying a turn’s changes', () => {
  it('sets the serial, and keeps every list in code-unit order whatever order the turn gave', () => {
    const state = applyChanges(
      emptyState(),
      change({
        serial: 3,
        upsert: [record('shop.hall'), record('shop#2'), record('shop')],
        tombstones: ['shop.vase', 'shop.bench'],
        visitors: [
          { visit: 'v-z', nickname: 'Zed', instance: 'shop#2', lastPlace: null },
          { visit: 'v-a', nickname: 'Ada', instance: 'shop#3', lastPlace: null },
        ],
      }),
    );
    expect(state.serial).toBe(3);
    expect(state.instances.map((i) => i.id)).toEqual(['shop', 'shop#2', 'shop.hall']);
    expect(state.visitors.map((v) => v.visit)).toEqual(['v-a', 'v-z']);
    expect(state.tombstones).toEqual(['shop.bench', 'shop.vase']);
  });

  it('removes before it upserts, replaces a record whole, and keeps a tombstone once', () => {
    const before: StoredState = {
      serial: 2,
      instances: [record('shop.lamp', { properties: { lit: { type: 'boolean', value: true } } })],
      visitors: [{ visit: 'v', nickname: 'Vi', instance: 'shop#1', lastPlace: null }],
      tombstones: ['shop.vase'],
    };
    const lamp = record('shop.lamp', { container: 'shop#1', arrival: 3 });
    const after = applyChanges(
      before,
      change({
        serial: 3,
        upsert: [lamp],
        remove: ['shop.lamp', 'shop.gone'],
        tombstones: ['shop.vase'],
        visitors: [{ visit: 'v', nickname: 'Vi', instance: 'shop#1', lastPlace: 'shop.hall' }],
      }),
    );
    expect(after.instances).toEqual([lamp]);
    expect(after.tombstones).toEqual(['shop.vase']);
    expect(after.visitors).toEqual([
      { visit: 'v', nickname: 'Vi', instance: 'shop#1', lastPlace: 'shop.hall' },
    ]);
    expect(before.instances[0]!.properties).toHaveProperty('lit');
  });

  it('removes an id the turn names and does not upsert', () => {
    const after = applyChanges(
      { ...emptyState(), instances: [record('shop#1'), record('shop#2')] },
      change({ serial: 2, remove: ['shop#1'] }),
    );
    expect(after.instances.map((i) => i.id)).toEqual(['shop#2']);
  });
});
