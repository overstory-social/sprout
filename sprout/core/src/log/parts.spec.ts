import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS, SEED_MAX, type Effect, type Fault } from '@overstory/sprout/lang';

import { COUNTER, MARTA } from '../fixtures/tally.js';
import { LoggedEffect, loggedEffects, loggedFault, TurnInputs, writeInputsOf } from './parts.js';

describe('a turn’s inputs as the log keeps them', () => {
  const kept = { seed: SEED_MAX, mayHold: 40, now: 3_000_000_000, budgets: DEFAULT_LIMITS.budgets };

  it('keeps the seed, the bound, the instant and every budget, and hands back the inputs a turn takes', () => {
    expect(TurnInputs.parse(JSON.parse(JSON.stringify(kept)))).toEqual(kept);
    expect(writeInputsOf(kept)).toEqual({ seed: SEED_MAX, mayHold: 40, now: 3_000_000_000 });
  });

  it('refuses a seed outside the generator’s range and an instant that is not whole seconds', () => {
    expect(TurnInputs.safeParse({ ...kept, seed: SEED_MAX + 1 }).success).toBe(false);
    expect(TurnInputs.safeParse({ ...kept, seed: -1 }).success).toBe(false);
    expect(TurnInputs.safeParse({ ...kept, now: 1.5 }).success).toBe(false);
    expect(TurnInputs.safeParse({ ...kept, mayHold: -1 }).success).toBe(false);
    expect(TurnInputs.safeParse({ ...kept, budgets: { steps: 1 } }).success).toBe(false);
  });
});

describe('effects and faults as the log keeps them', () => {
  it('keeps every field of each effect but where its words were written, in order, and copies the words', () => {
    const paragraphs = ['Click.'];
    const written = [{ line: 'counter.sprout:3:9' }];
    const effects: Effect[] = [
      { kind: 'said', from: COUNTER, actor: null, to: COUNTER, visit: MARTA, paragraphs, written },
      {
        kind: 'notice',
        from: COUNTER,
        actor: COUNTER,
        to: COUNTER,
        visit: MARTA,
        paragraphs: [],
        written: [],
      },
    ];
    const kept = loggedEffects(effects);
    // Where the words were written is an author's tools' to ask; replaying the log re-renders it.
    expect(kept).toEqual(
      effects.map(({ written: _, ...e }) => ({
        level: 'prose',
        ...e,
        paragraphs: [...e.paragraphs],
      })),
    );
    expect(kept[0]!.paragraphs).not.toBe(paragraphs);
  });

  it('keeps an extension’s effect whole: the extension, the statement, its payload and its transcript', () => {
    const recorded: Effect = {
      kind: 'extension',
      from: COUNTER,
      actor: COUNTER,
      to: COUNTER,
      visit: MARTA,
      paragraphs: ['[A picture: a cat]'],
      written: [],
      extension: 'media',
      statement: 'show',
      payload: { src: 'cat.png', size: [3, 4], shown: true, caption: null },
    };
    const [kept] = loggedEffects([recorded]);
    const { written: _, ...whole } = recorded;
    expect(kept).toEqual({ level: 'prose', ...whole });
    expect(LoggedEffect.parse(JSON.parse(JSON.stringify(kept)))).toEqual(kept);
    expect(LoggedEffect.safeParse({ ...kept, payload: undefined }).success).toBe(false);
    expect(LoggedEffect.safeParse({ ...kept, extension: '' }).success).toBe(false);
  });

  it('refuses an effect of a kind the spec does not name', () => {
    const one = {
      kind: 'said',
      level: 'prose',
      from: 'a',
      actor: null,
      to: 'b',
      visit: 'v',
      paragraphs: [],
    };
    expect(LoggedEffect.safeParse(one).success).toBe(true);
    expect(LoggedEffect.safeParse({ ...one, kind: 'shouted' }).success).toBe(false);
    // An effect is prose, and at no other level.
    expect(LoggedEffect.safeParse({ ...one, level: 'info' }).success).toBe(false);
  });

  it('keeps a fault’s rule, detail, object, whether it is the engine’s and the extension it names', () => {
    const fault: Fault = {
      name: 'ListFull',
      detail: 'full',
      object: COUNTER,
      engine: false,
      extension: null,
    };
    expect(loggedFault({ ...fault, extra: 1 } as Fault)).toEqual({ level: 'error', ...fault });
    const extension: Fault = { ...fault, name: 'ExtensionFault', extension: 'media' };
    expect(loggedFault(extension)).toEqual({ level: 'error', ...extension });
  });
});
