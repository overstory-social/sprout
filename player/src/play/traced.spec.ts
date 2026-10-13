import { describe, expect, it } from 'vitest';

import { bundle } from '../fixtures/play.js';
import { arrive, freshStage } from '../play.js';
import { loggedOf, trace } from './traced.js';

describe('loggedOf', () => {
  it('reads the instant and the serial from the stage, and records nothing written unless told', () => {
    const stage = freshStage(bundle);
    arrive(stage, 'Marta');
    expect(loggedOf(stage, { seed: 3 })).toEqual({
      seed: 3,
      now: stage.now,
      who: null,
      nickname: null,
      wake: null,
      outcome: 'done',
      cut: [],
      serial: stage.state.serial,
      wakes: null,
      stale: null,
      changes: null,
      command: null,
    });
  });
});

describe('trace', () => {
  it('notes a turn with every place a visitor stands in, read from the state as the turn left it', () => {
    const stage = freshStage(bundle);
    arrive(stage, 'Marta');
    const before = stage.turns.length;
    trace(stage, 'tick', loggedOf(stage, { seed: 0 }), {});
    const noted = stage.turns[before];
    expect(noted).toMatchObject({ turn: 'tick', faults: [], effects: [], answered: null });
    expect(noted?.standing).toEqual(stage.turns[before - 1]?.standing);
    expect(noted?.standing.length).toBeGreaterThan(0);
  });
});
