import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { ENGINE_LINES, type EngineLineName } from '../declare/engine-passages.js';
import { compiledWorld } from '../fixtures/bundle.js';
import { textOf } from '../source/source.js';
import { catalogueOf } from './catalogue.js';
import { engineLine, engineSaid, STOCK_LINES } from './engine-lines.js';
import { declaredId, type InstanceId } from './ids.js';
import { initialState } from './load.js';
import { readerOf, type StateReader } from './state.js';

describe('the engine’s own fixed words are one-line passages', () => {
  it('read as prose does, their slots naming what the engine binds, in the standard library', () => {
    const line = engineLine('{item} cannot stand in {to}.');
    expect(line.text).toBe('{item} cannot stand in {to}.');
    expect(line.library).toBe('sprout');
    expect(line.prose.pieces.map((piece) => [piece.kind, textOf(piece.at)])).toEqual([
      ['prose-slot', '{item}'],
      ['prose-words', ' cannot stand in '],
      ['prose-slot', '{to}'],
      ['prose-words', '.'],
    ]);
  });

  it('throw where a line does not read, since that is the engine’s defect and no author’s', () => {
    expect(() => engineLine('{item cannot stand')).toThrow(/does not read/);
  });
});

/** A yard where the cat, the hall and the world each word some lines, and a shed and a dog word none. */
const YARD = compiledWorld('yard', {
  'yard.sprout': `world yard is sprout.World {
  visitors are Person
  visitors arrive at hall
  passage waited { The world waits. }
  passage not_here { The world sees no such thing. }
  object hall is Hall {
    object cat is Cat
    object dog is Dog
  }
  object shed is sprout.Place {
    object mole is Dog
  }
}
kind Person is sprout.Visitor { }
kind Hall is sprout.Place {
  passage waited { The hall waits. }
  passage unknown default { The hall does not follow. }
  passage not_here default { The hall sees no such thing. }
}
kind Cat is sprout.Actor { passage waited { The cat waits. } }
kind Dog is sprout.Actor { }
`,
});
const yard = readerOf(initialState(catalogueOf(YARD, DEFAULT_LIMITS.caps)));
const [HALL, SHED, CAT, DOG, MOLE] = [
  ['hall'],
  ['shed'],
  ['hall', 'cat'],
  ['hall', 'dog'],
  ['shed', 'mole'],
].map((path) => declaredId('yard', path));

/** What `engineSaid` finds, as who says it and the words it was written with. */
function found(name: EngineLineName, about: InstanceId | null, place: InstanceId | null) {
  const { by, said } = engineSaid(yard, name, about, place);
  return [
    by,
    'passage' in said ? said.passage.body.text.trim() : 'text' in said ? said.text : null,
  ];
}

describe('an engine line, as the engine says it', () => {
  it('is the one it is about’s own, then its place’s, then the world’s', () => {
    expect(found('waited', CAT, HALL)).toEqual([CAT, 'The cat waits.']);
    expect(found('waited', DOG, HALL)).toEqual([HALL, 'The hall waits.']);
    expect(found('waited', MOLE, SHED)).toEqual([yard.world, 'The world waits.']);
    expect(found('waited', null, null)).toEqual([yard.world, 'The world waits.']);
  });

  it('passes over a `default` for any other along the way, and takes the nearest where all are', () => {
    expect(found('not_here', DOG, HALL)).toEqual([yard.world, 'The world sees no such thing.']);
    expect(found('unknown', DOG, HALL)).toEqual([HALL, 'The hall does not follow.']);
    expect(found('unknown', MOLE, SHED)).toEqual([
      yard.world,
      'That is not something you can do here.',
    ]);
  });

  it('is the standard library’s words, said by the engine, where nothing along the way writes it', () => {
    const world = yard.instance(yard.world)!;
    const bare: StateReader = {
      ...yard,
      instance: (id) =>
        id === yard.world
          ? { ...world, kind: { ...world.kind, passages: new Map() } }
          : yard.instance(id),
    };
    const { by, said } = engineSaid(bare, 'fault', MOLE, SHED);
    expect(by).toBe(yard.world);
    expect(said).toMatchObject({ text: STOCK_LINES.fault, library: 'sprout' });
    // A place's line is said by the place, and an actor's by the actor.
    expect(engineSaid(bare, 'arrives', MOLE, null).by).toBe(yard.world);
    expect(engineSaid(bare, 'inventory', MOLE, SHED).by).toBe(MOLE);
  });

  it('keeps stock words that are the standard library’s own, line for line', () => {
    const plain = (text: string) => text.trim().split(/\s+/).join(' ');
    const library = new Map(
      ['World', 'Place', 'Actor'].flatMap((kind) =>
        [...YARD.kindLookup.qualified('sprout', kind)!.passages.values()].map(
          (passage) => [passage.name, plain(passage.body.text)] as const,
        ),
      ),
    );
    for (const line of ENGINE_LINES) {
      const name = line.name as EngineLineName;
      expect(plain(STOCK_LINES[name]), name).toBe(library.get(name));
    }
  });
});
