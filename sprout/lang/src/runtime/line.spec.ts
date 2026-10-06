import { describe, expect, it } from 'vitest';

import { CHEST, host, MARTA, played, workshop, WORKSHOP } from '../fixtures/workshop.js';
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

  it('are read from their words, none carrying a step the caller planned', () => {
    const planned = {
      verb: WORKSHOP.verbs.qualified('sprout', 'look')!,
      actor: CHEST,
      bindings: new Map(),
    };
    const seen: Command[] = [];
    let state = workshop();
    runLine(
      { visit: MARTA, text: 'look. look', seed: 7, mayHold: null, now: 0, planned },
      (command) => {
        seen.push(command);
        const turn = commandTurn(state, host(), command);
        if (turn.committed) state = turn.state;
        return turn;
      },
      () => 8,
    );
    expect(seen.map((one) => 'planned' in one)).toEqual([false, false]);
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

describe('the turns a command plans after its own', () => {
  const lines = (text: string) => played(workshop(), MARTA, text).read['Marta'];

  it('run each thing of a run, in the order written, before the line’s next command', () => {
    expect(lines('take pin and key then drop key')).toEqual([
      'You take a pin.',
      'You take a key.',
      'You put a key down.',
    ]);
  });

  it('run a command `and` joined, read on its own turn, and what it plans in turn', () => {
    expect(lines('take pin and take key and drop pin, key')).toEqual([
      'You take a pin.',
      'You take a key.',
      'You put a pin down.',
      'You put a key down.',
    ]);
  });

  it('stop at the first refusal or answer among them, keeping what ran before', () => {
    expect(lines('take pin and pin and key')).toEqual(['You take a pin.', 'You already have it.']);
    expect(lines('take pin and zebra and key')).toEqual([
      'You take a pin.',
      'You see nothing like that here.',
    ]);
    expect(lines('take pin and dance and take key')).toEqual([
      'You take a pin.',
      'You see nothing like that here.',
    ]);
  });

  it('read an item that ties afresh on its own turn, every other role as the line bound it', () => {
    let state = workshop();
    for (const text of ['take pin and nail and tack', 'examine crate']) {
      state = played(state, MARTA, text).state;
    }
    // `it` named the crate when the line began; the pin's turn makes it the pin.
    const { read } = played(state, MARTA, 'put pin and spike in it');
    expect(read['Marta']).toEqual([
      'You put a pin in a crate.',
      expect.stringMatching(/^\((a nail|a tack)\)$/),
      'There is no room in a crate.',
    ]);
  });

  it('each run as a turn of its own, after the first with its own seed', () => {
    const seen: Command[] = [];
    let state = workshop();
    let seed = 20;
    runLine(
      { visit: MARTA, text: 'take pin and key and take crate', seed: 7, mayHold: null, now: 0 },
      (command) => {
        seen.push(command);
        const turn = commandTurn(state, host(), command);
        if (turn.committed) state = turn.state;
        return turn;
      },
      () => (seed += 1),
    );
    expect(seen.map((one) => [one.text, one.seed, 'planned' in one])).toEqual([
      ['take pin and key and take crate', 7, false],
      ['take pin and key and take crate', 21, true],
      ['take crate', 22, false],
    ]);
  });
});
