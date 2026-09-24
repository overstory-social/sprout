import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { compiledWorld } from '../fixtures/bundle.js';
import { renderEffects } from '../prose/effects.js';
import { catalogueOf } from './catalogue.js';
import { Draft } from './draft.js';
import { declaredId, visitKey, type InstanceId, type VisitKey } from './ids.js';
import { initialState, saveWorld } from './load.js';
import { newInstance, type WorldState } from './state.js';
import { occupiedPlaces, tickTurn, type Tick, type TickTurn } from './tick.js';
import type { TurnHost } from './turn.js';

// A moor that counts its ticks and gusts once more than thirty seconds
// have passed, telling whoever stands on it and its flag; a flag whose own `:tick` handler the
// tick never reaches; a hut on the moor, a place of its own; a cellar
// that does nothing on a tick; a kennel
// holding only a dog. The moor keeps its last gap, which holds at most
// 1,000 seconds, so a tick after a longer one faults.
const WEATHER = compiledWorld('weather', {
  'world.sprout': `world weather is sprout.World {
  visitors are Person
  visitors arrive at moor

  object moor is Moor {
    object flag is Flag
    object hut is sprout.Place { }
  }
  object cellar is sprout.Place { }
  object kennel is sprout.Place {
    object dog is Dog
  }
}

message :gust
`,
  'person.sprout': 'kind Person is sprout.Visitor { }\n',
  'dog.sprout': 'kind Dog is sprout.Actor { }\n',
  'moor.sprout': `kind Moor is sprout.Place {
  :ticks 0 min 0 max 99
  :since_gust 0 min 0 max 1000
  :gap 0 min 0 max 1000
  on :tick (elapsed) {
    self.set(:gap, elapsed)
    self.adjust(:ticks, 1)
    self.adjust(:since_gust, elapsed)
    if (self.get(:since_gust) > 30) {
      self.set(:since_gust, 0)
      tell "The wind picks up in the eaves."
      broadcast :gust
    }
  }
}
`,
  'flag.sprout': `kind Flag {
  :flaps 0 min 0 max 99
  on :gust { self.adjust(:flaps, 1) }
  on :tick { self.adjust(:flaps, 50) }
}
`,
});

const CATALOGUE = catalogueOf(WEATHER, DEFAULT_LIMITS.caps);
const HOST: TurnHost = {
  catalogue: CATALOGUE,
  budgets: DEFAULT_LIMITS.budgets,
  render: renderEffects,
};
const at = (...path: string[]): InstanceId => declaredId('weather', path);
const MOOR = at('moor');
const FLAG = at('moor', 'flag');
const HUT = at('moor', 'hut');
const CELLAR = at('cellar');
const KENNEL = at('kennel');
const MARTA = visitKey('v-marta');
const INES = visitKey('v-ines');
const OLGA = visitKey('v-olga');

/** The weather with each visit standing where it says, or away where it says null. */
function weather(standing: readonly (readonly [VisitKey, InstanceId | null])[]): WorldState {
  const draft = new Draft(initialState(CATALOGUE));
  for (const [visit, where] of standing) {
    const id = draft.mint();
    const arrival = where === null ? null : draft.nextSerial();
    draft.add(
      newInstance(id, { from: 'visitor' }, CATALOGUE.visitorKind!, where, arrival, CATALOGUE.caps),
    );
    draft.putVisitor({ visit, nickname: visit, instance: id, lastPlace: where });
  }
  return draft.commit().state;
}

const tick = (place: InstanceId, now: number): Tick => ({ place, now, seed: 5, mayHold: null });

function committed(turn: TickTurn) {
  if (!turn.committed) throw new Error(`not committed: ${JSON.stringify(turn)}`);
  return turn;
}

const held = (state: WorldState, id: InstanceId, name: string) =>
  state.instances.get(id)?.properties.get(name);

describe('the places the host ticks', () => {
  it('are the places visitors stand in, once each, and no place only an NPC or an away visitor keeps', () => {
    const state = weather([
      [MARTA, MOOR],
      [INES, MOOR],
      [OLGA, CELLAR],
      [visitKey('v-away'), null],
    ]);
    expect(occupiedPlaces(state)).toEqual([CELLAR, MOOR].sort());
    expect(occupiedPlaces(state)).not.toContain(KENNEL);
    expect(occupiedPlaces(weather([]))).toEqual([]);
  });

  it('leave out a visitor who stands in something that is not a place, until their turn displaces them', () => {
    expect(occupiedPlaces(weather([[MARTA, FLAG]]))).toEqual([]);
  });

  it('are the nearest place a visitor stands in, and not the place around it', () => {
    expect(occupiedPlaces(weather([[MARTA, HUT]]))).toEqual([HUT]);
  });
});

