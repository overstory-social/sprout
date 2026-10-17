import { describe, expect, it } from 'vitest';

import { readStoredWorld } from '@overstory/sprout/lang';

import type { StoredInstance, StoredState } from './records.js';
import { applyForgetting, forgetting, visitorIn } from './visitors.js';

// What one world keeps about a visitor, and what forgetting them takes:
// their record, their instance and everything inside it, and every
// instance's memory of them, and nothing of anyone else's. A declared
// object whose record says nothing of its container stands where it was
// declared, so the walk down from the visitor reads that too.

const record = (id: string, over: Partial<StoredInstance> = {}): StoredInstance => ({
  id,
  ...over,
});

function world(): StoredState {
  return {
    serial: 6,
    instances: [
      record('shop'),
      record('shop#1', {
        made: { from: 'visitor' },
        arrival: 1,
        memory: { 'shop#4': { seen: true } },
      }),
      record('shop#2', {
        made: { from: 'spawned', kind: 'shop.Bag' },
        container: 'shop#1',
        arrival: 2,
      }),
      record('shop#3', {
        made: { from: 'spawned', kind: 'shop.Coin' },
        container: 'shop#2',
        arrival: 3,
      }),
      record('shop#4', { made: { from: 'visitor' }, arrival: 4 }),
      record('shop.hall', { memory: { 'shop#1': { seen: true } } }),
      record('shop.hall.key', {
        container: 'shop#2',
        arrival: 5,
        memory: { 'shop#1': { seen: true }, 'shop#4': { seen: true } },
      }),
      record('shop.hall.lamp', { memory: { 'shop#1': { seen: true }, 'shop#4': { seen: true } } }),
      record('shop.hall.lamp.wick', { properties: { lit: true } }),
    ],
    visitors: [
      {
        visit: 'v-ines',
        nickname: 'Ines',
        instance: 'shop#4',
        lastPlace: 'shop.hall',
        referents: [],
        lastReading: null,
      },
      {
        visit: 'v-marta',
        nickname: 'Marta',
        instance: 'shop#1',
        lastPlace: 'shop.hall',
        referents: [],
        lastReading: null,
      },
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

  it('reads a declared object that says nothing of its container as where it was declared', () => {
    // The wick is declared inside the lamp, which nobody holds: it stays.
    const change = forgetting(world(), 'v-marta')!;
    expect(change.remove).not.toContain('shop.hall.lamp.wick');
    const held = {
      ...world(),
      instances: [
        ...world().instances,
        record('shop.hall.key.tag', { properties: { worn: true } }),
      ],
    };
    // The tag is declared inside the key, which Marta's bag holds: it goes with the key.
    expect(forgetting(held, 'v-marta')!.remove).toContain('shop.hall.key.tag');
  });

  it('takes every other instance’s memory of them, and keeps everyone else’s', () => {
    const change = forgetting(world(), 'v-marta')!;
    expect(change.rewrite.map((i) => [i.id, Object.keys(i.memory ?? {})])).toEqual([
      ['shop.hall', []],
      ['shop.hall.lamp', ['shop#4']],
    ]);
    // A record left remembering nobody has no memory at all, as the stored form writes it.
    expect(change.rewrite[0]).toEqual({ id: 'shop.hall' });
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
      'shop.hall.lamp.wick',
    ]);
    expect(() => readStoredWorld({ world: 'shop', ...after })).not.toThrow();
    // A declared object they held leaves no tombstone: a load makes it again where it was declared.
    expect(after.tombstones).not.toContain('shop.hall.key');
    expect(before.instances).toHaveLength(9);
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
      'shop.hall': { seen: true },
      'shop.hall.key': { seen: true },
      'shop.hall.lamp': { seen: true },
    });
  });

  it('is null for a visit the world does not hold, and names no instance the store lacks', () => {
    expect(visitorIn('w', world(), 'v-nobody')).toBeNull();
    const lost = { ...world(), instances: world().instances.filter((i) => i.id !== 'shop#1') };
    expect(visitorIn('w', lost, 'v-marta')?.instance).toBeNull();
  });
});
