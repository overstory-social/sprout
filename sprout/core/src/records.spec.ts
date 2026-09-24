import { describe, expect, it } from 'vitest';

import {
  DEFAULT_BLESSED,
  DEFAULT_LIMITS,
  emptyWorld,
  limitsFrom,
  type InstanceId,
  type StaticCaps,
} from '@overstory/sprout/lang';

import {
  ActionRecord,
  MicroworldRecord,
  MissRecord,
  RecordedCaps,
  StoredInstanceSchema,
  StoredState,
  VisitorExport,
  VisitorInWorld,
  emptyState,
} from './records.js';

// The record shapes an adapter carries: defaults, what is required.

describe('the records', () => {
  it('keeps every static cap the language has, and invents none', () => {
    expect(Object.keys(RecordedCaps.shape)).toEqual(Object.keys(DEFAULT_LIMITS.caps));
    expect(RecordedCaps.safeParse({}).success).toBe(false);
  });

  it('keeps the caps a bundle was checked against as they were, unset ones as null', () => {
    const caps: StaticCaps = limitsFrom({ caps: { exitsPerPlace: 12, places: 40 } }).caps;
    const kept: StaticCaps = RecordedCaps.parse(caps);
    expect(kept).toEqual(caps);
    expect(RecordedCaps.parse(DEFAULT_LIMITS.caps).sourceBytes).toBeNull();
    expect(RecordedCaps.safeParse({ ...caps, places: 0 }).success).toBe(false);
    expect(RecordedCaps.safeParse({ ...caps, places: 1.5 }).success).toBe(false);
    expect(RecordedCaps.safeParse({ ...caps, exitsPerPlace: null }).success).toBe(false);
  });

  it('a microworld keeps its recorded caps and whether the host excepted it, and not what it blessed', () => {
    expect(Object.keys(MicroworldRecord.shape)).toEqual(
      expect.arrayContaining(['caps', 'excepted']),
    );
    expect(Object.keys(MicroworldRecord.shape)).not.toContain('limits');
    expect(Object.keys(MicroworldRecord.shape)).not.toContain('blessed');
  });

  it('reads a stored microworld that lists what was blessed at publish, without the list', () => {
    const record = {
      id: 'shop',
      archive: { files: [], manifest: null },
      stamp: 'stamp-1',
      level: 1,
      extensions: [],
      caps: DEFAULT_LIMITS.caps,
      excepted: false,
      loadedAt: new Date('2026-09-18T12:00:00Z'),
    };
    const read = MicroworldRecord.parse({ ...record, blessed: [...DEFAULT_BLESSED] });
    expect(read).toEqual(record);
    expect('blessed' in read).toBe(false);
  });

  it('every record is keyed by its microworld; an action carries no actor', () => {
    for (const schema of [ActionRecord, MissRecord, VisitorInWorld]) {
      expect(Object.keys(schema.shape)).toContain('microworldId');
    }
    expect(Object.keys(MicroworldRecord.shape)).toContain('id');
    expect(Object.keys(ActionRecord.shape)).not.toContain('actorId');
  });

  it('keeps a world’s state in the language’s stored form, and refuses what the language would', () => {
    const lamp = {
      id: 'shop.lamp',
      made: { from: 'declared' },
      container: 'shop',
      arrival: null,
      properties: { lit: { type: 'boolean', value: true } },
      links: {},
      wakes: [],
      memory: { 'shop#1': { seen: { type: 'boolean', value: true } } },
      lastTick: null,
    };
    const state = { serial: 1, instances: [lamp], visitors: [], tombstones: [] };
    expect(StoredState.parse(state)).toEqual(state);
    expect(Object.keys(StoredState.shape)).toEqual(
      Object.keys(emptyWorld('shop' as InstanceId)).filter((k) => k !== 'world'),
    );
    expect(StoredState.safeParse({ ...state, serial: -1 }).success).toBe(false);
    expect(
      StoredState.safeParse({ ...state, instances: [{ ...lamp, made: { from: 'spawned' } }] })
        .success,
    ).toBe(false);
    expect(
      StoredState.safeParse({ ...state, instances: [{ ...lamp, properties: { lit: true } }] })
        .success,
    ).toBe(false);
  });

  it('holds nothing where no turn has written, as a fresh value each time', () => {
    const first = emptyState();
    expect(first).toEqual({ serial: 0, instances: [], visitors: [], tombstones: [] });
    first.instances.push(StoredInstanceSchema.parse({ ...emptyWorldInstance() }));
    expect(emptyState().instances).toEqual([]);
  });

  it('a miss keeps the room and what was in it as stored instances', () => {
    const room = emptyWorldInstance();
    const miss = {
      microworldId: 'w',
      at: new Date('2026-09-18T12:00:00Z'),
      roomId: 'shop',
      input: 'juggle',
      couldSay: [],
      couldName: [],
      state: { room, items: [] },
    };
    expect(MissRecord.parse(miss)).toEqual(miss);
    expect(MissRecord.safeParse({ ...miss, state: { room: {}, items: {} } }).success).toBe(false);
  });

  it('exports a visitor by visit, a world at a time, with memory by the instance remembering', () => {
    const exported = {
      visit: 'v-marta',
      worlds: [
        {
          microworldId: 'w',
          visitor: { visit: 'v-marta', nickname: 'Marta', instance: 'shop#1', lastPlace: null },
          instance: null,
          memory: { 'shop.lamp': { seen: { type: 'boolean', value: true } } },
        },
      ],
    };
    expect(VisitorExport.parse(exported)).toEqual(exported);
    expect(VisitorExport.safeParse({ ...exported, visit: '' }).success).toBe(false);
  });
});

/** The world's own instance, as a store holds it. */
function emptyWorldInstance() {
  return {
    id: 'shop',
    made: { from: 'world' as const },
    container: null,
    arrival: null,
    properties: {},
    links: {},
    wakes: [],
    memory: {},
    lastTick: null,
  };
}
