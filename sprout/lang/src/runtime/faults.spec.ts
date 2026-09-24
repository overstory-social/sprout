import { describe, expect, it } from 'vitest';

import { actorOf, belfry, BELL, FAULT, HALL, MARTA } from '../fixtures/turns.js';
import { words } from '../fixtures/reading.js';
import { ActFault } from './act.js';
import { ValueOutOfRange } from './body.js';
import { BudgetExhausted } from './budget.js';
import { boundObject, IntegerOverflow } from './evaluate.js';
import { faultOf, faultTold, worldSpeech } from './faults.js';
import { LifecycleFault } from './lifecycle.js';
import { ListFull } from './lists.js';
import { MoveFault } from './move.js';
import { DestroyedReference, NameOutOfRange } from './named.js';
import { readerOf, type StateReader } from './state.js';

describe('what a fault is', () => {
  it('names the object for every rule that is about one', () => {
    const about = [
      new LifecycleFault('out-of-range', BELL, 'far'),
      new MoveFault('holds-nothing', BELL, 'full'),
      new ActFault(BELL, 'gone'),
      new DestroyedReference(BELL),
      new NameOutOfRange('hall.bell', BELL, HALL),
    ];
    for (const error of about) {
      expect(faultOf(error)).toEqual({
        name: error.name,
        detail: error.message,
        object: BELL,
        engine: false,
      });
    }
    expect(faultOf(new NameOutOfRange('hall.gone', null, HALL))).toMatchObject({
      object: null,
      engine: false,
    });
  });

  it('names no object for the world’s own faults that are about none', () => {
    const none = [
      new BudgetExhausted('events', 256, 'too many'),
      new ValueOutOfRange(BELL, 'struck', 3),
      new IntegerOverflow(2147483648),
      new ListFull(8, { type: 'integer', min: 0, max: 9 }),
    ];
    for (const error of none) {
      expect(faultOf(error)).toEqual({
        name: error.name,
        detail: error.message,
        object: null,
        engine: false,
      });
    }
  });

  it('marks anything else as the engine’s own defect, for the host to report', () => {
    expect(faultOf(new TypeError('x is undefined'))).toEqual({
      name: 'TypeError',
      detail: 'x is undefined',
      object: null,
      engine: true,
    });
    expect(faultOf('thrown bare')).toEqual({
      name: 'Error',
      detail: 'thrown bare',
      object: null,
      engine: true,
    });
  });
});

describe('the world’s words for a fault', () => {
  it('are its own passages, as they apply on its kind', () => {
    const state = readerOf(belfry());
    expect(words(worldSpeech(state, 'fault'))).toBe(FAULT);
    expect(words(worldSpeech(state, 'unseen'))).toBe(
      'sprout.World unseen: Something here is too much to take in.',
    );
  });

  it('fall back to the stock line, in fixed words, where the world has no such passage', () => {
    const committed = readerOf(belfry());
    const world = committed.instance(committed.world)!;
    const bare: StateReader = {
      ...committed,
      instance: (id) =>
        id === committed.world
          ? { ...world, kind: { ...world.kind, passages: new Map() } }
          : committed.instance(id),
    };
    expect(worldSpeech(bare, 'fault')).toMatchObject({
      text: 'Something in this world has gone wrong, and nothing has changed.',
      library: 'sprout',
    });
    expect(worldSpeech(bare, 'unseen')).toMatchObject({
      text: 'Something here is too much to take in.',
    });
  });

  it('are told to the actor alone, from the world, as a notice, with `actor` and `here` bound', () => {
    const state = belfry();
    const marta = actorOf(state, MARTA);
    const told = faultTold(readerOf(state), marta);
    expect(told).toMatchObject({ effect: 'notice', to: [marta], by: state.world, speaker: null });
    expect(words(told.said)).toBe(FAULT);
    expect(told.bindings).toEqual(
      new Map([
        ['actor', boundObject(marta)],
        ['here', boundObject(HALL)],
      ]),
    );
  });
});
