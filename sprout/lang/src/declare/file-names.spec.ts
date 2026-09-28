import { describe, expect, it } from 'vitest';

import { fileNamedFor } from './file-names.js';

describe('the file named for a kind or a world', () => {
  it('is its name in lower case', () => {
    expect(fileNamedFor('Chest')).toBe('chest.sprout');
    expect(fileNamedFor('K')).toBe('k.sprout');
  });

  it('puts a `_` between the words of a name', () => {
    expect(fileNamedFor('PrintedSheet')).toBe('printed_sheet.sprout');
    expect(fileNamedFor('SafetyLamp')).toBe('safety_lamp.sprout');
    expect(fileNamedFor('StormLanternCase')).toBe('storm_lantern_case.sprout');
  });

  it('reads a run of capitals as one word, and its last capital as the next word’s start', () => {
    expect(fileNamedFor('TVSet')).toBe('tv_set.sprout');
    expect(fileNamedFor('HTML')).toBe('html.sprout');
  });

  it('starts a word at a capital after a digit, and keeps a `_` already written', () => {
    expect(fileNamedFor('Room2B')).toBe('room2_b.sprout');
    expect(fileNamedFor('Room_B')).toBe('room_b.sprout');
  });

  it('keeps a world’s lower snake case name as it is', () => {
    expect(fileNamedFor('printers_shop')).toBe('printers_shop.sprout');
    expect(fileNamedFor('ways')).toBe('ways.sprout');
  });
});