describe('a tick turn', () => {
  it('sends the place `:tick`, hands it no time on its first, and records when it ran', () => {
    const turn = committed(tickTurn(weather([[MARTA, MOOR]]), HOST, tick(MOOR, 1000)));
    expect(turn.value.elapsed).toBe(0);
    expect(held(turn.state, MOOR, 'ticks')).toBe(1);
    expect(turn.state.instances.get(MOOR)?.lastTick).toBe(1000);
    expect(turn.changes.upsert.find((record) => record.id === MOOR)?.lastTick).toBe(1000);
    expect(turn.stale).toEqual([MARTA]);
  });

  it('hands `elapsed` the seconds since the last tick the place received, however many were skipped', () => {
    let state = committed(tickTurn(weather([[MARTA, MOOR]]), HOST, tick(MOOR, 1000))).state;
    const second = committed(tickTurn(state, HOST, tick(MOOR, 1012)));
    expect(second.value.elapsed).toBe(12);
    expect(held(second.state, MOOR, 'since_gust')).toBe(12);
    // Whatever ticks the host did not run between 1012 and 1070 fold into this one.
    state = second.state;
    const third = committed(tickTurn(state, HOST, tick(MOOR, 1070)));
    expect(third.value.elapsed).toBe(58);
    expect(held(third.state, MOOR, 'ticks')).toBe(3);
  });

  it('reaches the place and no further: what else hears of it is what the place sends', () => {
    const first = committed(tickTurn(weather([[MARTA, MOOR]]), HOST, tick(MOOR, 0)));
    const calm = committed(tickTurn(first.state, HOST, tick(MOOR, 20)));
    // The flag's own `:tick` handler never runs, and nothing gusts yet.
    expect(held(calm.state, FLAG, 'flaps')).toBe(0);
    expect(calm.value.drained.events).toBe(1);
    const gusty = committed(tickTurn(calm.state, HOST, tick(MOOR, 40)));
    expect(held(gusty.state, MOOR, 'since_gust')).toBe(0);
    expect(held(gusty.state, FLAG, 'flaps')).toBe(1);
    // The tick is one event and the gust it broadcast another.
    expect(gusty.value.drained.events).toBe(2);
  });

  it('tells the place’s occupants what its handler tells, and nobody in the hut on it', () => {
    const state = weather([
      [MARTA, MOOR],
      [INES, HUT],
    ]);
    const marta = [...state.visitors.values()].find((one) => one.visit === MARTA)!.instance;
    const first = committed(tickTurn(state, HOST, tick(MOOR, 0)));
    expect(first.value.drained.said).toEqual([]);
    const gusty = committed(tickTurn(first.state, HOST, tick(MOOR, 40)));
    expect(
      gusty.value.drained.said.map((said) => [said.effect, said.by, said.to, said.speaker]),
    ).toEqual([['told', MOOR, [marta], null]]);
    // Rendered as the tick's one effect, which nobody acted to cause.
    expect(first.effects).toEqual([]);
    expect(gusty.effects).toEqual([
      {
        kind: 'told',
        from: MOOR,
        actor: null,
        to: marta,
        visit: MARTA,
        paragraphs: ['The wind picks up in the eaves.'],
      },
    ]);
  });

  it('commits a tick to a place with no `:tick` handler, which does nothing but record it', () => {
    const turn = committed(tickTurn(weather([[OLGA, CELLAR]]), HOST, tick(CELLAR, 77)));
    expect(turn.value.drained.events).toBe(0);
    expect(turn.state.instances.get(CELLAR)?.lastTick).toBe(77);
    expect(turn.value.drained.said).toEqual([]);
  });

  it('is dropped when it faults: nothing is kept, nobody is told, and the next tick covers the gap', () => {
    const first = committed(tickTurn(weather([[MARTA, MOOR]]), HOST, tick(MOOR, 100)));
    const before = saveWorld(first.state);
    const dropped = tickTurn(first.state, HOST, tick(MOOR, 5100));
    expect(dropped).toEqual({
      committed: false,
      fault: expect.objectContaining({ name: 'ValueOutOfRange', engine: false }),
    });
    expect(saveWorld(first.state)).toEqual(before);
    expect(first.state.instances.get(MOOR)?.lastTick).toBe(100);
    // The place received no tick at 5100, so the next one's `elapsed` runs from 100.
    const next = tickTurn(first.state, HOST, tick(MOOR, 5160));
    expect(next).toMatchObject({ committed: false, fault: { name: 'ValueOutOfRange' } });
    const small = committed(tickTurn(first.state, HOST, tick(MOOR, 130)));
    expect(small.value.elapsed).toBe(30);
  });

  it('does not run for a place nobody stands in by the time it opens', () => {
    const state = weather([[MARTA, MOOR]]);
    expect(tickTurn(state, HOST, tick(CELLAR, 5))).toEqual({ committed: false, unoccupied: true });
    expect(tickTurn(state, HOST, tick(KENNEL, 5))).toEqual({ committed: false, unoccupied: true });
    expect(state.instances.get(CELLAR)?.lastTick).toBeNull();
  });

  it('is the host’s defect for what is not a place, and for time before the place’s last tick', () => {
    const first = committed(tickTurn(weather([[MARTA, MOOR]]), HOST, tick(MOOR, 100)));
    expect(() => tickTurn(first.state, HOST, tick(FLAG, 200))).toThrow('not a place');
    expect(() => tickTurn(first.state, HOST, tick(at('nowhere'), 200))).toThrow(
      'not in this world',
    );
    expect(() => tickTurn(first.state, HOST, tick(MOOR, 99))).toThrow('does not run backwards');
    expect(() => tickTurn(first.state, HOST, tick(MOOR, 100.5))).toThrow('whole seconds');
  });

  it('runs under the tick’s own budget, and a tick that spends it is dropped', () => {
    const first = committed(tickTurn(weather([[MARTA, MOOR]]), HOST, tick(MOOR, 0)));
    const starved: TurnHost = { ...HOST, budgets: { ...DEFAULT_LIMITS.budgets, steps: 3 } };
    expect(tickTurn(first.state, starved, tick(MOOR, 10))).toMatchObject({
      committed: false,
      fault: { name: 'BudgetExhausted' },
    });
  });
});
