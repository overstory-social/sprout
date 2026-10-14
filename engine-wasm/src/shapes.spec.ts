import { describe, expect, it } from 'vitest';

import { EntrySchema, LineCommandSchema, read, ToldSchema } from './shapes.js';

// What the engine answers is checked once as it crosses into TypeScript:
// a shape the language does not have is refused, in words naming where.

const told = {
  result: 'done',
  changed: true,
  fault: null,
  words: null,
  lines: [['visit:marta', 'said', 'Click.']],
  effects: [
    {
      kind: 'said',
      from: 'tally.hall.counter',
      actor: 'tally#1',
      to: 'tally#1',
      visit: 'visit:marta',
      paragraphs: ['Click.'],
      written: [{ line: 'counter.sprout:3:40' }],
    },
  ],
  cutShort: [],
  stale: ['visit:marta'],
  entry: null,
  changes: null,
  account: {
    ran: [{ origin: 'tally.Counter', on: 'changed :n', at: 'counter.sprout:5:3' }],
    answered: null,
    refused: false,
  },
};

describe('the shapes the engine answers in', () => {
  it('reads a turn as the language gives one', () => {
    const read_ = read(ToldSchema, JSON.stringify(told), 'a turn');
    expect(read_.effects[0]?.paragraphs).toEqual(['Click.']);
    expect(read_.stale).toEqual(['visit:marta']);
    expect(read_.account.ran.map((one) => one.on)).toEqual(['changed :n']);
  });

  it('reads what a turn ran as core’s account, and refuses one with a part missing', () => {
    expect(read(ToldSchema, JSON.stringify(told), 'a turn').account).toEqual(told.account);
    const unnamed = { ...told, account: { ...told.account, ran: [{ origin: 'tally.Counter' }] } };
    expect(() => read(ToldSchema, JSON.stringify(unnamed), 'a turn')).toThrow(
      /answered a turn in a shape it does not have: account\.ran\.0\.on/,
    );
  });

  it('refuses a shape the language does not have, naming where', () => {
    const wrong = { ...told, effects: [{ ...told.effects[0], kind: 'shouted' }] };
    expect(() => read(ToldSchema, JSON.stringify(wrong), 'a turn')).toThrow(
      /answered a turn in a shape it does not have: effects\.0\.kind/,
    );
  });

  it('takes the entry of a write turn and no other', () => {
    const published = { kind: 'publish', level: 'info', now: 0, hash: 'x', stamp: 'y' };
    expect(EntrySchema.safeParse(published).success).toBe(false);
  });

  it('reads a line’s command with its line and its own number there', () => {
    const one = {
      visit: 'visit:marta',
      text: 'look',
      planned: null,
      reread: null,
      line: 0,
      step: 1,
    };
    expect(read(LineCommandSchema, JSON.stringify(one), 'a line')).toEqual(one);
    expect(LineCommandSchema.safeParse({ ...one, step: 0 }).success).toBe(false);
  });
});
