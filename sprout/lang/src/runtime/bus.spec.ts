import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '../bundle/limits.js';
import {
  BELL,
  BUBBLE,
  BUS,
  DOG,
  eventTurn,
  held,
  LAMP,
  MATCH,
  MOTH,
  TIDIER,
  WICK,
  type EventTurn,
} from '../fixtures/events.js';
import type { DeclaredMessage } from '../declare/messages.js';
import { BudgetExhausted } from './budget.js';
import { drain, type Queued } from './bus.js';
import { Draws } from './draws.js';
import type { InstanceId } from './ids.js';
import { runReading, type Acted } from './reading.js';
import type { AuthoredSend } from './sends.js';
import type { TimeSend } from './time.js';
import type { Value } from './values.js';

const message = (name: string): DeclaredMessage => BUS.messages.qualified('bus', name)!;

/** An authored send, as a body's `send` queues one. */
function sent(name: string, recipient: InstanceId, from: InstanceId, value: Value | null = null) {
  const send: AuthoredSend = {
    message: 'authored',
    declared: message(name),
    recipient,
    from,
    value,
  };
  return send;
}

const queued = (...sends: AuthoredSend[]): Queued => ({ sends, destroyed: [], marked: [] });
const context = (one: EventTurn) => one.lifecycle;

describe('the queue drains', () => {
  it('delivers a message to every handler for it, and what that handler sends after', () => {
    const one = eventTurn();
    const drained = drain(queued(sent('lit', LAMP, BELL, true)), context(one));
    expect(held(one, LAMP, 'lit')).toBe(true);
    // The hook, queued by the write, with the light the lamp had then.
    expect(held(one, LAMP, 'was_lit')).toBe(false);
    expect(held(one, LAMP, 'flickers')).toBe(1);
    // The lamp answered its sender.
    expect(held(one, BELL, 'answers')).toBe(1);
    expect(drained.events).toBe(3);
  });

  it('passes a tick or a wake the seconds it carries, as its `elapsed`', () => {
    const one = eventTurn();
    const time = (message: 'tick' | 'woke', elapsed: number): TimeSend => ({
      message,
      recipient: BELL,
      elapsed,
    });
    const drained = drain(
      { sends: [time('tick', 7), time('woke', 5)], destroyed: [], marked: [] },
      context(one),
    );
    expect(held(one, BELL, 'waited')).toBe(17);
    expect(drained.events).toBe(2);
  });

  it('runs a handler with the turn’s draws, in the order the queue delivers', () => {
    const one = eventTurn();
    const expected = new Draws(7);
    const tolls: number[] = [];
    for (let i = 0; i < 5; i++) {
      drain(queued(sent('roll', BELL, BELL)), context(one));
      tolls.push(held(one, BELL, 'toll') as number);
    }
    expect(tolls).toEqual(Array.from({ length: 5 }, () => expected.below(6)));
  });

  it('queues a hook once per change, and not for a write that changes nothing', () => {
    const one = eventTurn();
    drain(
      queued(
        sent('lit', LAMP, BELL, true),
        sent('lit', LAMP, BELL, true),
        sent('lit', LAMP, BELL, false),
      ),
      context(one),
    );
    // Two changes, false to true and true to false; the second `true` changed nothing.
    expect(held(one, LAMP, 'flickers')).toBe(2);
    expect(held(one, LAMP, 'was_lit')).toBe(true);
  });

  it('drops what a destroying body sent, even what it sent before it went', () => {
    const one = eventTurn();
    // The lamp answers the bell with 1; the bubble's 5 is queued before
    // that answer and would land first, but the bubble bursts, and what it
    // sent goes with it.
    const drained = drain(
      queued(sent('lit', LAMP, BELL, true), sent('rang', BUBBLE, BELL)),
      context(one),
    );
    expect(held(one, BELL, 'answers')).toBe(1);
    expect(drained.destroyed).toEqual([BUBBLE]);
  });

  it('drops what is queued to a destroyed object', () => {
    const one = eventTurn();
    const drained = drain(
      queued(sent('rang', BUBBLE, BELL), sent('rang', BUBBLE, BELL)),
      context(one),
    );
    expect(drained.events).toBe(1);
    expect(one.draft.instance(BUBBLE)).toBeUndefined();
  });

  it('drops what a destroyed object sent that is still waiting, and what names it as `from`', () => {
    const one = eventTurn();
    const acted: Queued = {
      sends: [sent('answered', BELL, MOTH, 4), sent('lit', LAMP, MOTH, true)],
      destroyed: [MOTH],
      marked: [],
    };
    const drained = drain(acted, context(one));
    expect(drained.events).toBe(0);
    expect(held(one, BELL, 'answers')).toBe(0);
    expect(held(one, LAMP, 'lit')).toBe(false);
  });

  it('destroys what `finally destroy self` marked once the queue is empty, after what it sent arrived', () => {
    const one = eventTurn();
    const drained = drain(queued(sent('rang', MATCH, BELL)), context(one));
    expect(held(one, LAMP, 'lit')).toBe(true);
    expect(one.draft.instance(MATCH)).toBeUndefined();
    expect(drained.destroyed).toEqual([MATCH]);
  });

  it('runs a reading an NPC performs with `act` in a handler, one deeper', () => {
    const one = eventTurn();
    drain(queued(sent('stir', DOG, BELL)), context(one));
    expect(held(one, DOG, 'sniffed')).toBe(1);
  });

  it('says a handler’s refused `move` to nobody, and the handler ends there', () => {
    const one = eventTurn();
    const drained = drain(queued(sent('stir', TIDIER, BELL)), context(one));
    expect(drained.said).toHaveLength(1);
    expect(drained.said[0]).toMatchObject({ effect: 'refused', to: [], speaker: null });
    expect(held(one, TIDIER, 'tried')).toBe(false);
  });

  it('hands the light down a kind’s own copy, named from the kind’s body', () => {
    const one = eventTurn();
    const acted = runReading(
      {
        verb: BUS.verbs.qualified('bus', 'light')!,
        actor: one.visitor,
        bindings: new Map([['target', { object: LAMP }]]),
      },
      context(one),
    ) as Acted;
    drain(acted, context(one));
    expect(held(one, WICK, 'burning')).toBe(true);
    expect(held(one, MOTH, 'drawn')).toBe(true);
  });
});

