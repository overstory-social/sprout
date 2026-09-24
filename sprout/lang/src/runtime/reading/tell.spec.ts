// What a reading tells, and to whom (the spec's Other people › Who hears
// it): a plain `tell` reaches the people in the teller's place less every
// participant, `tell <x>` reaches `x` only in the teller's range, and
// neither answers the actor. The town below is this file's own world.

import { describe, expect, it } from 'vitest';

import { compiledWorld } from '../../fixtures/bundle.js';
import { drain } from '../bus.js';
import { declaredId } from '../ids.js';
import { moveInstance } from '../move.js';
import { runReading, type Said } from '../reading.js';
import {
  acted,
  CAT,
  contextOf,
  DOG,
  HALL,
  NOTHING,
  reading,
  turn,
  WARDROBE,
  WORLD_ID,
  words,
  YARD,
} from '../../fixtures/reading.js';

const heard = (said: readonly Said[]) =>
  said.map((line) => [line.effect, line.by, line.to, line.speaker, words(line.said)]);

describe('a `tell` in a reading', () => {
  it('reaches the place less the participants, and the one it names, and leaves the actor to be answered', () => {
    const one = turn(YARD, [HALL, HALL, HALL, WARDROBE]);
    const [marta, ivo, uma] = one.people;
    const said = acted(
      runReading(reading(YARD, 'wave', marta!, { target: { object: ivo! } }), contextOf(one)),
    ).said;
    // Uma alone of the hall reads the first: Marta acts, Ivo takes part,
    // the cat and the dog are NPCs, and the fourth stands in the wardrobe,
    // a place of its own. Nothing reached Marta, so the world answers her.
    expect(heard(said)).toEqual([
      ['told', marta, [uma], null, '{actor} waves at {target}.'],
      ['told', marta, [ivo], null, '{actor} waves at you.'],
      ['said', WORLD_ID, [marta], null, NOTHING],
    ]);
  });

  it('is told, not framed, where an NPC acts, and goes nowhere told to an NPC', () => {
    const one = turn(YARD, [HALL, HALL]);
    const [marta, ivo] = one.people;
    const toMarta = acted(
      runReading(reading(YARD, 'wave', CAT, { target: { object: marta! } }), contextOf(one)),
    ).said;
    expect(heard(toMarta)).toEqual([
      ['told', CAT, [ivo], null, '{actor} waves at {target}.'],
      ['told', CAT, [marta], null, '{actor} waves at you.'],
    ]);
    const toDog = acted(
      runReading(reading(YARD, 'wave', CAT, { target: { object: DOG } }), contextOf(one)),
    ).said;
    expect(toDog.map((line) => line.to)).toEqual([[marta, ivo], []]);
  });
});

/**
 * A town of two places. Whoever walks from the inn to the mill is told
 * goodbye by the inn and welcome by the mill; the bell in the inn calls
 * to whoever it is rung for.
 */
const TOWN = compiledWorld('town', {
  'world.sprout': [
    'world town is sprout.World { visitors are Person visitors arrive at inn',
    '  object inn is Inn { object bell is Bell }',
    '  object mill is Mill { }',
    '}',
    'verb call { role target  role whom  "call [whom] with [target]" }',
    'kind Person is sprout.Visitor { }',
    'kind Inn is sprout.Place { on :departed (actor, to) { tell actor "Come back soon." } }',
    'kind Mill is sprout.Place { on :arrived (actor, from) { tell actor "Welcome to the mill." } }',
    'kind Bell { as target for call { do { tell whom "The bell rings for you." } } }',
    '',
  ].join('\n'),
});
const inTown = (...path: string[]) => declaredId('town', path);
const [INN, MILL, BELL] = [inTown('inn'), inTown('mill'), inTown('inn', 'bell')];

describe('a `tell <x>` out of the teller’s range', () => {
  it('goes nowhere and faults nothing, and is still a line', () => {
    const one = turn(TOWN, [INN, MILL]);
    const [marta, ivo] = one.people;
    const call = (whom: typeof marta) =>
      acted(
        runReading(
          reading(TOWN, 'call', marta!, { target: { object: BELL }, whom: { object: whom! } }),
          contextOf(one),
        ),
      ).said.filter((line) => line.effect === 'told');
    // Marta rings for herself, in the inn, and for Ivo, in the mill
    // across the world, which refuses.
    expect(heard(call(marta))).toEqual([['told', BELL, [marta], null, 'The bell rings for you.']]);
    expect(heard(call(ivo))).toEqual([['told', BELL, [], null, 'The bell rings for you.']]);
  });

  it('from a teller inside a shut container, reaches nobody outside it', () => {
    const one = turn(YARD, [HALL]);
    const [marta] = one.people;
    one.draft.place(CAT, WARDROBE);
    const wave = (shut: boolean) =>
      acted(
        runReading(reading(YARD, 'wave', CAT, { target: { object: marta! } }), {
          ...contextOf(one),
          passes: (container) => container !== one.draft.world && !(shut && container === WARDROBE),
        }),
      ).said.map((line) => line.to);
    // The cat waves from the wardrobe, where nobody stands, at Marta in
    // the hall: through the open door she is told, and through the shut
    // one nobody is.
    expect(wave(false)).toEqual([[], [marta]]);
    expect(wave(true)).toEqual([[], []]);
  });

  it('in the place an actor just left reaches nobody, and in the place it entered reaches them', () => {
    const one = turn(TOWN, [INN]);
    const [marta] = one.people;
    const context = contextOf(one);
    const moved = moveInstance(context, marta!, marta!, MILL, 'exit');
    if (!('sends' in moved)) throw new Error('the walk to the mill was refused');
    const drained = drain({ sends: moved.sends, destroyed: [], marked: [] }, context);
    expect(heard(drained.said)).toEqual([
      ['told', INN, [], null, 'Come back soon.'],
      ['told', MILL, [marta], null, 'Welcome to the mill.'],
    ]);
  });
});
