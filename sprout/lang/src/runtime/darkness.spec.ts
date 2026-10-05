import { describe, expect, it } from 'vitest';

import {
  BEACON,
  CELLAR,
  CHEST,
  dark,
  darkContext,
  INES,
  KITCHEN,
  LAMP,
  LANTERN,
  MARTA,
  personOf,
  VAULT,
} from '../fixtures/darkness.js';
import { inTheDark, isLit } from './darkness.js';
import type { InstanceId } from './ids.js';
import type { Value } from './values.js';

const set = (id: InstanceId, name: string, value: Value) => [id, name, value] as const;

describe('whether a place is lit', () => {
  it('is lit where it writes no `lit`', () => {
    expect(isLit(KITCHEN, darkContext(dark()))).toBe(true);
  });

  it('is its `lit`: the cellar is dark until it sees a lit lamp, carried or set down', () => {
    expect(isLit(CELLAR, darkContext(dark()))).toBe(false);
    // Carried, unlit, it lights nothing.
    expect(isLit(CELLAR, darkContext(dark([[MARTA, CELLAR]], [], [[MARTA, LAMP]])))).toBe(false);
    const carried = dark([[MARTA, CELLAR]], [set(LAMP, 'lit', true)], [[MARTA, LAMP]]);
    expect(isLit(CELLAR, darkContext(carried))).toBe(true);
    // Someone else's lamp lights it for everyone there.
    const others = dark(
      [
        [MARTA, CELLAR],
        [INES, CELLAR],
      ],
      [set(LAMP, 'lit', true)],
      [[INES, LAMP]],
    );
    expect(inTheDark(personOf(others, MARTA), darkContext(others))).toBe(false);
  });

  it('is not lit by a lamp in a shut chest, and is once the chest is open', () => {
    expect(isLit(CELLAR, darkContext(dark(undefined, [set(LANTERN, 'lit', true)])))).toBe(false);
    const open = dark(undefined, [set(LANTERN, 'lit', true), set(CHEST, 'open', true)]);
    expect(isLit(CELLAR, darkContext(open))).toBe(true);
  });

  it('is dark, never a fault, where its `lit` reads through a name out of its range', () => {
    expect(isLit(VAULT, darkContext(dark(undefined, [set(BEACON, 'lit', true)])))).toBe(false);
  });

  it('puts a person in the dark only where their place is not lit', () => {
    const state = dark([
      [MARTA, CELLAR],
      [INES, KITCHEN],
    ]);
    expect(inTheDark(personOf(state, MARTA), darkContext(state))).toBe(true);
    expect(inTheDark(personOf(state, INES), darkContext(state))).toBe(false);
  });
});
