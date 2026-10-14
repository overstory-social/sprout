import { describe, expect, it } from 'vitest';

import { visitKey, type CommandHost } from '@overstory/sprout/lang';

import {
  COUNTER,
  GAUGE,
  HALL,
  MARTA,
  seeded,
  storedIn,
  TALLY,
} from './engine-conformance/worlds.js';
import { parsedLine } from './parse.js';
import { loaded } from './steps.js';

// The TypeScript runtime's reading of a typed line: each command, read in a
// poll charged as its command turn, taken through the consent pass or the
// intent's plan, and nothing run.

const { host } = TALLY;
const read = async (line: string, under: CommandHost = host, visit = MARTA) => {
  const stored = await storedIn(await seeded(TALLY, [[MARTA, HALL, 'Marta']]));
  return parsedLine(loaded(stored, under), under, visit, line);
};

const counter = { id: COUNTER, name: 'a counter' };
const gauge = { id: GAUGE, name: 'a gauge' };
const bumping = (thing: typeof counter) => ({
  verb: 'tally.bump',
  roles: [{ name: 'target', filler: { object: thing } }],
});

describe('parsedLine', () => {
  it('reads a verb’s reading, every role named for the one who typed, and its consent pass', async () => {
    expect(await read('bump counter')).toEqual([
      { text: 'bump counter', reading: bumping(counter), drawn: null, refused: null },
    ]);
  });

  it('reads an intent with what fills each slot and the steps it plans now', async () => {
    expect(await read('twice gauge')).toEqual([
      {
        text: 'twice gauge',
        intent: { name: 'tally.twice', slots: [{ name: 'y', thing: gauge }] },
        drawn: null,
        steps: [bumping(gauge), bumping(gauge)],
      },
    ]);
  });

  it('gives the world’s answer to a line nothing reads, by its passage', async () => {
    expect(await read('frobnicate')).toEqual([
      {
        text: 'frobnicate',
        answered: { passage: 'unknown', paragraphs: ['That is not something you can do here.'] },
      },
    ]);
  });

  it('reads each command of a line on its own, against the world as it stands', async () => {
    const commands = await read('bump counter then bump gauge');
    expect(commands.map((one) => one.text)).toEqual(['bump counter', 'bump gauge']);
  });

  it('says a command that costs more than its turn’s steps faults, as its turn would', async () => {
    const starved = { ...host, budgets: { ...host.budgets, steps: 3 } };
    expect(await read('bump counter', starved)).toEqual([
      {
        text: 'bump counter',
        faulted: {
          name: 'BudgetExhausted',
          detail: 'steps: a command turn may take 3 steps.',
        },
      },
    ]);
  });

  it('refuses, in words, a visit that never came', async () => {
    await expect(read('bump counter', host, visitKey('v-nobody'))).rejects.toThrow(/never visited/);
  });
});
