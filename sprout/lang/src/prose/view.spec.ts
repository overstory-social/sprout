import { describe, expect, it } from 'vitest';

import {
  actorOf,
  gatehouse,
  gateHost,
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
import { DISPLACED_STOCK } from '../runtime/arrival.js';
import { Draft } from '../runtime/draft.js';
import { visitKey } from '../runtime/ids.js';
import { SproutList } from '../runtime/lists.js';
import { saveWorld } from '../runtime/load.js';
import { stockLine } from '../runtime/faults.js';
import { viewOf } from '../runtime/view.js';
import { pollView, renderView } from './view.js';

const OPEN = [[YARD, 'gate_open', true]] as const;

describe('polling a visitor’s view', () => {
  it('renders their place’s description for them, with no draws', () => {
    const polled = pollView(gatehouse(undefined, [], OPEN), gateHost(), MARTA);
    expect(polled.fault).toBeNull();
    expect(polled.visit).toBe(MARTA);
    expect(polled.view.description).toEqual(['A cobbled yard.', 'The gate stands open.']);
  });

  it('carries the exits that apply, who else is there and what they carry, named for them', () => {
    const state = gatehouse(
      [
        [MARTA, 'Marta', YARD],
        [INES, 'Ines', YARD],
      ],
      [PEBBLE],
    );
    const { view } = pollView(state, gateHost(), MARTA);
    expect(view.exits).toEqual([{ direction: 'up', label: 'up the ladder', to: TOWER }]);
    expect(view.occupants).toEqual([
      { id: GUARD, name: 'a guard' },
      { id: SENTRY, name: 'a sentry' },
      { id: actorOf(state, INES), name: 'Ines' },
    ]);
    expect(view.carried).toEqual([{ id: PEBBLE, name: 'a pebble' }]);
  });

  it('offers each reading with its refusal in the refusing participant’s words, and its options as typed', () => {
    const knows = gatehouse().instances.get(SENTRY)!.properties.get('knows');
    if (!(knows instanceof SproutList)) throw new Error('the sentry knows no list');
    const learnt = gatehouse(undefined, [], [[SENTRY, 'knows', knows.add('old_road')]]);
    const { view } = pollView(learnt, gateHost(), MARTA);
    const vouched = view.readings.find((one) => one.typed === 'vouch to guard before sentry for …');
    expect(vouched).toMatchObject({ verb: 'gatehouse.vouch', refused: ['Not before me.'] });
    expect(view.readings.find((one) => one.typed === 'ask sentry about …')).toEqual({
      verb: 'sprout.ask',
      typed: 'ask sentry about …',
      refused: null,
      options: [
        {
          role: 'topic',
          takes: 'symbol',
          options: [
            { value: 'bridge', words: 'bridge' },
            { value: 'toll', words: 'toll' },
            { value: 'old_road', words: 'old road' },
          ],
        },
      ],
    });
    expect(view.readings.find((one) => one.typed === 'turn dial to …')?.options).toEqual([
      { role: 'notch', takes: 'integer', ranges: [{ min: 0, max: 9 }] },
    ]);
  });

  it('is the world’s `unseen` and nothing else where it runs out, laid against the place', () => {
    const polled = pollView(gatehouse(), gateHost(20), MARTA);
    expect(polled.view).toEqual({
      description: ['Too much happens here to take in.'],
      exits: [],
      occupants: [],
      carried: [],
      readings: [],
    });
    expect(polled.fault).toMatchObject({ name: 'BudgetExhausted', object: YARD, engine: false });
    expect(polled.fault?.detail).toContain('pollSteps');
  });

  it('is `unseen` where its description is more than the one looking may read', () => {
    const host = gateHost();
    const polled = pollView(
      gatehouse(),
      { ...host, budgets: { ...host.budgets, output: 10 } },
      MARTA,
    );
    expect(polled.view.readings).toEqual([]);
    expect(polled.fault?.name).toBe('BudgetExhausted');
    expect(polled.fault?.detail).toContain('output');
  });

  it('says `unseen` in the stock words where rendering the world’s own cannot be afforded either', () => {
    const polled = pollView(gatehouse(), gateHost(0), MARTA);
    expect(polled.view.description).toEqual([stockLine('unseen')]);
    expect(polled.fault?.name).toBe('BudgetExhausted');
  });

  it('tells a visitor whose place is gone what their next command will, and offers nothing', () => {
    const base = gatehouse();
    const draft = new Draft(base);
    draft.place(actorOf(base, MARTA), PURSE);
    const polled = pollView(draft.commit().state, gateHost(), MARTA);
    expect(polled.fault).toBeNull();
    expect(polled.view.description).toEqual([DISPLACED_STOCK]);
    expect(polled.view.readings).toEqual([]);
    expect(polled.view.exits).toEqual([]);
  });

  it('writes nothing, and reads the same state the same way every time', () => {
    const state = gatehouse(undefined, [PEBBLE], OPEN);
    const before = saveWorld(state);
    const first = pollView(state, gateHost(), MARTA);
    expect(pollView(state, gateHost(), MARTA)).toEqual(first);
    expect(saveWorld(state)).toEqual(before);
  });

  it('is the host’s defect for a visitor who is away or never came', () => {
    const state = gatehouse([
      [MARTA, 'Marta', YARD],
      [INES, 'Ines', null],
    ]);
    expect(() => pollView(state, gateHost(), INES)).toThrow(/not in this world/);
    expect(() => pollView(state, gateHost(), visitKey('v-nobody'))).toThrow(/never visited/);
  });
});

describe('rendering a view', () => {
  it('names each occupant and each thing carried as its reader reads it', () => {
    const state = gatehouse(
      [
        [MARTA, 'Marta', YARD],
        [INES, 'Ines', YARD],
      ],
      [PURSE],
    );
    const ines = actorOf(state, INES);
    const context = { ...pollingIn(state), draws: null, actor: ines };
    const seen = renderView(viewOf(ines, context), context);
    expect(seen.occupants.map((one) => one.name)).toEqual(['a guard', 'a sentry', 'Marta']);
    expect(seen.carried).toEqual([]);
  });
});
