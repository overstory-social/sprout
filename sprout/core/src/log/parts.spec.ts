import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS, SEED_MAX, type Effect, type Fault } from '@overstory/sprout/lang';

import { COUNTER, MARTA, tally } from '../fixtures/tally.js';
import {
  inputsOf,
  LoggedEffect,
  loggedEffects,
  loggedFault,
  TurnInputs,
  writeInputsOf,
} from './parts.js';

const { host } = tally();

describe('a turn’s inputs as the log keeps them', () => {
  it('keeps the seed, the bound, the instant and every budget the host ran the turn under', () => {
    const tight = { ...host, budgets: { ...DEFAULT_LIMITS.budgets, steps: 12, wallClockMs: 900 } };
    const inputs = { seed: SEED_MAX, mayHold: 40, now: 3_000_000_000 };
    const kept = inputsOf(inputs, tight);
    expect(kept).toEqual({
      ...inputs,
      budgets: { ...DEFAULT_LIMITS.budgets, steps: 12, wallClockMs: 900 },
    });
    expect(TurnInputs.parse(JSON.parse(JSON.stringify(kept)))).toEqual(kept);
    expect(writeInputsOf(kept)).toEqual(inputs);
  });

  it('keeps the budgets and nothing else the host’s object carries', () => {
    const wider = { ...host, budgets: { ...DEFAULT_LIMITS.budgets, somethingElse: 1 } };
    expect(Object.keys(inputsOf({ seed: 0, mayHold: null, now: 0 }, wider).budgets)).toEqual(
      Object.keys(DEFAULT_LIMITS.budgets),
    );
  });

  it('refuses a seed outside the generator’s range and an instant that is not whole seconds', () => {
    const good = inputsOf({ seed: 0, mayHold: null, now: 0 }, host);
    expect(TurnInputs.safeParse({ ...good, seed: SEED_MAX + 1 }).success).toBe(false);
    expect(TurnInputs.safeParse({ ...good, seed: -1 }).success).toBe(false);
    expect(TurnInputs.safeParse({ ...good, now: 1.5 }).success).toBe(false);
    expect(TurnInputs.safeParse({ ...good, mayHold: -1 }).success).toBe(false);
  });
});

describe('effects and faults as the log keeps them', () => {
  it('keeps every field of each effect, in order, and copies the words', () => {
    const paragraphs = ['Click.'];
    const effects: Effect[] = [
      { kind: 'said', from: COUNTER, actor: null, to: COUNTER, visit: MARTA, paragraphs },
      { kind: 'notice', from: COUNTER, actor: COUNTER, to: COUNTER, visit: MARTA, paragraphs: [] },
    ];
    const kept = loggedEffects(effects);
    expect(kept).toEqual(effects.map((e) => ({ ...e, paragraphs: [...e.paragraphs] })));
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
      extension: 'media',
      statement: 'show',
      payload: { src: 'cat.png', size: [3, 4], shown: true, caption: null },
    };
    const [kept] = loggedEffects([recorded]);
    expect(kept).toEqual(recorded);
    expect(LoggedEffect.parse(JSON.parse(JSON.stringify(kept)))).toEqual(recorded);
    expect(LoggedEffect.safeParse({ ...recorded, payload: undefined }).success).toBe(false);
    expect(LoggedEffect.safeParse({ ...recorded, extension: '' }).success).toBe(false);
  });

  it('refuses an effect of a kind the spec does not name', () => {
    const one = { kind: 'said', from: 'a', actor: null, to: 'b', visit: 'v', paragraphs: [] };
    expect(LoggedEffect.safeParse(one).success).toBe(true);
    expect(LoggedEffect.safeParse({ ...one, kind: 'shouted' }).success).toBe(false);
  });

  it('keeps a fault’s rule, detail, object, whether it is the engine’s and the extension it names', () => {
    const fault: Fault = {
      name: 'ListFull',
      detail: 'full',
      object: COUNTER,
      engine: false,
      extension: null,
    };
    expect(loggedFault({ ...fault, extra: 1 } as Fault)).toEqual(fault);
    const extension: Fault = { ...fault, name: 'ExtensionFault', extension: 'media' };
    expect(loggedFault(extension)).toEqual(extension);
  });
});
