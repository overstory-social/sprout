import { describe, expect, it } from 'vitest';

import { ActionRecord, ActorRecord, Limits, MicroworldRecord, ObjectRecord } from './records.js';

// The record shapes an adapter carries (§4.6): defaults, what is required.

describe('the records', () => {
  it('Limits has the §4.4 defaults', () => {
    expect(Limits.parse({})).toEqual({
      rooms: 16,
      objects: 192,
      kinds: 32,
      files: 256,
      sourceBytes: 262144,
      instances: 2000,
      actionDays: 30,
      misses: 500,
    });
    expect(Limits.parse({ rooms: 32 }).rooms).toBe(32);
    expect(Limits.safeParse({ rooms: 0 }).success).toBe(false);
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
