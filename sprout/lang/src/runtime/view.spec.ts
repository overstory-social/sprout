import { describe, expect, it } from 'vitest';

import {
  actorOf,
  COIN,
  gatehouse,
  GUARD,
  HARE,
  INES,
  MARTA,
  MOLE,
  PEBBLE,
  pollingIn,
  PURSE,
  SENTRY,
  TOWER,
  YARD,
} from '../fixtures/view.js';
import { visitKey } from './ids.js';
import { BudgetExhausted } from './budget.js';
import { describeFor } from './describe.js';
import { offersTo } from './offers.js';
import { valueOptions } from './options.js';
import { emptyViewParts, viewOf } from './view.js';
import * as D from '../fixtures/darkness.js';

const OPEN = [[YARD, 'gate_open', true]] as const;

describe('a visitor’s view', () => {
  it('describes their place with them as the one looking', () => {
    const state = gatehouse();
    const marta = actorOf(state, MARTA);
    const view = viewOf(marta, pollingIn(state));
    expect(view.place).toBe(YARD);
    expect(view.description.of).toBe(YARD);
    expect(view.description.to).toBe(marta);
    expect(view.description.lines).toHaveLength(1);
    // A view is a poll, and its description is read as one.
    expect(view.description.lines[0]!.bindings.get('seen')).toEqual({
      binds: 'value',
      value: 'poll',
    });
    const open = gatehouse(undefined, [], OPEN);
    expect(viewOf(actorOf(open, MARTA), pollingIn(open)).description.lines).toHaveLength(2);
  });

  it('lists the exits that apply, with their labels, and only those', () => {
    const shut = gatehouse();
    expect(viewOf(actorOf(shut, MARTA), pollingIn(shut)).exits).toEqual([
      { direction: 'up', label: 'up the ladder', to: TOWER },
    ]);
    const open = gatehouse(undefined, [], OPEN);
    expect(viewOf(actorOf(open, MARTA), pollingIn(open)).exits).toEqual([
      { direction: 'north', label: 'through the gate', to: TOWER },
      { direction: 'up', label: 'up the ladder', to: TOWER },
    ]);
  });

  it('lists a link that is set, by its label and with no direction, and offers `go` by that label', () => {
    const unset = gatehouse([[MARTA, 'Marta', TOWER]]);
    const bare = viewOf(actorOf(unset, MARTA), pollingIn(unset));
    expect(bare.exits).toEqual([]);
    expect(bare.readings.some((one) => one.typed.startsWith('go '))).toBe(false);

    const state = gatehouse([[MARTA, 'Marta', TOWER]], [], [], [[TOWER, 'stair', YARD]]);
    const view = viewOf(actorOf(state, MARTA), pollingIn(state));
    expect(view.exits).toEqual([{ direction: null, label: 'down the back stair', to: YARD }]);
    const going = view.readings.filter((one) => one.reading.verb.name === 'go');
    expect(going.map((one) => one.typed)).toEqual(['go down the back stair']);
  });

  it('names every other actor in range under the pass rules, and nobody elsewhere or away', () => {
    const state = gatehouse([
      [MARTA, 'Marta', YARD],
      [INES, 'Ines', YARD],
      [visitKey('v-otto'), 'Otto', TOWER],
      [visitKey('v-away'), 'Away', null],
    ]);
    const view = viewOf(actorOf(state, MARTA), pollingIn(state));
    expect(view.occupants).toEqual([GUARD, SENTRY, actorOf(state, INES), HARE]);
  });

  it('lists someone inside an open wardrobe, and not someone inside a shut one', () => {
    const state = gatehouse();
    const view = viewOf(actorOf(state, MARTA), pollingIn(state));
    expect(view.occupants).toContain(HARE);
    expect(view.occupants).not.toContain(MOLE);
  });

  it('lists what they hold, and not what is inside it', () => {
    const state = gatehouse(undefined, [PEBBLE, PURSE]);
    const view = viewOf(actorOf(state, MARTA), pollingIn(state));
    expect(view.carried).toEqual([PEBBLE, PURSE]);
    expect(view.carried).not.toContain(COIN);
    const empty = gatehouse();
    expect(viewOf(actorOf(empty, MARTA), pollingIn(empty)).carried).toEqual([]);
  });

  it('offers every reading the parser could build, with its consent pass’s answer', () => {
    const state = gatehouse();
    const marta = actorOf(state, MARTA);
    const view = viewOf(marta, pollingIn(state));
    expect(view.readings.map((one) => one.typed)).toEqual(
      offersTo(marta, pollingIn(state)).map((one) => one.typed),
    );
    const vouched = view.readings.find((one) => one.typed === 'vouch to sentry before guard for …');
    expect(vouched?.refused?.by).toBe(GUARD);
    expect(view.readings.find((one) => one.typed === 'go up')?.refused).toBeNull();
  });

  it('gives each reading the options of its value roles, as its participants hear them now', () => {
    const state = gatehouse();
    const view = viewOf(actorOf(state, MARTA), pollingIn(state));
    expect(view.readings.find((one) => one.typed === 'ask guard about …')?.options).toEqual([
      { role: 'topic', takes: 'symbol', options: ['bridge', 'toll'] },
    ]);
    expect(view.readings.find((one) => one.typed === 'ask keypad about …')?.options).toEqual([
      { role: 'topic', takes: 'symbol', options: [] },
    ]);
    expect(view.readings.find((one) => one.typed === 'punch … on keypad')?.options).toEqual([
      { role: 'code', takes: 'integer', ranges: [{ min: 1, max: 12 }] },
    ]);
    expect(view.readings.find((one) => one.typed === 'look')?.options).toEqual([]);
    expect(view.readings.some((one) => one.reading.bindings.has('topic'))).toBe(false);
  });

  it('costs what describing, offering and reading options cost, asking each exit once', () => {
    const state = gatehouse(undefined, [], OPEN);
    const marta = actorOf(state, MARTA);
    const viewed = pollingIn(state);
    viewOf(marta, viewed);
    const apart = pollingIn(state);
    describeFor(YARD, marta, 'poll', apart);
    for (const offer of offersTo(marta, apart)) valueOptions(offer.reading, apart);
    expect(viewed.budget.spentSteps).toBe(apart.budget.spentSteps);
  });

  it('is the caller’s defect for an actor who is away', () => {
    const state = gatehouse([
      [MARTA, 'Marta', YARD],
      [INES, 'Ines', null],
    ]);
    expect(() => viewOf(actorOf(state, INES), pollingIn(state))).toThrow(/is away/);
  });

  it('runs out as any work does when the poll cannot afford it', () => {
    const state = gatehouse();
    expect(() => viewOf(actorOf(state, MARTA), pollingIn(state, 3))).toThrow(BudgetExhausted);
  });

  it('fills `parts` one field at a time, so a fault partway through leaves what came before it', () => {
    const state = gatehouse();
    const marta = actorOf(state, MARTA);
    const parts = emptyViewParts();
    expect(() => viewOf(marta, pollingIn(state, 15), parts)).toThrow(BudgetExhausted);
    expect(parts.exits).toEqual([{ direction: 'up', label: 'up the ladder', to: TOWER }]);
    expect(parts.occupants).toEqual([]);
    expect(parts.carried).toEqual([]);
    expect(parts.readings).toEqual([]);
  });
});

