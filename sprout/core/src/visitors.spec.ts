import { describe, expect, it } from 'vitest';

import { readStoredWorld } from '@overstory/sprout/lang';

import type { StoredInstance, StoredProperty, StoredState } from './records.js';
import { applyForgetting, forgetting, visitorIn } from './visitors.js';

// What one world keeps about a visitor, and what forgetting them takes:
// their record, their instance and everything inside it, and every
// instance's memory of them, and nothing of anyone else's.

const seen: StoredProperty = { type: 'boolean', value: true };
const record = (id: string, over: Partial<StoredInstance>): StoredInstance => ({
  id,
  made: { from: 'declared' },
  container: 'shop.hall',
  arrival: null,
  properties: {},
  links: {},
  wakes: [],
  memory: {},
  lastTick: null,
  ...over,
});

function world(): StoredState {
  return {
    serial: 6,
    instances: [
      record('shop', { made: { from: 'world' }, container: null }),
      record('shop#1', { made: { from: 'visitor' }, arrival: 1, memory: { 'shop#4': { seen } } }),
      record('shop#2', { made: { from: 'spawned', kind: 'shop.Bag' }, container: 'shop#1' }),
      record('shop#3', { made: { from: 'spawned', kind: 'shop.Coin' }, container: 'shop#2' }),
      record('shop#4', { made: { from: 'visitor' }, container: null, arrival: 4 }),
      record('shop.hall', { container: 'shop', memory: { 'shop#1': { seen } } }),
      record('shop.hall.key', {
        container: 'shop#2',
        arrival: 5,
        memory: { 'shop#1': { seen }, 'shop#4': { seen } },
      }),
      record('shop.hall.lamp', { memory: { 'shop#1': { seen }, 'shop#4': { seen } } }),
    ],
    visitors: [
      { visit: 'v-ines', nickname: 'Ines', instance: 'shop#4', lastPlace: 'shop.hall' },
      { visit: 'v-marta', nickname: 'Marta', instance: 'shop#1', lastPlace: 'shop.hall' },
    ],
    tombstones: ['shop.hall.vase'],
  };
}

describe('forgetting a visitor', () => {
  it('takes their instance and everything inside it all the way down, declared or spawned', () => {
    const change = forgetting(world(), 'v-marta')!;
    expect(change.visitor.instance).toBe('shop#1');
    expect(change.remove).toEqual(['shop#1', 'shop#2', 'shop#3', 'shop.hall.key']);
  });

  it('takes every other instance’s memory of them, and keeps everyone else’s', () => {
    const change = forgetting(world(), 'v-marta')!;
    expect(change.rewrite.map((i) => [i.id, Object.keys(i.memory)])).toEqual([
      ['shop.hall', []],
      ['shop.hall.lamp', ['shop#4']],
    ]);
  });

  it('leaves the serial and the tombstones, and a world the language still reads', () => {
    const before = world();
    const after = applyForgetting(before, forgetting(before, 'v-marta')!);
    expect(after.serial).toBe(6);
    expect(after.tombstones).toEqual(['shop.hall.vase']);
    expect(after.visitors.map((v) => v.visit)).toEqual(['v-ines']);
    expect(after.instances.map((i) => i.id)).toEqual([
      'shop',
      'shop#4',
      'shop.hall',
      'shop.hall.lamp',
    ]);
    expect(() => readStoredWorld({ world: 'shop', ...after })).not.toThrow();
    // A declared object they held leaves no tombstone: a load makes it again where it was declared.
    expect(after.tombstones).not.toContain('shop.hall.key');
    expect(before.instances).toHaveLength(8);
  });

  it('is nothing for a visit the world does not hold', () => {
    expect(forgetting(world(), 'v-nobody')).toBeNull();
  });
});

describe('what a world keeps about a visitor', () => {
  it('is their record, their instance, and each memory of them by the instance remembering', () => {
    const kept = visitorIn('w', world(), 'v-marta')!;
    expect(kept.microworldId).toBe('w');
    expect(kept.visitor.nickname).toBe('Marta');
    expect(kept.instance?.id).toBe('shop#1');
    expect(kept.memory).toEqual({
      'shop.hall': { seen },
      'shop.hall.key': { seen },
      'shop.hall.lamp': { seen },
    });
  });

  it('is null for a visit the world does not hold, and names no instance the store lacks', () => {
    expect(visitorIn('w', world(), 'v-nobody')).toBeNull();
    const lost = { ...world(), instances: world().instances.filter((i) => i.id !== 'shop#1') };
    expect(visitorIn('w', lost, 'v-marta')?.instance).toBeNull();
  });
});
