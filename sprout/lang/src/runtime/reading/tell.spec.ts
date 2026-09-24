// What a reading tells, and to whom (the spec's Other people › Who hears
// it): a plain `tell` reaches the people in the teller's place less every
// participant, `tell <x>` reaches `x`, and neither answers the actor.

import { describe, expect, it } from 'vitest';

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
