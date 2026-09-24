import { describe, expect, it } from 'vitest';

import { commandTurn } from '@overstory/sprout/lang';

import { command, COUNTER, MARTA, seeded, tally } from '../fixtures/tally.js';
import { committedState } from '../turns.js';
import { CommandEntry, commandEntry, commandOf } from './command.js';

const { host } = tally();
const state = async () => committedState(await seeded(host), 'w', host);

describe('a command in the log', () => {
  it('keeps who typed it, the words, its inputs and what it said', async () => {
    const typed = { ...command('bump counter', 30), seed: 7, mayHold: 12 };
    const entry = commandEntry(typed, host, commandTurn(await state(), host, typed));
    expect(entry).toMatchObject({
      kind: 'command',
      visit: MARTA,
      text: 'bump counter',
      seed: 7,
      mayHold: 12,
      now: 30,
      fault: null,
      effects: [{ kind: 'said', from: COUNTER, visit: MARTA, paragraphs: ['Click.'] }],
    });
    expect(CommandEntry.parse(JSON.parse(JSON.stringify(entry)))).toEqual(entry);
  });

  it('keeps a fault and the one effect it has, the fault told to the one who typed', async () => {
    const typed = command('smash counter');
    const entry = commandEntry(typed, host, commandTurn(await state(), host, typed));
    expect(entry.fault).toMatchObject({ name: 'IntegerOverflow', object: null, engine: false });
    expect(entry.effects.map((e) => [e.kind, e.visit])).toEqual([['notice', MARTA]]);
  });

  it('hands back the command as the host handed it over', async () => {
    const typed = { ...command('rest gauge', 9), seed: 3 };
    const entry = commandEntry(typed, host, commandTurn(await state(), host, typed));
    expect(commandOf(entry)).toEqual(typed);
  });
});
