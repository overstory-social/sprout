import { describe, expect, it } from 'vitest';

import {
  arriving,
  CATALOGUE,
  CELLAR,
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
import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { words } from '../fixtures/reading.js';
import {
  arrivalTurn,
  closedByBundle,
  closedIn,
  displacedLine,
  ENTRY_FAILED,
  NOT_ADMITTING,
  type Admitted,
  type ArrivalTurn,
} from './arrival.js';
import type { Catalogue } from './catalogue.js';
import { commandTurn } from './command.js';
import { Draft } from './draft.js';
import type { InstanceId } from './ids.js';
import { readerOf, type WorldState } from './state.js';

const DISPLACED = 'sprout.World displaced: The place you were standing is gone.';

/** The committed arrival's value, or a failure naming what it was instead. */
function admitted(turn: ArrivalTurn): Admitted & { readonly state: WorldState } {
  if (!turn.committed) throw new Error(`not admitted: ${JSON.stringify(turn)}`);
  return { ...turn.value, state: turn.state };
}

/** `state` with each of `ids` destroyed. */
function destroyed(state: WorldState, ...ids: InstanceId[]): WorldState {
  const draft = new Draft(state);
  for (const id of ids) draft.remove(id);
  return draft.commit().state;
}

describe('a new visitor', () => {
  it('is made of the visitor kind and stands at the arrival place, under their nickname', () => {
    const done = admitted(arrivalTurn(harbour(), harbourHost(), arriving(MARTA)));
    expect(done.returning).toBe(false);
    expect(done.displaced).toBeNull();
    expect(whereIs(done.state, MARTA)).toBe(QUAY);
    const record = done.state.visitors.get(MARTA)!;
    expect(record).toEqual({
      visit: MARTA,
      nickname: 'Marta',
      instance: done.instance,
      lastPlace: QUAY,
    });
    expect(done.state.instances.get(done.instance)!.kind).toBe(CATALOGUE.visitorKind);
  });

  it('enters as a move from outside the tree: `:entered`, `:moved`, then `:arrived` across the place’s range', () => {
    const done = admitted(arrivalTurn(harbour(), harbourHost(), arriving(MARTA)));
    const me = done.instance;
    expect(done.entered.sends).toEqual([
      { message: 'entered', recipient: QUAY, item: me, from: WORLD },
      { message: 'moved', recipient: me, from: WORLD, to: QUAY },
      // The rest of the place's range, as any move between places sends it, nearest first.
      { message: 'arrived', recipient: QUAY, actor: me, from: WORLD },
      { message: 'arrived', recipient: GULL, actor: me, from: WORLD },
      { message: 'arrived', recipient: WORLD, actor: me, from: WORLD },
    ]);
    expect(heldIn(done.state, QUAY, 'arrivals')).toBe(1);
    expect(heldIn(done.state, GULL, 'seen')).toBe(1);
    expect(heldIn(done.state, me, 'moves')).toBe(1);
  });

  it('is announced to whoever is there by the place’s `arrives`, and reads the place’s description', () => {
    const state = harbour([{ visit: INES, in: QUAY }]);
    const ines = state.visitors.get(INES)!.instance;
    const done = admitted(arrivalTurn(state, harbourHost(), arriving(MARTA)));
    expect(done.entered.notices).toEqual([
      expect.objectContaining({
        notice: 'arrives',
        place: QUAY,
        audience: [ines],
        bindings: { item: done.instance },
      }),
      { notice: 'described', place: QUAY, audience: [done.instance] },
    ]);
    // As effects: the place's words to whoever is there, then the place to the one who came in.
    const turn = arrivalTurn(state, harbourHost(), arriving(MARTA));
    if (!turn.committed) throw new Error('not admitted');
    expect(turn.effects.map((one) => [one.kind, one.from, one.visit, one.actor])).toEqual([
      ['notice', QUAY, INES, done.instance],
      ['described', QUAY, MARTA, done.instance],
    ]);
    expect(turn.effects[0]!.paragraphs).toEqual(['Marta arrives.']);
  });

  it('is refused by the arrival place’s `accept` in its words, and nothing is written', () => {
    const state = harbour([], [[QUAY, 'closed', true]]);
    const turn = arrivalTurn(state, harbourHost(), arriving(MARTA));
    if (turn.committed || !('refused' in turn)) throw new Error('not refused');
    expect(words(turn.refused.said)).toBe('The quay is closed for the tide.');
    expect(turn.refused.to).toHaveLength(1);
    // The words are rendered against a world that holds the visitor, standing nowhere.
    const reader = turn.refused.to[0]!;
    expect(turn.seen.instances.get(reader)!.container).toBeNull();
    expect(turn.seen.visitors.get(MARTA)!.nickname).toBe('Marta');
    expect(state.visitors.has(MARTA)).toBe(false);
    expect(turn.effects).toEqual([
      {
        kind: 'refused',
        from: QUAY,
        actor: reader,
        to: reader,
        visit: MARTA,
        paragraphs: ['The quay is closed for the tide.'],
      },
    ]);
  });

  it('whose arrival faults is not admitted, told in the host’s words, and the world is as it was', () => {
    const state = harbour([], [[QUAY, 'boom', true]]);
    const turn = arrivalTurn(state, harbourHost(), arriving(MARTA));
    if (turn.committed || !('fault' in turn)) throw new Error('not faulted');
    expect(turn.fault.name).toBe('IntegerOverflow');
    expect(turn.words).toBe(ENTRY_FAILED);
  });
});

describe('a returning visitor', () => {
  it('comes back where they last stood, if it still exists and accepts them', () => {
    const state = harbour([{ visit: MARTA, away: LOFT }]);
    const done = admitted(arrivalTurn(state, harbourHost(), arriving(MARTA)));
    expect(done.returning).toBe(true);
    expect(done.instance).toBe(state.visitors.get(MARTA)!.instance);
    expect(whereIs(done.state, MARTA)).toBe(LOFT);
    expect(done.displaced).toBeNull();
    expect(heldIn(done.state, QUAY, 'arrivals')).toBe(0);
  });

  it('keeps the nickname they come back with', () => {
    const state = harbour([{ visit: MARTA, away: LOFT }]);
    const done = admitted(arrivalTurn(state, harbourHost(), arriving(MARTA, 'Mar')));
    expect(done.state.visitors.get(MARTA)!.nickname).toBe('Mar');
  });

  it('whose last place refuses them arrives where visitors arrive, and is not told it is gone', () => {
    const state = harbour([{ visit: MARTA, away: LOFT }], [[LOFT, 'shut', true]]);
    const done = admitted(arrivalTurn(state, harbourHost(), arriving(MARTA)));
    expect(whereIs(done.state, MARTA)).toBe(QUAY);
    expect(done.displaced).toBeNull();
    expect(done.state.visitors.get(MARTA)!.lastPlace).toBe(QUAY);
  });

  it('whose last place was destroyed is told through `displaced` and arrives at the arrival place', () => {
    const state = destroyed(harbour([{ visit: MARTA, away: LOFT }]), LOFT);
    const done = admitted(arrivalTurn(state, harbourHost(), arriving(MARTA)));
    expect(whereIs(done.state, MARTA)).toBe(QUAY);
    expect(words(done.displaced!.said)).toBe(DISPLACED);
    expect(done.displaced!.to).toEqual([done.instance]);
    expect(done.displaced!.bindings.size).toBe(0);
    const turn = arrivalTurn(state, harbourHost(), arriving(MARTA));
    if (!turn.committed) throw new Error('not admitted');
    expect(turn.effects.map((one) => [one.kind, one.from, one.visit])).toEqual([
      ['notice', WORLD, MARTA],
      ['described', QUAY, MARTA],
    ]);
  });

  it('whose last place is absent is displaced the same way', () => {
    const state = harbour([{ visit: MARTA, away: CELLAR }], [], NO_CELLAR);
    const done = admitted(arrivalTurn(state, harbourHost(NO_CELLAR), arriving(MARTA)));
    expect(whereIs(done.state, MARTA)).toBe(QUAY);
    expect(words(done.displaced!.said)).toBe(DISPLACED);
  });
});

describe('a world that admits no one', () => {
  const closed = (catalogue: Catalogue) => closedByBundle(catalogue);

  it('is one with no world, no visitor kind or no arrival place in source', () => {
    expect(closed(CATALOGUE)).toBeNull();
    expect(closed({ ...CATALOGUE, worldKind: null })).toBe('no-world');
    expect(closed({ ...CATALOGUE, visitorKind: null })).toBe('no-visitor-kind');
    expect(closed({ ...CATALOGUE, arrival: null })).toBe('no-arrival-place');
  });

  it('is one whose arrival place is destroyed, as one absent is', () => {
    const state = destroyed(harbour(), QUAY);
    expect(closedIn(readerOf(state), CATALOGUE)).toBe('arrival-place-gone');
    const turn = arrivalTurn(state, harbourHost(), arriving(MARTA));
    expect(turn).toEqual({
      committed: false,
      closed: { reason: 'arrival-place-gone', words: NOT_ADMITTING },
    });
  });

  it('turns a returning visitor away too, even one whose own last place stands', () => {
    const state = destroyed(harbour([{ visit: MARTA, away: LOFT }]), QUAY);
    const turn = arrivalTurn(state, harbourHost(), arriving(MARTA));
    expect('closed' in turn && turn.closed.words).toBe(NOT_ADMITTING);
  });
});

describe('what the host must not hand over', () => {
  it('is a visitor already standing in the world', () => {
    const state = harbour([{ visit: MARTA, in: QUAY }]);
    expect(() => arrivalTurn(state, harbourHost(), arriving(MARTA))).toThrow(
      /already in this world/,
    );
  });

  it('is a nickname the host could not have admitted: empty, a word of the world, or one someone present holds', () => {
    expect(() => arrivalTurn(harbour(), harbourHost(), arriving(MARTA, '  '))).toThrow(
      /did not admit: Choose a nickname/,
    );
    expect(() => arrivalTurn(harbour(), harbourHost(), arriving(MARTA, 'Gull Marta'))).toThrow(
      /did not admit: "gull" is a word this world already reads/,
    );
    const state = harbour([{ visit: INES, in: QUAY }]);
    expect(() => arrivalTurn(state, harbourHost(), arriving(MARTA, 'INES'))).toThrow(
      /did not admit: Someone here is already called "INES"/,
    );
  });

  it('keeps the nickname admitted as its words, single-spaced', () => {
    const done = admitted(arrivalTurn(harbour(), harbourHost(), arriving(MARTA, '  Marta \t  B ')));
    expect(done.state.visitors.get(MARTA)!.nickname).toBe('Marta B');
  });

  it('allows a nickname held only by someone away, since reservations are soft', () => {
    const state = harbour([{ visit: INES, away: QUAY }]);
    const done = admitted(arrivalTurn(state, harbourHost(), arriving(MARTA, 'Ines')));
    expect(done.state.visitors.get(MARTA)!.nickname).toBe('Ines');
  });
});

describe('a visitor whose place is gone, on their next turn', () => {
  it('is moved to the arrival place and told through `displaced`, what they typed unread', () => {
    const state = harbour([{ visit: MARTA, in: CELLAR }], [], NO_CELLAR);
    const turn = commandTurn(state, harbourHost(NO_CELLAR), { ...arriving(MARTA), text: 'look' });
    if (!turn.committed || !('displaced' in turn.value)) throw new Error('not displaced');
    const { displaced } = turn.value;
    expect(words(displaced.told.said)).toBe(DISPLACED);
    expect('place' in displaced.entry && displaced.entry.place).toBe(QUAY);
    expect(whereIs(turn.state, MARTA)).toBe(QUAY);
    expect(turn.state.visitors.get(MARTA)!.lastPlace).toBe(QUAY);
    expect(heldIn(turn.state, QUAY, 'arrivals')).toBe(1);
    expect(displaced.drained).not.toBeNull();
    // Told first, then reading the place they came in to.
    expect(turn.effects.map((one) => [one.kind, one.from, one.visit])).toEqual([
      ['notice', WORLD, MARTA],
      ['described', QUAY, MARTA],
    ]);
  });

  it('is displaced the same way from something that no longer holds actors', () => {
    const state = harbour([{ visit: MARTA, in: GULL }]);
    const turn = commandTurn(state, harbourHost(), { ...arriving(MARTA), text: 'look' });
    if (!turn.committed || !('displaced' in turn.value)) throw new Error('not displaced');
    expect(whereIs(turn.state, MARTA)).toBe(QUAY);
  });

  it('is told, and stays, where the arrival place refuses them', () => {
    const state = harbour([{ visit: MARTA, in: CELLAR }], [[QUAY, 'closed', true]], NO_CELLAR);
    const turn = commandTurn(state, harbourHost(NO_CELLAR), { ...arriving(MARTA), text: 'look' });
    if (!turn.committed || !('displaced' in turn.value)) throw new Error('not displaced');
    const { entry } = turn.value.displaced;
    expect('refused' in entry && words(entry.refused.said)).toBe(
      'The quay is closed for the tide.',
    );
    expect(whereIs(turn.state, MARTA)).toBe(CELLAR);
    expect(turn.effects.map((one) => [one.kind, one.from, one.paragraphs])).toEqual([
      ['notice', WORLD, ['The place you were standing is gone.']],
      ['refused', QUAY, ['The quay is closed for the tide.']],
    ]);
  });

  it('is told the world admits no one where the arrival place is gone too', () => {
    const state = destroyed(harbour([{ visit: MARTA, in: CELLAR }], [], NO_CELLAR), QUAY);
    const turn = commandTurn(state, harbourHost(NO_CELLAR), { ...arriving(MARTA), text: 'look' });
    if (!turn.committed || !('displaced' in turn.value)) throw new Error('not displaced');
    expect(turn.value.displaced.entry).toEqual({
      closed: { reason: 'arrival-place-gone', words: NOT_ADMITTING },
    });
    expect(turn.value.displaced.drained).toBeNull();
    // The host says the world admits no one outside it; within it, only `displaced` is told.
    expect(turn.effects.map((one) => [one.kind, one.from])).toEqual([['notice', WORLD]]);
  });
});

describe('the world’s `displaced`', () => {
  it('is said from the world to the one displaced, with nothing bound', () => {
    const state = harbour([{ visit: MARTA, in: QUAY }]);
    const marta = state.visitors.get(MARTA)!.instance;
    const line = displacedLine(readerOf(state), marta);
    expect(line).toMatchObject({ effect: 'notice', to: [marta], by: WORLD, speaker: null });
    expect(words(line.said)).toBe(DISPLACED);
    expect(line.bindings.size).toBe(0);
  });
});

describe('a place the host says is full', () => {
  const crowded = (people: number) => ({
    ...harbourHost(),
    budgets: { ...DEFAULT_LIMITS.budgets, peoplePerPlace: people },
  });
  const FULL = 'There is no room in {to} for {item}.';

  it('turns a new visitor away in the engine’s words, before its `accept` is asked, writing nothing', () => {
    // The quay is closed too, and its own refusal is not the one read.
    const state = harbour([{ visit: INES, in: QUAY }], [[QUAY, 'closed', true]]);
    const turn = arrivalTurn(state, crowded(1), arriving(MARTA));
    if (turn.committed || !('refused' in turn)) throw new Error('not refused');
    expect(turn.refused).toMatchObject({ effect: 'refused', by: WORLD, speaker: null });
    expect(words(turn.refused.said)).toBe(FULL);
    const reader = turn.refused.to[0]!;
    expect([...turn.refused.bindings.keys()]).toEqual(['item', 'to']);
    expect(turn.refused.bindings.get('item')).toMatchObject({ id: reader });
    expect(turn.refused.bindings.get('to')).toMatchObject({ id: QUAY });
    expect(state.visitors.has(MARTA)).toBe(false);
    // Told as the one effect of a refused arrival, and only to the one turned away.
    expect(turn.effects.map((one) => [one.kind, one.from, one.actor, one.visit])).toEqual([
      ['refused', WORLD, reader, MARTA],
    ]);
    expect(turn.effects[0]!.paragraphs).toEqual(['There is no room in a quay for you.']);
  });

  it('admits a visitor while there is room, an NPC taking none of it', () => {
    // The gull stands on the quay; only Ines counts.
    const state = harbour([{ visit: INES, in: QUAY }]);
    const done = admitted(arrivalTurn(state, crowded(2), arriving(MARTA)));
    expect(whereIs(done.state, MARTA)).toBe(QUAY);
  });

  it('sends a returning visitor whose last place is full to where visitors arrive', () => {
    const state = harbour([
      { visit: MARTA, away: LOFT },
      { visit: INES, in: LOFT },
    ]);
    const turn = arrivalTurn(state, crowded(1), arriving(MARTA));
    const done = admitted(turn);
    expect(whereIs(done.state, MARTA)).toBe(QUAY);
    expect(done.displaced).toBeNull();
    // Not told `displaced`, and nobody in the full loft reads anything of it.
    if (!turn.committed) throw new Error('not admitted');
    expect(turn.effects.map((one) => [one.kind, one.from, one.visit])).toEqual([
      ['described', QUAY, MARTA],
    ]);
  });
});
