import { describe, expect, it } from 'vitest';

import {
  BEAD,
  BUBBLE,
  CAT,
  DOG,
  HALL,
  STONE,
  turn,
  WARDROBE,
  WORLD_ID,
  YARD,
} from '../fixtures/reading.js';
import { isPerson, placeOfTeller, toldToOne, toldToPlace } from './audience.js';

describe('where what is told is heard', () => {
  it('is the teller where it holds actors, else its nearest container that does', () => {
    const one = turn(YARD, [HALL]);
    expect(placeOfTeller(one.draft, STONE)).toBe(HALL);
    // Inside a container that holds only things, the hall around it.
    expect(placeOfTeller(one.draft, BEAD)).toBe(HALL);
    // A place tells its own occupants, as a place ticking does.
    expect(placeOfTeller(one.draft, HALL)).toBe(HALL);
    expect(placeOfTeller(one.draft, WARDROBE)).toBe(WARDROBE);
    expect(placeOfTeller(one.draft, one.people[0]!)).toBe(HALL);
  });

  it('is nowhere where nothing around the teller holds actors', () => {
    const one = turn(YARD, []);
    expect(placeOfTeller(one.draft, WORLD_ID)).toBeNull();
  });
});

describe('who reads a plain `tell`', () => {
  it('is every person directly in the place, in contents order, less those left out', () => {
    const one = turn(YARD, [HALL, WARDROBE, HALL]);
    const [marta, bo, ivo] = one.people;
    // The cat and the dog stand in the hall and are NPCs; Bo is in the
    // wardrobe, a place of its own.
    expect(toldToPlace(one.draft, BUBBLE, [])).toEqual([marta, ivo]);
    expect(toldToPlace(one.draft, BEAD, [marta!])).toEqual([ivo]);
    expect(toldToPlace(one.draft, WARDROBE, [])).toEqual([bo]);
    expect(toldToPlace(one.draft, WORLD_ID, [])).toEqual([]);
  });
});

describe('who reads `tell x`', () => {
  it('is `x`, where it is a person standing in the world, and nobody otherwise', () => {
    const one = turn(YARD, [WARDROBE, HALL]);
    const [bo, away] = one.people;
    expect(toldToOne(one.draft, bo!)).toEqual([bo]);
    expect(toldToOne(one.draft, CAT)).toEqual([]);
    expect(toldToOne(one.draft, STONE)).toEqual([]);
    one.draft.place(away!, null);
    expect(toldToOne(one.draft, away!)).toEqual([]);
  });

  it('asks who is a person by how they were made', () => {
    const one = turn(YARD, [HALL]);
    expect(isPerson(one.draft, one.people[0]!)).toBe(true);
    expect([CAT, DOG, STONE, HALL].map((id) => isPerson(one.draft, id))).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });
});
