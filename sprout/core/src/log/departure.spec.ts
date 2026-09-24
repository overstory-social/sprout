import { describe, expect, it } from 'vitest';

import { departureTurn, type DepartureTurn } from '@overstory/sprout/lang';

import { HALL, MARTA, seeded, tally } from '../fixtures/tally.js';
import { committedState } from '../turns.js';
import { DepartureEntry, departureEntry, departureOf } from './departure.js';

const { host } = tally();
const departure = { visit: MARTA, now: 70, seed: 3, mayHold: null };

async function departed(): Promise<Extract<DepartureTurn, { committed: true }>> {
  const state = await committedState(await seeded(host), 'w', host);
  const turn = departureTurn(state, host, departure);
  if (!turn.committed) throw new Error('Marta did not leave');
  return turn;
}

describe('a visitor’s exit in the log', () => {
  it('keeps the visit, its inputs and what it said, the engine’s words to the one who left among it', async () => {
    const entry = departureEntry(departure, host, await departed());
    expect(entry).toMatchObject({ kind: 'departure', visit: MARTA, now: 70, seed: 3, fault: null });
    expect(entry.effects.map((e) => e.visit)).toContain(MARTA);
    expect(DepartureEntry.parse(JSON.parse(JSON.stringify(entry)))).toEqual(entry);
    expect(departureOf(entry)).toEqual(departure);
  });

  it('keeps a fault, and what the quiet departure after it said', async () => {
    const quietly = await departed();
    const fault = { name: 'MoveFault', detail: 'no', object: HALL, engine: false };
    const entry = departureEntry(departure, host, { committed: false, fault, quietly });
    expect(entry.fault).toEqual(fault);
    expect(entry.effects.map((e) => e.paragraphs)).toEqual(
      quietly.effects.map((e) => [...e.paragraphs]),
    );
  });
});
