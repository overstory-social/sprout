import { describe, expect, it } from 'vitest';

import { ACTOR_LINES, PLACE_LINES, WORLD_LINES } from './engine-passages.js';

describe('the lines the engine says for itself', () => {
  it('are the world’s eleven and a place’s two, each named once', () => {
    const names = [...WORLD_LINES, ...PLACE_LINES].map((line) => line.name);
    expect(WORLD_LINES).toHaveLength(11);
    expect(PLACE_LINES.map((line) => line.name)).toEqual(['arrives', 'leaves']);
    expect(new Set(names).size).toBe(names.length);
  });

  it('bind what the spec’s table says: `thing` an object, `candidates` a set, `item` what moved, `to` where', () => {
    const binds = Object.fromEntries(
      [...WORLD_LINES, ...PLACE_LINES].map((line) => [line.name, line.binds]),
    );
    expect(binds.unremarkable).toEqual({ thing: 'object' });
    expect(binds.which).toEqual({ actor: 'actor', here: 'here', candidates: 'set' });
    expect(binds.inside_itself).toEqual({ item: 'object' });
    expect(binds.crowded).toEqual({ item: 'object', to: 'object' });
    expect(binds.arrives).toEqual({ item: 'object' });
    expect(binds.leaves).toEqual({ item: 'object' });
  });

  it('bind the one acting and where, for a line said to the one acting, and only as the engine does', () => {
    const binds = Object.fromEntries(WORLD_LINES.map((line) => [line.name, line.binds]));
    expect(binds.unknown).toEqual({ actor: 'actor', here: 'here' });
    expect(binds.not_here).toEqual({ actor: 'actor', here: 'here' });
    expect(binds.nothing_happens).toEqual({ actor: 'actor', here: 'here' });
    expect(binds.fault).toEqual({ actor: 'actor', here: 'here' });
    for (const bare of ['unseen', 'missing', 'displaced']) expect(binds[bare], bare).toEqual({});
  });

  it('say an actor’s `inventory` on its own kind, to the one who asked, which a poll does not say', () => {
    expect(ACTOR_LINES).toEqual([{ name: 'inventory', binds: { actor: 'actor', here: 'here' } }]);
  });
});
