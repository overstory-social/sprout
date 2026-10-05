import { describe, expect, it } from 'vitest';

import { ACTOR_LINES, ENGINE_LINES, ownerOf, PLACE_LINES, WORLD_LINES } from './engine-passages.js';

describe('the lines the engine says for itself', () => {
  it('are the world’s twenty, a place’s two and an actor’s one, each named once', () => {
    const names = ENGINE_LINES.map((line) => line.name);
    expect(WORLD_LINES).toHaveLength(20);
    expect(names).toHaveLength(23);
    expect(PLACE_LINES.map((line) => line.name)).toEqual(['arrives', 'leaves']);
    expect(new Set(names).size).toBe(names.length);
  });

  it('bind what the spec’s table says: `thing` an object, `item` what moved, `to` where, `readings` what `help` offers', () => {
    const binds = Object.fromEntries(
      [...WORLD_LINES, ...PLACE_LINES].map((line) => [line.name, line.binds]),
    );
    expect(binds.unremarkable).toEqual({ thing: 'object' });
    expect(binds.dark).toEqual({ actor: 'actor', here: 'here' });
    expect(binds.meant).toEqual({ actor: 'actor', here: 'here', thing: 'object' });
    expect(binds.not_carrying).toEqual({ actor: 'actor', here: 'here', thing: 'object' });
    expect(binds.inside_itself).toEqual({ item: 'object' });
    expect(binds.crowded).toEqual({ item: 'object', to: 'object' });
    expect(binds.arrives).toEqual({ item: 'object', from: 'object', way: 'text' });
    expect(binds.leaves).toEqual({ item: 'object', to: 'object', way: 'text' });
    expect(binds.help).toEqual({ actor: 'actor', here: 'here', readings: 'readings' });
  });

  it('bind `actor` and the line they typed as text in `acted`, which a poll says', () => {
    const acted = WORLD_LINES.find((line) => line.name === 'acted');
    expect(acted).toEqual({
      name: 'acted',
      binds: { actor: 'actor', reading: 'text' },
      polled: true,
    });
  });

  it('bind the one acting and where, for a line said to the one acting, and only as the engine does', () => {
    const binds = Object.fromEntries(WORLD_LINES.map((line) => [line.name, line.binds]));
    expect(binds.unknown).toEqual({ actor: 'actor', here: 'here' });
    expect(binds.not_here).toEqual({ actor: 'actor', here: 'here' });
    expect(binds.nothing_happens).toEqual({ actor: 'actor', here: 'here' });
    expect(binds.fault).toEqual({ actor: 'actor', here: 'here' });
    for (const bare of ['unseen', 'missing', 'displaced', 'waited']) {
      expect(binds[bare], bare).toEqual({});
    }
  });

  it('leave the place left or entered, and the way, unbound where a move has none', () => {
    const optional = Object.fromEntries(ENGINE_LINES.map((line) => [line.name, line.optional]));
    expect(Object.keys(optional.arrives!)).toEqual(['from', 'way']);
    expect(Object.keys(optional.leaves!)).toEqual(['to', 'way']);
    expect(ENGINE_LINES.filter((line) => line.optional !== undefined)).toHaveLength(2);
  });

  it('bind the one leaving in `gone_away`, and an NPC and its words as text in `npc_says`', () => {
    const binds = Object.fromEntries(WORLD_LINES.map((line) => [line.name, line.binds]));
    expect(binds.gone_away).toEqual({ actor: 'actor' });
    expect(binds.npc_says).toEqual({ actor: 'actor', words: 'text' });
  });

  it('are each written by the library kind whose default it is', () => {
    expect(ownerOf('fault')).toBe('World');
    expect(ownerOf('npc_says')).toBe('World');
    expect(ownerOf('arrives')).toBe('Place');
    expect(ownerOf('inventory')).toBe('Actor');
  });

  it('say an actor’s `inventory` on its own kind, to the one who asked, which a poll does not say', () => {
    expect(ACTOR_LINES).toEqual([{ name: 'inventory', binds: { actor: 'actor', here: 'here' } }]);
  });
});
