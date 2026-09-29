// A carried role as the consent pass asks it: before any `permit`, a
// thing a carried role holds that the actor does not carry is refused in
// the world's `not_carrying`, for a person and an NPC alike, and a thing
// carried in an open pouch passes it; what a thing's own guard then says,
// `sprout.RequiresHeld` among them, is the thing's.

import { describe, expect, it } from 'vitest';

import { BENCH, BOOK, BRASS_KEY, CAT, CHEST, POUCH, SHELF, bench } from '../../fixtures/bench.js';
import { acted, contextOf, lines, reading, refused, words } from '../../fixtures/reading.js';
import type { InstanceId } from '../ids.js';
import { consentPass, runReading } from '../reading.js';

const NOT_CARRYING = "sprout.World not_carrying: You aren't carrying {thing}.";
const NEEDS_HELD = "sprout.RequiresHeld needs_held: You'll need {self} in your hand.";

/** `unlock chest with <tool>`, by `actor`. */
const unlock = (actor: InstanceId, tool: InstanceId) =>
  reading(BENCH, 'unlock', actor, { target: { object: CHEST }, tool: { object: tool } }, 'sprout');

describe('a carried role, in the consent pass', () => {
  it('refuses what the actor does not carry in the world’s `not_carrying`, given the thing, before any permit', () => {
    const one = bench();
    const marta = one.people[0]!;
    const refusal = refused(runReading(unlock(marta, BRASS_KEY), contextOf(one)));
    expect(words(refusal.said)).toBe(NOT_CARRYING);
    expect(refusal).toMatchObject({ by: one.draft.world, role: 'tool', origin: null });
    expect([...refusal.bindings]).toEqual([
      ['actor', { binds: 'object', id: marta }],
      ['here', { binds: 'object', id: one.draft.instance(marta)!.container }],
      ['thing', { binds: 'object', id: BRASS_KEY }],
    ]);
  });

  it('lets a thing in the hand through to the participants’ permits', () => {
    const one = bench([[BRASS_KEY, null]]);
    const said = acted(runReading(unlock(one.people[0]!, BRASS_KEY), contextOf(one)));
    expect(lines(said).map(([, line]) => line)).toContain(
      'sprout.Lockable unlocked: The lock turns over.',
    );
  });

  it('lets a thing in an open pouch through, where the thing’s own guard may still want it in hand', () => {
    const one = bench([
      [POUCH, null],
      [BRASS_KEY, POUCH],
      [BOOK, POUCH],
    ]);
    const marta = one.people[0]!;
    const key = refused(runReading(unlock(marta, BRASS_KEY), contextOf(one)));
    expect(words(key.said)).toBe(NEEDS_HELD);
    expect(key).toMatchObject({ by: BRASS_KEY, role: 'tool', origin: 'sprout.RequiresHeld' });
    const prop = reading(BENCH, 'prop', marta, {
      target: { object: SHELF },
      tool: { object: BOOK },
    });
    expect(lines(acted(runReading(prop, contextOf(one))))).toEqual([
      [SHELF, 'The shelf stays put.'],
    ]);
  });

  it('holds an NPC’s `act` to the same rule, in the same words', () => {
    const one = bench();
    expect(words(refused(runReading(unlock(CAT, BRASS_KEY), contextOf(one))).said)).toBe(
      NOT_CARRYING,
    );
    one.draft.place(BRASS_KEY, CAT);
    expect(consentPass(unlock(CAT, BRASS_KEY), { ...contextOf(one), state: one.draft })).toBeNull();
  });

  it('asks nothing of a role that is not carried: `put`’s container stands on the floor', () => {
    const one = bench([[BOOK, null]]);
    const marta = one.people[0]!;
    const put = reading(
      BENCH,
      'put',
      marta,
      { item: { object: BOOK }, container: { object: POUCH } },
      'sprout',
    );
    expect(consentPass(put, { ...contextOf(one), state: one.draft })).toBeNull();
  });
});
