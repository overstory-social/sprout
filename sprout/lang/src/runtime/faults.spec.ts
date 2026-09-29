import { describe, expect, it } from 'vitest';

import { actorOf, belfry, BELL, FAULT, HALL, MARTA } from '../fixtures/turns.js';
import { words } from '../fixtures/reading.js';
import { ActFault } from './act.js';
import { ValueOutOfRange } from './body.js';
import { BudgetExhausted } from './budget.js';
import { boundObject, IntegerOverflow } from './evaluate.js';
import { faultOf, faultTold, stockFaultEffect } from './faults.js';
import { LifecycleFault } from './lifecycle.js';
import { ListFull } from './lists.js';
import { MoveFault } from './move.js';
import { DestroyedReference, NameOutOfRange } from './named.js';
import { readerOf, type StateReader } from './state.js';
import { WakeFault } from './wakes.js';

describe('what a fault is', () => {
  it('names the object for every rule that is about one', () => {
    const about = [
      new LifecycleFault('out-of-range', BELL, 'far'),
      new MoveFault('holds-nothing', BELL, 'full'),
      new ActFault(BELL, 'gone'),
      new DestroyedReference(BELL),
      new NameOutOfRange('hall.bell', BELL, HALL),
      new WakeFault(BELL, 'asked past the cap'),
    ];
    for (const error of about) {
      expect(faultOf(error)).toEqual({
        name: error.name,
        detail: error.message,
        object: BELL,
        engine: false,
        extension: null,
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
        extension: null,
      });
    }
  });

  it('marks anything else as the engine’s own defect, for the host to report', () => {
    expect(faultOf(new TypeError('x is undefined'))).toEqual({
      name: 'TypeError',
      detail: 'x is undefined',
      object: null,
      engine: true,
      extension: null,
    });
    expect(faultOf('thrown bare')).toEqual({
      name: 'Error',
      detail: 'thrown bare',
      object: null,
      engine: true,
      extension: null,
    });
  });
});

describe('the words for a fault', () => {
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

  it('are the actor’s own `fault` where it writes one, said by them, as every engine line is found', () => {
    const state = belfry();
    const marta = actorOf(state, MARTA);
    const committed = readerOf(state);
    const own = {
      ...committed.instance(committed.world)!.kind.passages.get('fault')!,
      yields: false,
    };
    const self = committed.instance(marta)!;
    const reader: StateReader = {
      ...committed,
      instance: (id) =>
        id === marta
          ? { ...self, kind: { ...self.kind, passages: new Map([['fault', own]]) } }
          : committed.instance(id),
    };
    expect(faultTold(reader, marta)).toMatchObject({ by: marta, said: { passage: own } });
  });

  it('are the stock line, binding no `here`, to an actor whose place is gone', () => {
    const state = belfry();
    const marta = actorOf(state, MARTA);
    const committed = readerOf(state);
    const gone: StateReader = {
      ...committed,
      instance: (id) => (id === HALL ? undefined : committed.instance(id)),
    };
    const told = faultTold(gone, marta);
    expect(told.said).toMatchObject({
      text: 'Something in this world has gone wrong, and nothing has changed.',
    });
    expect([...told.bindings.keys()]).toEqual(['actor']);
  });

  it('are the stock line as an effect, made without rendering, where the world’s cannot be rendered', () => {
    const state = belfry();
    const marta = actorOf(state, MARTA);
    expect(stockFaultEffect(readerOf(state), marta, MARTA)).toEqual({
      kind: 'notice',
      from: state.world,
      actor: marta,
      to: marta,
      visit: MARTA,
      paragraphs: ['Something in this world has gone wrong, and nothing has changed.'],
      written: [],
    });
  });
});
