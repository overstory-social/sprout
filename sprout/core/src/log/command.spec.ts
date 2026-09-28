import { describe, expect, it } from 'vitest';

import { commandTurn } from '@overstory/sprout/lang';

import { command, COUNTER, GAUGE, MARTA, seeded, tally } from '../fixtures/tally.js';
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
      level: 'info',
      fault: null,
      effects: [
        { kind: 'said', level: 'prose', from: COUNTER, visit: MARTA, paragraphs: ['Click.'] },
      ],
      cutShort: [],
    });
    expect(CommandEntry.parse(JSON.parse(JSON.stringify(entry)))).toEqual(entry);
  });

  it('keeps a fault and the one effect it has, the fault told to the one who typed', async () => {
    const typed = command('smash counter');
    const entry = commandEntry(typed, host, commandTurn(await state(), host, typed));
    expect(entry.fault).toMatchObject({ name: 'IntegerOverflow', object: null, engine: false });
    expect(entry.effects.map((e) => [e.kind, e.visit])).toEqual([['notice', MARTA]]);
  });

  it('keeps each reader the turn cut short, in order, as a warning', async () => {
    const typed = command('bump counter');
    const turn = commandTurn(await state(), host, typed);
    if (!turn.committed) throw new Error(turn.fault.detail);
    const entry = commandEntry(typed, host, { ...turn, cutShort: [COUNTER, GAUGE] });
    expect(entry.cutShort).toEqual([
      { level: 'warning', to: COUNTER },
      { level: 'warning', to: GAUGE },
    ]);
    expect(CommandEntry.parse(JSON.parse(JSON.stringify(entry)))).toEqual(entry);
  });

  it('keeps a reading drawn from several that tied as a warning, with how many it was drawn from', async () => {
    const typed = command('bump counter');
    const turn = commandTurn(await state(), host, typed);
    if (!turn.committed || !('acted' in turn.value)) throw new Error('did not act');
    expect(commandEntry(typed, host, turn).drawn).toBeNull();
    const drawn = { ...turn, value: { ...turn.value, drawn: { among: 3, meant: null } } };
    const entry = commandEntry(typed, host, drawn);
    expect(entry.drawn).toEqual({ level: 'warning', among: 3 });
    expect(CommandEntry.parse(JSON.parse(JSON.stringify(entry)))).toEqual(entry);
    expect(
      CommandEntry.safeParse({ ...entry, drawn: { level: 'warning', among: 1 } }).success,
    ).toBe(false);
  });

  it('hands back the command as the host handed it over', async () => {
    const typed = { ...command('rest gauge', 9), seed: 3 };
    const entry = commandEntry(typed, host, commandTurn(await state(), host, typed));
    expect(commandOf(entry)).toEqual(typed);
  });
});