describe('a view in the dark', () => {
  it('is the world’s `dark`, nobody else, what they carry, and the ways out', () => {
    const state = D.dark(
      [
        [D.MARTA, D.CELLAR],
        [D.INES, D.CELLAR],
      ],
      [],
      [[D.MARTA, D.LAMP]],
    );
    const view = viewOf(D.personOf(state, D.MARTA), D.darkContext(state));
    expect(view.description.lines).toHaveLength(1);
    expect(view.occupants).toEqual([]);
    expect(view.carried).toEqual([D.LAMP]);
    expect(view.exits.map((exit) => exit.direction)).toEqual(['up']);
    const typed = view.readings.map((reading) => reading.typed);
    expect(typed).toContain('go up');
    expect(typed.some((line) => line.includes('coal'))).toBe(false);
    expect(typed.some((line) => line.includes('lamp'))).toBe(true);
    // Lit, Ines is there to be seen.
    const lit = D.dark(
      [
        [D.MARTA, D.CELLAR],
        [D.INES, D.CELLAR],
      ],
      [[D.LAMP, 'lit', true]],
      [[D.MARTA, D.LAMP]],
    );
    expect(viewOf(D.personOf(lit, D.MARTA), D.darkContext(lit)).occupants).toEqual([
      D.personOf(lit, D.INES),
    ]);
  });
});
