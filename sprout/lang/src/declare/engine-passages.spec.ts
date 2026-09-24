import { describe, expect, it } from 'vitest';

import { PLACE_LINES, WORLD_LINES } from './engine-passages.js';

describe('the lines the engine says for itself', () => {
  it('are the world’s ten and a place’s two, each named once', () => {
    const names = [...WORLD_LINES, ...PLACE_LINES].map((line) => line.name);
    expect(WORLD_LINES).toHaveLength(10);
    expect(PLACE_LINES.map((line) => line.name)).toEqual(['arrives', 'leaves']);
    expect(new Set(names).size).toBe(names.length);
  });

  it('bind what the spec’s table says: `thing` an object, `candidates` a set, `item` what moved', () => {
    const binds = Object.fromEntries(
      [...WORLD_LINES, ...PLACE_LINES].map((line) => [line.name, line.binds]),
    );
    expect(binds.unreachable).toEqual({ thing: 'object' });
    expect(binds.unremarkable).toEqual({ thing: 'object' });
    expect(binds.which).toEqual({ candidates: 'set' });
    expect(binds.inside_itself).toEqual({ item: 'object' });
    expect(binds.arrives).toEqual({ item: 'object' });
    expect(binds.leaves).toEqual({ item: 'object' });
    for (const bare of ['unknown', 'nothing_happens', 'unseen', 'fault', 'missing', 'displaced']) {
      expect(binds[bare], bare).toEqual({});
    }
  });
});
