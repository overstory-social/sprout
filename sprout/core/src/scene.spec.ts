import { describe, expect, it } from 'vitest';

import { NO_EXTENSIONS, compileMicroworld, runMove, turnContext } from '@overstory/sprout/lang';

import type { ObjectRecord } from './records.js';
import { memoryAfter, microworldOf, rowsAfter, sceneFor, stampOf, under } from './scene.js';

// Records → a Scene and back (§4.1): placed things with no row are at
// home at their defaults; rows say where things are now; a row nothing
// answers for is an orphan; what a turn changed becomes rows again.

const { program } = compileMicroworld(
  {
    files: [
      {
        name: 'a.sprout',
        source: `kind Cup { :takeable true }
room hall { :lit false exit "down" to cellar }
room cellar {}
object lamp in hall { :lit false :takeable true :remembers [seen: false] }
object chest: Container in hall { :open true }
object coin in chest { :takeable true }
object far in cellar {}`,
      },
    ],
  },
  { strict: true },
);

const rows: ObjectRecord[] = [
  {
    microworldId: 'w',
    id: 'hall',
    spawnedFrom: null,
    container: null,
    home: null,
    state: { lit: true, stray: 1 },
  },
  {
    microworldId: 'w',
    id: 'lamp',
    spawnedFrom: null,
    container: 'p-marta',
    home: 'hall',
    state: { lit: 'yes' },
  },
  {
    microworldId: 'w',
    id: 'spawn-3',
    spawnedFrom: 'Cup',
    container: 'hall',
    home: 'hall',
    state: {},
  },
  {
    microworldId: 'w',
    id: 'spawn-4',
    spawnedFrom: 'Ghost',
    container: 'hall',
    home: 'hall',
    state: {},
  },
];

describe('microworldOf', () => {
  it('builds every object: rooms and placed things from the program, spawned things from rows; normalizes state; drops orphans', () => {
    const world = microworldOf(
      program,
      rows,
      { microworldId: 'w', actorId: 'p-marta', byObject: { lamp: { seen: true } } },
      NO_EXTENSIONS,
    );
    expect([...world.objects.keys()].sort()).toEqual([
      'cellar',
      'chest',
      'coin',
      'far',
      'hall',
      'lamp',
      'spawn-3',
    ]);
    expect(world.orphans).toEqual(['spawn-4']);
    expect(world.objects.get('hall')?.state).toEqual({ lit: true }); // stray dropped
    expect(world.objects.get('lamp')).toMatchObject({
      state: { lit: false, takeable: true },
      container: 'p-marta',
      home: 'hall',
      visitor: { seen: true },
    });
    expect(world.objects.get('coin')).toMatchObject({ container: 'chest', home: 'hall' }); // home walks the placement
    expect(world.objects.get('spawn-3')).toMatchObject({ spawnedFrom: 'Cup', kinds: ['Cup'] });
    expect(world.kinds.get('Cup')?.kindId).toBe('Cup');
  });

  it('under: what a set of roots holds at any depth', () => {
    const world = microworldOf(program, rows, null, NO_EXTENSIONS);
    expect(
      under(world.objects, new Set(['hall']))
        .map((o) => o.id)
        .sort(),
    ).toEqual(['chest', 'coin', 'spawn-3']);
    expect(under(world.objects, new Set(['p-marta'])).map((o) => o.id)).toEqual(['lamp']);
  });
});

describe('sceneFor and back', () => {
  it('the scene is the room, the actor, what both hold; elsewhere for a move; the outcome becomes rows and memory', () => {
    const world = microworldOf(program, rows, null, NO_EXTENSIONS);
    const scene = sceneFor(world, 'p-marta', 'hall', { room: 'cellar', actors: ['p-dana'] });
    expect(scene.items.map((o) => o.id).sort()).toEqual(['chest', 'coin', 'lamp', 'spawn-3']);
    expect(scene.elsewhere?.map((o) => o.id)).toEqual(['cellar', 'far', 'p-dana']);
    const ctx = turnContext();
    const dropped = runMove(scene, ctx, 'lamp', 'hall');
    expect(dropped.ok).toBe(true);
    const change = rowsAfter('w', scene, dropped, new Set(['p-marta', 'p-dana']));
    expect(change.upsert.map((r) => [r.id, r.container])).toEqual([['lamp', 'hall']]);
    expect(change.remove).toEqual([]);
    dropped.remembered.add('lamp');
    scene.items.find((o) => o.id === 'lamp')!.visitor['seen'] = true;
    expect(
      memoryAfter({ microworldId: 'w', actorId: 'p-marta', byObject: {} }, scene, dropped).byObject,
    ).toEqual({ lamp: { seen: true } });
    expect(() => sceneFor(world, 'p-marta', 'attic')).toThrow(/no room attic/);
  });

  it('stampOf is stable and short', () => {
    expect(stampOf('a')).toBe(stampOf('a'));
    expect(stampOf('a')).not.toBe(stampOf('b'));
    expect(stampOf('anything')).toMatch(/^[0-9a-f]{8}$/);
  });
});
