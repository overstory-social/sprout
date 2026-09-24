import { describe, expect, it } from 'vitest';

import {
  CELLAR,
  departing,
  GULL,
  harbour,
  harbourHost,
  heldIn,
  INES,
  LOFT,
  MARTA,
  NO_CELLAR,
  QUAY,
  WORLD,
  whereIs,
} from '../fixtures/arrival.js';
import { words } from '../fixtures/reading.js';
import { departureTurn, type Departed, type DepartureTurn } from './departure.js';
import type { WorldState } from './state.js';

const GONE_AWAY = 'You leave, and take what you carry with you.';

/** The committed departure's value, or a failure naming what it was instead. */
function departed(turn: DepartureTurn): Departed & { readonly state: WorldState } {
  if (!turn.committed) throw new Error(`faulted: ${turn.fault.detail}`);
  return { ...turn.value, state: turn.state };
}

describe('a visitor going away', () => {
  it('leaves the tree, keeping where they stood for their next arrival', () => {
    const state = harbour([{ visit: MARTA, in: LOFT }]);
    const done = departed(departureTurn(state, harbourHost(), departing(MARTA)));
    expect(whereIs(done.state, MARTA)).toBeNull();
    expect(done.state.visitors.get(MARTA)!.lastPlace).toBe(LOFT);
    expect(done.from).toBe(LOFT);
    // Their state is kept for a later visit.
    expect(done.state.instances.has(done.instance)).toBe(true);
  });

  it('is told so in the engine’s words, from the world', () => {
    const state = harbour([{ visit: MARTA, in: QUAY }]);
    const done = departed(departureTurn(state, harbourHost(), departing(MARTA)));
    expect(done.told).toMatchObject({ to: [done.instance], by: WORLD, speaker: null });
    expect(words(done.told.said)).toBe(GONE_AWAY);
  });

  it('sends `:left` to the place and `:departed` across its range, with the world as `to`', () => {
    const state = harbour([{ visit: MARTA, in: QUAY }]);
    const me = state.visitors.get(MARTA)!.instance;
    const done = departed(departureTurn(state, harbourHost(), departing(MARTA)));
    expect(done.sends).toEqual([
      { message: 'left', recipient: QUAY, item: me, to: WORLD },
      { message: 'departed', recipient: QUAY, actor: me, to: WORLD },
      { message: 'departed', recipient: GULL, actor: me, to: WORLD },
      { message: 'departed', recipient: WORLD, actor: me, to: WORLD },
    ]);
    expect(heldIn(done.state, QUAY, 'departures')).toBe(1);
    expect(heldIn(done.state, GULL, 'gone')).toBe(1);
    // Nobody is sent `:moved`: a person who goes away has moved nowhere in the world.
    expect(heldIn(done.state, me, 'moves')).toBe(0);
  });

  it('is announced by the place’s `leaves` to whoever stays', () => {
    const state = harbour([
      { visit: MARTA, in: QUAY },
      { visit: INES, in: QUAY },
    ]);
    const ines = state.visitors.get(INES)!.instance;
    const done = departed(departureTurn(state, harbourHost(), departing(MARTA)));
    expect(done.notices).toEqual([
      expect.objectContaining({ notice: 'leaves', place: QUAY, audience: [ines] }),
    ]);
    // As effects: the words to the one leaving, then the place's to whoever stays.
    const turn = departureTurn(state, harbourHost(), departing(MARTA));
    if (!turn.committed) throw new Error('faulted');
    expect(turn.effects.map((one) => [one.kind, one.from, one.visit, one.paragraphs])).toEqual([
      ['notice', WORLD, MARTA, [GONE_AWAY]],
      ['notice', QUAY, INES, ['Marta leaves.']],
    ]);
    expect(turn.effects.every((one) => one.actor === done.instance)).toBe(true);
  });

  it('from a place that is gone sends nothing and still goes', () => {
    const state = harbour([{ visit: MARTA, in: CELLAR }], [], NO_CELLAR);
    const done = departed(departureTurn(state, harbourHost(NO_CELLAR), departing(MARTA)));
    expect(done.sends).toEqual([]);
    expect(done.drained).toBeNull();
    expect(whereIs(done.state, MARTA)).toBeNull();
    expect(done.state.visitors.get(MARTA)!.lastPlace).toBe(CELLAR);
    expect(words(done.told.said)).toBe(GONE_AWAY);
  });

  it('that faults goes away all the same, quietly, and is still told', () => {
    const state = harbour([{ visit: MARTA, in: QUAY }], [[QUAY, 'boom', true]]);
    const turn = departureTurn(state, harbourHost(), departing(MARTA));
    if (turn.committed) throw new Error('not faulted');
    expect(turn.fault.name).toBe('IntegerOverflow');
    const { quietly } = turn;
    expect(whereIs(quietly.state, MARTA)).toBeNull();
    expect(quietly.value.sends).toEqual([]);
    expect(quietly.value.drained).toBeNull();
    expect(heldIn(quietly.state, QUAY, 'departures')).toBe(0);
    expect(words(quietly.value.told.said)).toBe(GONE_AWAY);
    expect(quietly.effects.map((one) => [one.kind, one.visit, one.paragraphs])).toEqual([
      ['notice', MARTA, [GONE_AWAY]],
    ]);
  });
});

describe('what the host must not hand over', () => {
  it('is a visit the world has never seen, or one already away', () => {
    expect(() => departureTurn(harbour(), harbourHost(), departing(MARTA))).toThrow(
      /never visited/,
    );
    const away = harbour([{ visit: MARTA, away: QUAY }]);
    expect(() => departureTurn(away, harbourHost(), departing(MARTA))).toThrow(/not in this world/);
  });
});
