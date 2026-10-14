import { describe, expect, it } from 'vitest';

import { FAULTED, INPUTS, roundTrip, SAID } from '../fixtures/entries.js';
import { COUNTER, GAUGE, MARTA, tally } from '../fixtures/tally.js';
import { CommandEntry, commandOf } from './command.js';

const catalogue = tally();
const typed = {
  kind: 'command',
  ...INPUTS,
  visit: MARTA,
  text: 'bump counter',
  planned: null,
  reread: null,
  fault: null,
  effects: [SAID],
  drawn: null,
  cutShort: [],
} as const;
const bump = catalogue.verbs.qualified('tally', 'bump')!;

describe('a command in the log', () => {
  it('keeps who typed it, the words, its inputs and what it said', () => {
    expect(CommandEntry.parse(roundTrip(typed))).toEqual(typed);
  });

  it('keeps a fault, a draw from several that tied, and each reader cut short, as warnings', () => {
    const entry = {
      ...typed,
      fault: FAULTED,
      drawn: { level: 'warning', among: 3 },
      cutShort: [
        { level: 'warning', to: COUNTER },
        { level: 'warning', to: GAUGE },
      ],
    } as const;
    expect(CommandEntry.parse(roundTrip(entry))).toEqual(entry);
    expect(
      CommandEntry.safeParse({ ...entry, drawn: { level: 'warning', among: 1 } }).success,
    ).toBe(false);
  });

  it('hands back the command as the host handed it over', () => {
    expect(commandOf(CommandEntry.parse(typed), catalogue)).toEqual({
      visit: MARTA,
      text: 'bump counter',
      seed: 3,
      mayHold: null,
      now: 9,
    });
  });

  it('hands back the step an intent planned as the reading it was', () => {
    const entry = CommandEntry.parse({
      ...typed,
      text: 'twice gauge',
      planned: {
        verb: { library: 'tally', name: 'bump' },
        actor: 'tally#1',
        bindings: [['target', { object: GAUGE }]],
      },
    });
    expect(commandOf(entry, catalogue)).toMatchObject({
      text: 'twice gauge',
      planned: {
        verb: bump,
        actor: 'tally#1',
        bindings: new Map([['target', { object: GAUGE }]]),
      },
    });
  });

  it('hands back an item of a run read afresh, its role and words beside the step, and a value it binds', () => {
    const reread = {
      role: 'target',
      words: 'gauge',
      values: [{ role: 'times', words: 'three' }],
      referents: [GAUGE],
    };
    const entry = CommandEntry.parse({
      ...typed,
      text: 'bump counter and gauge',
      planned: {
        verb: { library: 'tally', name: 'bump' },
        actor: 'tally#1',
        bindings: [['times', { value: 3 }]],
      },
      reread,
    });
    expect(commandOf(entry, catalogue)).toMatchObject({
      reread,
      planned: { bindings: new Map([['times', { value: 3 }]]) },
    });
  });

  it('refuses a planned step whose verb is no longer declared', () => {
    const entry = CommandEntry.parse({
      ...typed,
      planned: { verb: { library: 'tally', name: 'vanish' }, actor: 'tally#1', bindings: [] },
    });
    expect(() => commandOf(entry, catalogue)).toThrow('`tally.vanish` is not declared here.');
  });

  it('reads an entry that names no item as reading none, and an item that names no values or pronouns as naming none', () => {
    const { reread: _reread, ...older } = typed;
    expect(CommandEntry.parse(older).reread).toBeNull();
    const item = CommandEntry.parse({ ...typed, reread: { role: 'target', words: 'gauge' } });
    expect(item.reread).toEqual({ role: 'target', words: 'gauge', values: [], referents: [] });
  });
});
