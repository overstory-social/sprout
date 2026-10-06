// What an offer foresees of its move: the engine's `inside_itself` where
// the reading's first sure move would put a thing inside itself, read from
// the `do`s it would run without running them. The nest below is this
// file's own world.

import { describe, expect, it } from 'vitest';

import { compiledWorld } from '../fixtures/bundle.js';
import { reading, turn, words, type Turn } from '../fixtures/reading.js';
import { declaredId, type InstanceId } from './ids.js';
import { insideItselfOf } from './inside-itself.js';
import type { Bound } from './reading.js';

/**
 * A booth a visitor stands in, which plays `take`'s target, so taking it
 * is a reading someone may make; a box holding a jar, both containers; a
 * key; and a folder that folds into itself only inside an `if`, and
 * crumples into itself always.
 */
const NEST = compiledWorld('nest', {
  'nest.sprout': [
    'world nest is sprout.World { visitors are Person visitors arrive at booth',
    '  object booth is Booth {',
    '    object box is sprout.Container { object jar is sprout.Container }',
    '    object key is Plain',
    '    object folder is Folder',
    '  }',
    '}',
    'verb fold { role target  "fold [target]" }',
    'verb crumple { role target  "crumple [target]" }',
    'kind Person is sprout.Visitor { }',
    'kind Booth is sprout.Place { as target for take { do { } } }',
    'kind Plain { }',
    'kind Folder {',
    '  contains',
    '  :flat true',
    '  as target for fold { do { if (self.get(:flat)) { move self to self } } }',
    '  as target for crumple { do { move self to self } }',
    '}',
    '',
  ].join('\n'),
});

const at = (...path: string[]): InstanceId => declaredId('nest', path);
const BOOTH = at('booth');
const BOX = at('booth', 'box');
const JAR = at('booth', 'box', 'jar');
const KEY = at('booth', 'key');
const FOLDER = at('booth', 'folder');

const foreseen = (one: Turn, verb: string, bindings: Record<string, Bound>, library = 'sprout') =>
  insideItselfOf(reading(NEST, verb, one.people[0]!, bindings, library), {
    state: one.draft,
    catalogue: one.catalogue,
    budget: one.budget,
    passes: () => true,
  });

describe('what an offer foresees of its move', () => {
  it('is the engine’s `inside_itself` where taking would put the actor’s own place in their hands', () => {
    const one = turn(NEST, [BOOTH]);
    const refused = foreseen(one, 'take', { target: { object: BOOTH } })!;
    expect(refused).not.toBeNull();
    expect(words(refused.said)).toBe('sprout.World inside_itself: {item} cannot go inside itself.');
    expect(refused.role).toBe('actor');
    expect(refused.origin).toBeNull();
    expect([...refused.bindings]).toEqual([['item', { binds: 'object', id: BOOTH }]]);
  });

  it('is the same where putting a thing would put it into what it holds', () => {
    const one = turn(NEST, [BOOTH]);
    const marta = one.people[0]!;
    one.draft.place(BOX, marta);
    const refused = foreseen(one, 'put', { item: { object: BOX }, container: { object: JAR } });
    expect(refused?.bindings.get('item')).toEqual({ binds: 'object', id: BOX });
    expect(foreseen(one, 'put', { item: { object: KEY }, container: { object: JAR } })).toBeNull();
  });

  it('is nothing where the move goes somewhere else, as taking a key does', () => {
    const one = turn(NEST, [BOOTH]);
    expect(foreseen(one, 'take', { target: { object: KEY } })).toBeNull();
  });

  it('reads only a `move` written directly in a `do`, since one inside an `if` may not run', () => {
    const one = turn(NEST, [BOOTH]);
    expect(foreseen(one, 'fold', { target: { object: FOLDER } }, 'nest')).toBeNull();
    expect(foreseen(one, 'crumple', { target: { object: FOLDER } }, 'nest')?.by).toBe(
      one.draft.world,
    );
  });
});
