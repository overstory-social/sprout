import { describe, expect, it } from 'vitest';

import {
  LANGUAGE_LEVEL,
  RoomExit,
  SproutField,
  SproutState,
  SproutValue,
  SPROUT_DEFINITION_BYTES_MAX,
  SPROUT_EXITS_PER_ROOM,
  SPROUT_NODE_DEPTH_MAX,
  SPROUT_VALUE_MAX,
  isBuiltinField,
} from './definitions.js';

// What definitions.ts still owns since source became the truth (#523):
// the value shapes a host persists, the field shapes, the shared
// `RoomExit`, the caps and the language level.

describe('values and state', () => {
  it('a value is a boolean, an integer, a short string or null; state maps identifiers to them', () => {
    expect(SproutValue.safeParse(true).success).toBe(true);
    expect(SproutValue.safeParse(3).success).toBe(true);
    expect(SproutValue.safeParse(1.5).success).toBe(false);
    expect(SproutValue.safeParse('x'.repeat(SPROUT_VALUE_MAX)).success).toBe(true);
    expect(SproutValue.safeParse('x'.repeat(SPROUT_VALUE_MAX + 1)).success).toBe(false);
    expect(SproutValue.safeParse(null).success).toBe(true);
    expect(SproutState.safeParse({ lit: true, fuel: 2 }).success).toBe(true);
    expect(SproutState.safeParse({ Lit: true }).success).toBe(false);
  });
});

describe('fields', () => {
  it('parses each built-in shape and refuses a default outside its bounds or set', () => {
    for (const f of [
      { type: 'boolean', name: 'lit', default: false },
      { type: 'string', name: 'label', default: 'Sold out' },
      { type: 'integer', name: 'fuel', default: 2, min: 0, max: 10 },
      { type: 'enum', name: 'state', options: ['wet', 'fired'], default: 'wet' },
    ]) {
      expect(SproutField.safeParse(f).success, f.type).toBe(true);
      expect(isBuiltinField(SproutField.parse(f))).toBe(true);
    }
    expect(
      SproutField.safeParse({ type: 'integer', name: 'fuel', default: 11, min: 0, max: 10 })
        .success,
    ).toBe(false);
    expect(
      SproutField.safeParse({ type: 'enum', name: 's', options: ['a', 'a'], default: 'a' }).success,
    ).toBe(false);
  });

  it("an extension's field is any other type tag with a value default, and is not built in", () => {
    const image = SproutField.parse({ type: 'media', name: 'image', default: null });
    expect(isBuiltinField(image)).toBe(false);
    expect(SproutField.safeParse({ type: 'media', name: 'image', default: 'm-1' }).success).toBe(
      true,
    );
    // A built-in tag must come with its own shape: `boolean` with a null default is not a field.
    expect(SproutField.safeParse({ type: 'boolean', name: 'x', default: null }).success).toBe(
      false,
    );
    expect(SproutField.safeParse({ type: 'Media', name: 'x', default: null }).success).toBe(false);
  });
});

describe('what a host shares', () => {
  it('an exit is a label and a room id; the caps and the language level are positive integers', () => {
    expect(RoomExit.safeParse({ label: 'up', toRoomId: 'r1' }).success).toBe(true);
    expect(RoomExit.safeParse({ label: '', toRoomId: 'r1' }).success).toBe(false);
    for (const n of [
      LANGUAGE_LEVEL,
      SPROUT_EXITS_PER_ROOM,
      SPROUT_NODE_DEPTH_MAX,
      SPROUT_DEFINITION_BYTES_MAX,
    ]) {
      expect(Number.isInteger(n) && n > 0).toBe(true);
    }
    expect(LANGUAGE_LEVEL).toBe(1);
  });
});
