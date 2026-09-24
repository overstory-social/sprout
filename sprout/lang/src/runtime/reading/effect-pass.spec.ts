// The effect pass: the world's `nothing_happens` when nothing was said
// to the actor, what a `destroy` hands on, where the actor is, and what
// an NPC's reading says and to whom.

import { describe, expect, it } from 'vitest';

import type { InstanceId } from '../ids.js';
import { consentPass, effectPass, runReading } from '../reading.js';
import {
  acted,
  BASKET,
  BEAD,
  BUBBLE,
  CAT,
  contextOf,
  DOG,
  GLASS,
  HALL,
  lines,
  NOTHING,
  reading,
  STONE,
  turn,
  WARDROBE,
  WORLD_ID,
  YARD,
  type Turn,
} from '../../fixtures/reading.js';

describe('the effect pass', () => {
  it('answers with the world’s `nothing_happens` when nothing was said to the actor', () => {
    const one = turn(YARD, [HALL]);
    const [visitor] = one.people;
    const said = acted(
      runReading(reading(YARD, 'nod', visitor!, { target: { object: STONE } }), contextOf(one)),
    );
    expect(lines(said)).toEqual([[WORLD_ID, NOTHING]]);
    expect(said.said[0]).toMatchObject({ to: [visitor], speaker: null });
  });

  it('does not when something was', () => {
    const one = turn(YARD, [HALL]);
    const [visitor] = one.people;
    const said = acted(
      runReading(reading(YARD, 'nudge', visitor!, { target: { object: DOG } }), contextOf(one)),
    );
    expect(lines(said)).toEqual([[DOG, 'nudged']]);
    expect(said.said[0]).toMatchObject({ to: [visitor], speaker: null });
  });

  it('may run alone, having polled consent apart', () => {
    const one = turn(YARD, [HALL]);
    const [visitor] = one.people;
    const nod = reading(YARD, 'nod', visitor!, { target: { object: STONE } });
    expect(
      consentPass(nod, {
        state: one.draft,
        catalogue: one.catalogue,
        budget: one.budget,
        passes: contextOf(one).passes,
      }),
    ).toBeNull();
    expect(lines(effectPass(nod, contextOf(one)))).toEqual([[WORLD_ID, NOTHING]]);
  });

  it('hands on everything a destroy removed, sends nothing for it, and a participant destroyed does nothing more', () => {
    const one = turn(YARD, [HALL]);
    const [visitor] = one.people;
    const said = acted(
      runReading(
        reading(YARD, 'pop', visitor!, { target: { object: BUBBLE }, tool: { object: BUBBLE } }),
        contextOf(one),
      ),
    );
    // The bubble played the target, and was gone before it could play the tool.
    expect(lines(said)).toEqual([[BUBBLE, 'pop']]);
    // What it held went with it, and the queue drops everything pending on each.
    expect(said.destroyed).toEqual([BUBBLE, BEAD]);
    expect(said.sends).toEqual([]);
    expect(one.draft.instance(BEAD)).toBeUndefined();
  });

  it('runs none of a participant’s later composed plays once one of them destroyed it', () => {
    const one = turn(YARD, [HALL]);
    const [visitor] = one.people;
    const said = acted(
      runReading(reading(YARD, 'pop', visitor!, { target: { object: GLASS } }), contextOf(one)),
    );
    // `Bubble`'s play runs first and destroys the glass; `Glued`'s own, which
    // would write to it, does not run, so nothing is said of glue.
    expect(lines(said)).toEqual([[GLASS, 'pop']]);
    expect(said.destroyed).toEqual([GLASS]);
  });
});

describe('where the actor is', () => {
  const hereOf = (actor: InstanceId, one: Turn) =>
    acted(
      runReading(reading(YARD, 'nudge', actor, { target: { object: DOG } }), contextOf(one)),
    ).said[0]!.bindings.get('here');

  it('is its container, which holds actors, a place inside a place included', () => {
    const one = turn(YARD, [HALL, WARDROBE]);
    expect(hereOf(one.people[0]!, one)).toEqual({ binds: 'object', id: HALL });
    expect(hereOf(one.people[1]!, one)).toEqual({ binds: 'object', id: WARDROBE });
    expect(hereOf(CAT, one)).toEqual({ binds: 'object', id: HALL });
  });

  it('is an engine error for an actor in something that holds no actors, which nothing makes', () => {
    const one = turn(YARD, []);
    one.draft.place(CAT, BASKET);
    expect(() => hereOf(CAT, one)).toThrow(
      `\`${CAT}\` is in \`${BASKET}\`, which holds no actors.`,
    );
  });
});

describe('an NPC acting', () => {
  it('says its lines to whoever would hear its `tell`, the participants left out', () => {
    const one = turn(YARD, [HALL, HALL]);
    const [marta, ivo] = one.people;
    const said = acted(
      runReading(reading(YARD, 'nudge', CAT, { target: { object: marta! } }), contextOf(one)),
    );
    expect(said.said).toHaveLength(1);
    // The people directly in the hall, in contents order: Ivo; the dog is an
    // NPC, and reads nothing.
    expect(said.said[0]).toMatchObject({ to: [ivo], by: marta, speaker: CAT });
  });

  it('has no output where its reading said nothing, since nobody is behind it to answer', () => {
    const one = turn(YARD, [HALL]);
    const said = acted(
      runReading(reading(YARD, 'nod', CAT, { target: { object: STONE } }), contextOf(one)),
    );
    expect(said.said).toEqual([]);
  });
});
