import { describe, expect, it } from 'vitest';

import {
  DEFAULT_BLESSED,
  DEFAULT_LIMITS,
  limitsFrom,
  type StaticCaps,
} from '@overstory/sprout/lang';

import {
  ActionRecord,
  ActorRecord,
  MicroworldRecord,
  ObjectRecord,
  RecordedCaps,
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

  it('a microworld keeps its recorded caps, whether the host excepted it, and what it blessed', () => {
    expect(Object.keys(MicroworldRecord.shape)).toEqual(
      expect.arrayContaining(['caps', 'excepted', 'blessed']),
    );
    expect(Object.keys(MicroworldRecord.shape)).not.toContain('limits');
  });

  it('keeps what the host blessed as library hashes, and nothing that is not one', () => {
    const blessed = MicroworldRecord.shape.blessed;
    expect(blessed.parse([...DEFAULT_BLESSED])).toEqual([...DEFAULT_BLESSED]);
    expect(blessed.parse([])).toEqual([]);
    for (const hash of ['sprout', 'A'.repeat(64), 'a'.repeat(63)]) {
      expect(blessed.safeParse([hash]).success).toBe(false);
    }
  });

  it('every record is keyed by its microworld; an action carries no actor', () => {
    for (const schema of [ObjectRecord, ActorRecord, ActionRecord, MicroworldRecord]) {
      const keys = Object.keys(schema.shape);
      expect(keys.includes('microworldId') || keys.includes('id')).toBe(true);
    }
    expect(Object.keys(ActionRecord.shape)).not.toContain('actorId');
    expect(
      ObjectRecord.safeParse({
        microworldId: 'w',
        id: 'x',
        spawnedFrom: null,
        container: 'hall',
        home: 'hall',
        state: { lit: 'a' },
      }).success,
    ).toBe(true);
    expect(
      ObjectRecord.safeParse({
        microworldId: 'w',
        id: '',
        spawnedFrom: null,
        container: null,
        home: null,
        state: {},
      }).success,
    ).toBe(false);
  });
});
