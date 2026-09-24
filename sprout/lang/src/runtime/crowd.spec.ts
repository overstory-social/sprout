// The host's bound on how many people stand in one place: who counts, and
// the engine's words for someone turned away. How a move, `go` and an
// arrival ask it is in their own specs.

import { describe, expect, it } from 'vitest';

import { ALCOVE, HALL, MARTA, turn, visitorIn } from '../fixtures/move.js';
import { boundObject as bound, proseTurn, YARD } from '../fixtures/prose.js';
import { renderFor } from '../prose/speech.js';
import { FULL, turnedAway } from './crowd.js';

describe('a place the host bounds', () => {
  it('turns away a person once it holds as many other people as the host allows', () => {
    const { draft, visitor } = turn();
    expect(turnedAway(draft, visitor, ALCOVE, 1)).toBe(false);
    visitorIn(draft, ALCOVE);
    expect(turnedAway(draft, visitor, ALCOVE, 1)).toBe(true);
    expect(turnedAway(draft, visitor, ALCOVE, 2)).toBe(false);
  });

  it('never turns anyone away where the host set no bound', () => {
    const { draft, visitor } = turn();
    for (let i = 0; i < 20; i++) visitorIn(draft, ALCOVE);
    expect(turnedAway(draft, visitor, ALCOVE, null)).toBe(false);
  });

  it('counts only people: an NPC neither counts nor is turned away', () => {
    const { draft, visitor } = turn();
    // Marta is an NPC standing in the hall with the visitor.
    expect(turnedAway(draft, visitor, HALL, 1)).toBe(false);
    visitorIn(draft, ALCOVE);
    expect(turnedAway(draft, MARTA, ALCOVE, 1)).toBe(false);
  });

  it('does not count the person moving, so one already there is never turned away from it', () => {
    const { draft, visitor } = turn();
    expect(turnedAway(draft, visitor, HALL, 1)).toBe(false);
  });
});

describe('the words for someone turned away', () => {
  it('name the place, and the person as the reader reads them', () => {
    const prose = proseTurn();
    const line = {
      by: prose.draft.world,
      said: FULL,
      bindings: new Map([
        ['item', bound(prose.marta)],
        ['to', bound(YARD)],
      ]),
    };
    expect(renderFor(line, prose.marta, prose.context)).toEqual([
      'There is no room in a yard for you.',
    ]);
  });
});
