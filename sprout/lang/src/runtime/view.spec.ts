import { describe, expect, it } from 'vitest';

import {
  actorOf,
  COIN,
  gatehouse,
  GUARD,
  INES,
  MARTA,
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
import { viewOf } from './view.js';

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

  it('names every other actor standing there, in contents order, and nobody elsewhere or away', () => {
    const state = gatehouse([
      [MARTA, 'Marta', YARD],
      [INES, 'Ines', YARD],
      [visitKey('v-otto'), 'Otto', TOWER],
      [visitKey('v-away'), 'Away', null],
    ]);
    const view = viewOf(actorOf(state, MARTA), pollingIn(state));
    expect(view.occupants).toEqual([GUARD, SENTRY, actorOf(state, INES)]);
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
    describeFor(YARD, marta, apart);
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
});
