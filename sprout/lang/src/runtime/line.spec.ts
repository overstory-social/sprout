import { describe, expect, it } from 'vitest';

import { host, MARTA, played, workshop } from '../fixtures/workshop.js';
import { commandTurn, type Command } from './command.js';
import { partsOf, runLine } from './line.js';

describe('the commands a line holds', () => {
  it('are split at each `.` and each word `then`, blanks dropped', () => {
    expect(partsOf('take key then open cabinet')).toEqual(['take key', 'open cabinet']);
    expect(partsOf('take key. open cabinet.')).toEqual(['take key', 'open cabinet']);
    expect(partsOf('take key.. then Then drop key')).toEqual(['take key', 'drop key']);
    // A word only beginning like it is no `then`.
    expect(partsOf('thence north')).toEqual(['thence north']);
  });

  it('are the whole line where it holds none, so every line is read', () => {
    expect(partsOf('.')).toEqual(['.']);
    expect(partsOf('')).toEqual(['']);
  });
});

describe('the turns a line runs', () => {
  it('run each command in order, each after the first with its own seed', () => {
    const seen: Command[] = [];
    let state = workshop();
    let seed = 20;
    const turns = runLine(
      { visit: MARTA, text: 'take pin then drop pin', seed: 7, mayHold: null, now: 0 },
      (command) => {
        seen.push(command);
        const turn = commandTurn(state, host(), command);
        if (turn.committed) state = turn.state;
        return turn;
      },
      () => (seed += 1),
    );
    expect(turns).toHaveLength(2);
    expect(seen.map((one) => [one.text, one.seed])).toEqual([
      ['take pin', 7],
      ['drop pin', 21],
    ]);
  });

  it('stop at a refusal, keeping what ran before it', () => {
    const { read, state } = played(workshop(), MARTA, 'take pin then take pin then drop pin');
    expect(read['Marta']).toEqual(['You take a pin.', 'You already have it.']);
    expect(state.visitors.get(MARTA)!.referents).toHaveLength(1);
  });

  it('stop at `unknown`, `not_here` and `cannot`, and go on past what acted', () => {
    const lines = (text: string) => played(workshop(), MARTA, text).read['Marta'];
    expect(lines('dance. take pin')).toEqual(['That is not something you can do here.']);
    expect(lines('take zebra. take pin')).toEqual(['You see nothing like that here.']);
    expect(lines('put anvil in pin then take pin')).toEqual([
      "You can't put the anvil in the pin.",
    ]);
    expect(lines('take pin. drop pin')).toEqual(['You take a pin.', 'You put a pin down.']);
  });
});