describe('the queue is bounded', () => {
  it('faults an event past the turn’s budget', () => {
    const one = eventTurn({ ...DEFAULT_LIMITS.budgets, events: 2 });
    const fault = (() => {
      try {
        drain(queued(sent('lit', LAMP, BELL, true)), context(one));
        return null;
      } catch (error) {
        return error;
      }
    })();
    expect(fault).toBeInstanceOf(BudgetExhausted);
    expect((fault as BudgetExhausted).limit).toBe('events');
  });

  it('drains breadth-first, a ring of depth at a time, in insertion order', () => {
    const one = eventTurn({ ...DEFAULT_LIMITS.budgets, cascadeDepth: 3 });
    // Two chains, each sending itself one more: breadth-first runs 1, 10,
    // 2, 11, 3, 12 and faults at 4, where depth-first would fault at 4
    // having written 3.
    expect(() =>
      drain(queued(sent('chain', BELL, BELL, 1), sent('chain', BELL, BELL, 10)), context(one)),
    ).toThrow(BudgetExhausted);
    expect(held(one, BELL, 'depth')).toBe(12);
  });

  it('faults a cascade deeper than the limit, rather than running on', () => {
    const one = eventTurn({ ...DEFAULT_LIMITS.budgets, cascadeDepth: 5 });
    const fault = (() => {
      try {
        drain(queued(sent('chain', BELL, BELL, 1)), context(one));
        return null;
      } catch (error) {
        return error;
      }
    })();
    expect((fault as BudgetExhausted).limit).toBe('cascadeDepth');
    // Five deliveries ran, the effect pass's own at depth 1.
    expect(held(one, BELL, 'depth')).toBe(5);
  });
});
