// `sprout.Actor`'s own guards on a move: a person is not carried off,
// what they hold is not taken, and what does not fit is refused in the
// world's own words. The keep, whose visitors compose it, is
// `fixtures/move.ts`.

import { describe, expect, it } from 'vitest';

import {
  ALCOVE,
  context,
  LEAF,
  MARTA,
  moved,
  refusalOf,
  STONE,
  TRAY,
  turn,
  TWIG,
} from '../../fixtures/move.js';
import { moveInstance } from '../move.js';

describe('`sprout.Actor`’s guards, through a world whose visitors compose it', () => {
  it('keep a stranger from carrying a person off', () => {
    const { draft, visitor } = turn();
    const refusal = refusalOf(moveInstance(context(draft), MARTA, visitor, ALCOVE));
    expect(refusal).toMatchObject({ guard: 'depart', by: visitor, origin: 'sprout.Actor' });
    expect('passage' in refusal.said && refusal.said.passage).toMatchObject({
      name: 'held_fast',
      origin: 'sprout.Actor',
    });
    // A person moves themselves.
    moved(moveInstance(context(draft), visitor, visitor, ALCOVE));
  });

  it('keep a stranger from taking what a person holds', () => {
    const { draft, visitor } = turn();
    moved(moveInstance(context(draft), visitor, STONE, visitor));
    const refusal = refusalOf(moveInstance(context(draft), MARTA, STONE, MARTA));
    expect(refusal).toMatchObject({ guard: 'release', by: visitor, origin: 'sprout.Actor' });
    expect('passage' in refusal.said && refusal.said.passage.name).toBe('not_yours');
    expect(draft.instance(STONE)!.container).toBe(visitor);
    // What a person puts down, they put down.
    moved(moveInstance(context(draft), visitor, STONE, TRAY));
  });

  it('refuse what does not fit, in the world’s own words where it writes them', () => {
    const { draft, visitor } = turn();
    moved(moveInstance(context(draft), visitor, STONE, visitor));
    moved(moveInstance(context(draft), visitor, TWIG, visitor));
    const refusal = refusalOf(moveInstance(context(draft), MARTA, LEAF, visitor));
    expect(refusal).toMatchObject({ guard: 'accept', by: visitor, origin: 'sprout.Actor' });
    expect('passage' in refusal.said && refusal.said.passage).toMatchObject({
      name: 'hands_full',
      origin: 'keep.Creature',
    });
    expect(draft.children(visitor)).toEqual([STONE, TWIG]);
  });

  it('let a gift arrive where there is room', () => {
    const { draft, visitor } = turn();
    moved(moveInstance(context(draft), MARTA, STONE, visitor));
    expect(draft.children(visitor)).toEqual([STONE]);
  });
});
