import { describe, expect, it } from 'vitest';

import { CHEST, commandContext, LAMP, study, STUDY } from '../../fixtures/parser.js';
import { plannedOf } from './planned.js';

describe('a planned reading, as its own turn runs it', () => {
  const take = STUDY.verbs.qualified('sprout', 'take')!;
  const run = (ready?: (one: ReturnType<typeof study>) => void) => {
    const one = study();
    ready?.(one);
    const actor = one.people[0]!;
    const planned = { verb: take, actor, bindings: new Map([['target', { object: LAMP }]]) };
    return { planned, parsed: plannedOf(planned, actor, commandContext(one)) };
  };

  it('runs as planned where what it binds is still in reach', () => {
    const { planned, parsed } = run();
    expect(parsed).toEqual({ reading: planned, rest: [], drawn: null, corrected: [] });
  });

  it('is `not_here` where a thing it binds has gone out of reach, or out of the world', () => {
    const shut = run((one) => one.draft.place(LAMP, CHEST)).parsed;
    expect('answered' in shut && shut.answered.said).toMatchObject({
      passage: { name: 'not_here' },
    });
    const gone = run((one) => one.draft.remove(LAMP)).parsed;
    expect('answered' in gone && gone.answered.said).toMatchObject({
      passage: { name: 'not_here' },
    });
  });
});
