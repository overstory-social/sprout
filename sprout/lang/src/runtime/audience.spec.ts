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
import { isPerson, toldInside, toldOutside, toldToOne, toldToPlace } from './audience.js';

/** What a plain, an `inside` or an `outside` `tell` reads in `one`, where `shut` refuses everything and the world refuses too. */
const telling = (one: Turn, ...shut: InstanceId[]) => ({
  state: one.draft,
  passes: (container: InstanceId) =>
    container === one.draft.world ? WORLD_PASSES_ANYTHING : !shut.includes(container),
  budget: one.budget,
});

describe('who reads `tell inside` and `tell outside`', () => {
  it('is a teller’s own occupants, and nobody’s where it holds no actors', () => {
    const one = turn(YARD, [HALL, WARDROBE, HALL]);
    const [, bo] = one.people;
    // The wardrobe holds actors, so its own occupant is Bo; the bubble does not.
    expect(toldInside(telling(one), WARDROBE, [])).toEqual([bo]);
    expect(toldInside(telling(one), BUBBLE, [])).toEqual([]);
  });

  it('is the place around a teller, less a hearer a shut container stands between', () => {
    const one = turn(YARD, [HALL, WARDROBE, HALL]);
    const [marta, , ivo] = one.people;
    expect(toldOutside(telling(one), WARDROBE, [])).toEqual([marta, ivo]);
    // The wardrobe's own shut-ness does not stand between it and the hall
    // around it: nothing does, so it is still heard there.
    expect(toldOutside(telling(one, WARDROBE), WARDROBE, [])).toEqual([marta, ivo]);
    // The bead, inside the shut bubble, carries no voice out past it.
    expect(toldOutside(telling(one, BUBBLE), BEAD, [])).toEqual([]);
    expect(toldOutside(telling(one), BEAD, [])).toEqual([marta, ivo]);
  });

  it('is nowhere where nothing around the teller holds actors', () => {
    const one = turn(YARD, []);
    expect(toldOutside(telling(one), WORLD_ID, [])).toEqual([]);
  });
});

describe('who reads a plain `tell`', () => {
  it('is every person the teller reaches, its own occupants first, less those left out', () => {
    const one = turn(YARD, [HALL, WARDROBE, HALL]);
    const [marta, bo, ivo] = one.people;
    // The cat and the dog stand in the hall and are NPCs; Bo is in the
    // wardrobe, a place of its own.
    expect(toldToPlace(telling(one), BUBBLE, [])).toEqual([marta, ivo]);
    expect(toldToPlace(telling(one), BEAD, [marta!])).toEqual([ivo]);
    // The wardrobe holds actors, so its plain `tell` reaches both its own
    // occupant and, around it, the hall's.
    expect(toldToPlace(telling(one), WARDROBE, [])).toEqual([bo, marta, ivo]);
    expect(toldToPlace(telling(one), WORLD_ID, [])).toEqual([]);
  });

  it('leaves out a hearer a shut container stands between, either audience', () => {
    const one = turn(YARD, [HALL, WARDROBE, HALL]);
    const [marta, bo, ivo] = one.people;
    // A thing inside the shut bubble reaches nothing outside it, but the
    // wardrobe's own occupant is always heard, shut or not.
    expect(toldToPlace(telling(one, BUBBLE), BEAD, [])).toEqual([]);
    expect(toldToPlace(telling(one), BEAD, [])).toEqual([marta, ivo]);
    expect(toldToPlace(telling(one, WARDROBE), WARDROBE, [])).toEqual([bo, marta, ivo]);
  });
});

describe('who reads `tell x`', () => {
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
