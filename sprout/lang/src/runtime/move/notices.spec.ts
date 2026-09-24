// What an actor's move tells: each place's `leaves` and `arrives` read by
// the visitors in its range, `:departed` and `:arrived` sent to the rest,
// the description to the one who moved, and what one place says alone
// through `placeEntered` and `placeLeft`. The keep is `fixtures/move.ts`.

import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '../../bundle/limits.js';
import {
  ALCOVE,
  CELLAR,
  CHEST,
  CLOSET,
  COIN,
  context,
  DISH,
  HALL,
  MARTA,
  moved,
  NOOK,
  passing,
  PURSE,
  SAM,
  STONE,
  TOM,
  turn,
  visitorIn,
  WORLD_ID,
} from '../../fixtures/move.js';
import { Budget } from '../budget.js';
import type { Draft } from '../draft.js';
import { liveTree } from '../live.js';
import { moveInstance, placeEntered, placeLeft } from '../move.js';
import { rangeOf, reaches } from '../range.js';

describe('an actor moved between places', () => {
  /** The closet and the chest refuse; everything else but the world relays. */
  const walled = passing(CLOSET, CHEST);

  /**
   * A visitor walks from the hall into the alcove. Another stands in the
   * nook, which relays, beside Tom, an NPC; a third stands in the closet
   * beside Sam, and the closet refuses.
   */
  const walk = () => {
    const { draft, visitor } = turn();
    const near = visitorIn(draft, NOOK);
    const shut = visitorIn(draft, CLOSET);
    const budget = new Budget(DEFAULT_LIMITS.budgets);
    const outcome = moved(
      moveInstance(context(draft, { passes: walled, budget }), visitor, visitor, ALCOVE),
    );
    const sent = (message: string) =>
      outcome.sends.filter((send) => send.message === message).map((send) => send.recipient);
    return { draft, visitor, near, shut, outcome, sent, budget };
  };

  it('has the old place’s `leaves` read by every visitor in its range, and by no NPC', () => {
    const { visitor, near, outcome } = walk();
    const leaves = outcome.notices.find((notice) => notice.notice === 'leaves')!;
    // The nook's visitor is not directly in the hall, and is in its range;
    // the closet's is not.
    expect(leaves).toMatchObject({ place: HALL, bindings: { item: visitor }, audience: [near] });
    expect('passage' in leaves && [leaves.passage.origin, leaves.passage.name]).toEqual([
      'sprout.Place',
      'leaves',
    ]);
  });

  it('sends `:departed (actor, to)` to everything else in the old place’s range, nearest first', () => {
    const { draft, visitor, near, shut, outcome, sent } = walk();
    const departed = sent('departed');
    // The place, what is directly in it, an NPC in the nook, a thing in
    // the tray, and the world, reached as a surface.
    for (const one of [HALL, MARTA, STONE, NOOK, TOM, DISH, CHEST, WORLD_ID]) {
      expect(departed, one).toContain(one);
    }
    // Behind the closet's wall and the chest's lid; the visitors, who read
    // the text; and the one who moved.
    for (const one of [SAM, COIN, PURSE, near, shut, visitor]) {
      expect(departed, one).not.toContain(one);
    }
    expect(departed.indexOf(MARTA)).toBeLessThan(departed.indexOf(TOM));
    expect(outcome.sends.find((send) => send.message === 'departed')).toEqual({
      message: 'departed',
      recipient: HALL,
      actor: visitor,
      to: ALCOVE,
    });
    // Nothing out of range is told: every recipient is reached from the hall.
    const range = {
      tree: liveTree(draft),
      passes: walled,
      budget: new Budget(DEFAULT_LIMITS.budgets),
    };
    for (const one of departed) expect(reaches(range, HALL, one, 'any'), one).toBe(true);
  });

  it('has the new place’s own `arrives` read by every visitor in its range, the one arriving left out', () => {
    const { visitor, near, outcome } = walk();
    expect(outcome.notices.map((notice) => notice.notice)).toEqual([
      'leaves',
      'arrives',
      'described',
    ]);
    const arrives = outcome.notices[1]!;
    // The alcove relays into the hall, so the nook is in its range too,
    // and its visitor reads both notices.
    expect(arrives).toMatchObject({ place: ALCOVE, bindings: { item: visitor }, audience: [near] });
    // The alcove writes its own line, which replaces the library's default.
    expect('passage' in arrives && arrives.passage.body.text.trim()).toBe('{item} squeezes in.');
    expect('passage' in arrives && arrives.passage.yields).toBe(false);
  });

  it('sends `:arrived (actor, from)` across the new place’s range, after every `:departed`', () => {
    const { visitor, outcome, sent } = walk();
    const arrived = sent('arrived');
    expect(arrived[0]).toBe(ALCOVE);
    for (const one of [HALL, TOM, MARTA]) expect(arrived, one).toContain(one);
    for (const one of [SAM, visitor]) expect(arrived, one).not.toContain(one);
    expect(outcome.sends.find((send) => send.message === 'arrived')).toEqual({
      message: 'arrived',
      recipient: ALCOVE,
      actor: visitor,
      from: HALL,
    });
    const order = outcome.sends.map((send) => send.message);
    expect(order.slice(0, 3)).toEqual(['left', 'entered', 'moved']);
    expect(order.lastIndexOf('departed')).toBeLessThan(order.indexOf('arrived'));
  });

  it('tells what is out of range of both places nothing at all', () => {
    const { shut, outcome } = walk();
    for (const notice of outcome.notices) expect(notice.audience).not.toContain(shut);
    for (const send of outcome.sends) expect([SAM, shut]).not.toContain(send.recipient);
  });

  it('charges one step for each node the two walks reach, after the write', () => {
    const { draft, outcome, budget } = walk();
    const fresh = turn();
    const before = new Budget(DEFAULT_LIMITS.budgets);
    const ask = { tree: liveTree(fresh.draft), passes: walled, budget: before };
    reaches(ask, fresh.visitor, fresh.visitor, 'any');
    reaches(ask, fresh.visitor, ALCOVE, 'any');
    const after = new Budget(DEFAULT_LIMITS.budgets);
    const walk2 = { tree: liveTree(draft), passes: walled, budget: after };
    rangeOf(walk2, HALL, 'any');
    rangeOf(walk2, ALCOVE, 'any');
    // Beside finding both in range and the two walks, the move runs
    // `sprout.Actor`'s `depart`, `if (mover != self)`: one statement and
    // its three nodes. The two visitors standing only in the walked turn
    // are on neither path that `reaches` climbs.
    expect(budget.spentSteps - before.spentSteps - after.spentSteps).toBe(4);
    expect(outcome.sends.length).toBeGreaterThan(3);
  });

  it('describes the new place to the one who moved, with no words until the description is written', () => {
    const { visitor, outcome } = walk();
    expect(outcome.notices.at(-1)).toEqual({
      notice: 'described',
      place: ALCOVE,
      audience: [visitor],
    });
  });

  it('reads no notice for a place whose kind has no such passage, and still sends and describes', () => {
    const { draft, visitor } = turn();
    const { notices, sends } = moved(moveInstance(context(draft), visitor, visitor, CELLAR));
    expect(notices.map((notice) => [notice.notice, notice.place])).toEqual([
      ['leaves', HALL],
      ['described', CELLAR],
    ]);
    expect(sends.find((send) => send.message === 'arrived')!.recipient).toBe(CELLAR);
  });

  it('sends the message to the visitors of a place that writes no notice, so nobody there is told nothing', () => {
    const { draft, visitor } = turn();
    const below = visitorIn(draft, CELLAR);
    const { notices, sends } = moved(moveInstance(context(draft), visitor, visitor, CELLAR));
    // The cellar relays, so `below` is in the hall's range and reads its leave;
    // the cellar writes no `arrives`, so of the arrival it is sent the message.
    expect(
      notices.filter((notice) => notice.audience.includes(below)).map((n) => n.notice),
    ).toEqual(['leaves']);
    expect(sends).toContainEqual({
      message: 'arrived',
      recipient: below,
      actor: visitor,
      from: HALL,
    });
    // Leaving it is the same.
    const back = moved(moveInstance(context(draft), visitor, visitor, HALL));
    expect(back.sends).toContainEqual({
      message: 'departed',
      recipient: below,
      actor: visitor,
      to: HALL,
    });
  });

  it('is moved by another the same way, the mover hearing as anyone there would', () => {
    // Marta walks herself: the visitor beside her reads her leave, and
    // she is sent nothing of her own move.
    const { draft, visitor } = turn();
    const { notices, sends } = moved(moveInstance(context(draft), MARTA, MARTA, CELLAR));
    expect(notices[0]).toMatchObject({ notice: 'leaves', place: HALL, audience: [visitor] });
    const told = sends
      .filter((send) => send.message === 'departed' || send.message === 'arrived')
      .map((send) => send.recipient);
    expect(told).not.toContain(MARTA);
    // The cellar writes no `arrives`, so the visitor in its range is sent the
    // message instead of reading nothing; of the leave it read the words.
    expect(sends).toContainEqual({
      message: 'arrived',
      recipient: visitor,
      actor: MARTA,
      from: HALL,
    });
    expect(
      sends.filter((send) => send.message === 'departed').map((send) => send.recipient),
    ).not.toContain(visitor);
  });
});

