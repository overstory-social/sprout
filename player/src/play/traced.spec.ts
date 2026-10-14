import { describe, expect, it } from 'vitest';

import { bundle, ENGINES_BUILT } from '../fixtures/play.js';
import { arrive, freshStage } from '../play.js';
import { trace } from './traced.js';

describe.each(ENGINES_BUILT)('trace, on the %s engine', (engine) => {
  it('notes a turn with every place a visitor stands in, read from the stored state as the turn left it', () => {
    const stage = freshStage(bundle, engine);
    arrive(stage, 'Marta');
    const before = stage.turns.length;
    trace(stage, 'tick', {});
    const noted = stage.turns[before];
    expect(noted).toMatchObject({ turn: 'tick', faults: [], effects: [], account: null });
    expect(noted?.standing).toEqual(stage.turns[before - 1]?.standing);
    expect(noted?.standing.length).toBeGreaterThan(0);
  });
});
