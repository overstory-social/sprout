import { describe, expect, it } from 'vitest';

import {
  BEAD,
  BUBBLE,
  CAT,
  DOG,
  HALL,
  STONE,
  turn,
  type Turn,
  WARDROBE,
  WORLD_ID,
  YARD,
} from '../fixtures/reading.js';
import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { WORLD_PASSES_ANYTHING } from '../declare/world.js';
import { Budget } from './budget.js';
import type { InstanceId } from './ids.js';
import { liveTree } from './live.js';
import { reaches } from './range.js';
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
  /** What `tell x` reads in `one`, where `shut` refuses everything and the world refuses too. */
  const telling = (one: Turn, ...shut: InstanceId[]) => ({
    state: one.draft,
    passes: (container: InstanceId) =>
      container === one.draft.world ? WORLD_PASSES_ANYTHING : !shut.includes(container),
    budget: one.budget,
  });

  it('is `x`, where it is a person in the teller’s range, and nobody otherwise', () => {
    const one = turn(YARD, [WARDROBE, HALL]);
    const [bo, away] = one.people;
    // The wardrobe relays, so the stone in the hall reaches Bo inside it.
    expect(toldToOne(telling(one), STONE, bo!)).toEqual([bo]);
    expect(toldToOne(telling(one), bo!, bo!)).toEqual([bo]);
    expect(toldToOne(telling(one), STONE, CAT)).toEqual([]);
    expect(toldToOne(telling(one), CAT, STONE)).toEqual([]);
    one.draft.place(away!, null);
    expect(toldToOne(telling(one), STONE, away!)).toEqual([]);
  });

  it('is nobody where `x` stands beyond the world, which refuses', () => {
    const one = turn(YARD, [HALL]);
    const [marta] = one.people;
    expect(toldToOne(telling(one), STONE, marta!)).toEqual([marta]);
    // Standing in the world itself, outside the hall, as another place's
    // occupant does: the world is between them, and it refuses.
    one.draft.place(marta!, WORLD_ID);
    expect(toldToOne(telling(one), STONE, marta!)).toEqual([]);
  });

  it('is nobody where a container between refuses, either way across it', () => {
    const one = turn(YARD, [HALL, WARDROBE]);
    const [marta, bo] = one.people;
    // A teller inside the shut bubble reaches its surface and no further.
    expect(toldToOne(telling(one, BUBBLE), BEAD, marta!)).toEqual([]);
    expect(toldToOne(telling(one), BEAD, marta!)).toEqual([marta]);
    // Bo in a shut wardrobe is out of the stone's range, and the stone out of his.
    expect(toldToOne(telling(one, WARDROBE), STONE, bo!)).toEqual([]);
    expect(toldToOne(telling(one, WARDROBE), bo!, bo!)).toEqual([bo]);
  });

  it('charges the walk `reaches` makes to the turn’s budget, and none for an NPC', () => {
    const one = turn(YARD, [HALL]);
    const marta = one.people[0]!;
    const alone = new Budget(DEFAULT_LIMITS.budgets);
    reaches({ ...telling(one), tree: liveTree(one.draft), budget: alone }, BEAD, marta, 'any');
    toldToOne(telling(one), BEAD, marta);
    expect(one.budget.spentSteps).toBe(alone.spentSteps);
    expect(alone.spentSteps).toBeGreaterThan(0);
    toldToOne(telling(one), BEAD, CAT);
    expect(one.budget.spentSteps).toBe(alone.spentSteps);
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
