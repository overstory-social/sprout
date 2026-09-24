import { describe, expect, it } from 'vitest';

import { arrivalTurn, visitKey, type Effect } from '@overstory/sprout/lang';

import { HALL, seeded, tally } from '../fixtures/tally.js';
import { committedState } from '../turns.js';
import { ArrivalEntry, arrivalEntry, arrivalOf, type RanArrival } from './arrival.js';

const { host } = tally();
const INES = visitKey('v-ines');
const arrival = { visit: INES, nickname: 'Ines', now: 40, seed: 9, mayHold: 30 };
const fault = { name: 'MoveFault', detail: 'no', object: HALL, engine: false };

describe('a visitor’s entry in the log', () => {
  it('keeps the visit, the nickname they came with, its inputs and what it said', async () => {
    const state = await committedState(await seeded(host), 'w', host);
    const turn = arrivalTurn(state, host, arrival);
    if (!turn.committed) throw new Error('Ines was not admitted');
    const entry = arrivalEntry(arrival, host, turn);
    expect(entry).toMatchObject({
      kind: 'arrival',
      visit: INES,
      nickname: 'Ines',
      now: 40,
      seed: 9,
      mayHold: 30,
      outcome: 'admitted',
      fault: null,
    });
    expect(entry.effects.map((e) => [e.kind, e.visit])).toContainEqual(['described', INES]);
    expect(ArrivalEntry.parse(JSON.parse(JSON.stringify(entry)))).toEqual(entry);
    expect(arrivalOf(entry)).toEqual(arrival);
  });

  it('keeps a refusal and the words it said', () => {
    const said: Effect = {
      kind: 'refused',
      from: HALL,
      actor: null,
      to: HALL,
      visit: INES,
      paragraphs: ['Not you.'],
    };
    const refused = {
      committed: false,
      refused: {},
      seen: {},
      effects: [said],
    } as unknown as RanArrival;
    expect(arrivalEntry(arrival, host, refused)).toMatchObject({
      outcome: 'refused',
      fault: null,
      effects: [{ kind: 'refused', paragraphs: ['Not you.'] }],
    });
  });

  it('keeps a fault, and nothing said in the world', () => {
    const faulted: RanArrival = { committed: false, fault, words: 'Something went wrong.' };
    expect(arrivalEntry(arrival, host, faulted)).toMatchObject({
      outcome: 'faulted',
      fault,
      effects: [],
    });
  });
});