describe('what one place says of an actor, alone', () => {
  const range = (draft: Draft) => ({
    tree: liveTree(draft),
    passes: passing(CLOSET, CHEST),
    budget: new Budget(DEFAULT_LIMITS.budgets),
  });

  it('is, entered, the place’s `arrives` to its visitors, `:arrived` to the rest, then the description', () => {
    const { draft, visitor } = turn();
    const near = visitorIn(draft, NOOK);
    const spoke = placeEntered(draft, range(draft), HALL, visitor, WORLD_ID);
    expect(spoke.notices.map((notice) => notice.notice)).toEqual(['arrives', 'described']);
    expect(spoke.notices[0]).toMatchObject({ place: HALL, audience: [near] });
    expect(spoke.notices[1]).toEqual({ notice: 'described', place: HALL, audience: [visitor] });
    expect(spoke.sends[0]).toEqual({
      message: 'arrived',
      recipient: HALL,
      actor: visitor,
      from: WORLD_ID,
    });
    for (const send of spoke.sends) expect([visitor, near]).not.toContain(send.recipient);
  });

  it('is, left, the place’s `leaves` to its visitors and `:departed` to the rest, and no description', () => {
    const { draft, visitor } = turn();
    const near = visitorIn(draft, NOOK);
    draft.place(visitor, null);
    const spoke = placeLeft(draft, range(draft), HALL, visitor, WORLD_ID);
    expect(spoke.notices).toEqual([
      expect.objectContaining({ notice: 'leaves', place: HALL, audience: [near] }),
    ]);
    expect(spoke.sends.every((send) => send.message === 'departed')).toBe(true);
    expect(spoke.sends[0]).toEqual({
      message: 'departed',
      recipient: HALL,
      actor: visitor,
      to: WORLD_ID,
    });
  });
});
