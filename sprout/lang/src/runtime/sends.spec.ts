import { describe, expect, it } from 'vitest';

import {
  BUS,
  CASE,
  CHEST,
  eventTurn,
  GEM,
  HALL,
  LAMP,
  LANTERN,
  MOTH,
  setOn,
  STRAY,
  WICK,
  WORLD,
  BELL,
  DOG,
  type EventTurn,
} from '../fixtures/events.js';
import type { DeclaredMessage } from '../declare/messages.js';
import { broadcastFrom, sendTo } from './sends.js';

const message = (name: string): DeclaredMessage => BUS.messages.qualified('bus', name)!;
const context = (turn: EventTurn) => ({
  state: turn.draft,
  passes: turn.passes,
  budget: turn.budget,
});

describe('a directed send', () => {
  it('is queued to its target, from the sender, carrying its value', () => {
    const one = eventTurn();
    expect(sendTo(context(one), LAMP, BELL, message('answered'), 1)).toEqual([
      { message: 'authored', declared: message('answered'), recipient: BELL, from: LAMP, value: 1 },
    ]);
  });

  it('goes nowhere where the target is out of range, or is nothing', () => {
    const one = eventTurn();
    expect(sendTo(context(one), LAMP, STRAY, message('rang'), null)).toEqual([]);
    expect(sendTo(context(one), LAMP, GEM, message('rang'), null)).toEqual([]);
    expect(sendTo(context(one), LAMP, null, message('rang'), null)).toEqual([]);
  });

  it('asks the containers between about its own message', () => {
    const one = eventTurn();
    // The case lets the light in, and nothing else.
    expect(sendTo(context(one), LAMP, MOTH, message('lit'), true)).toHaveLength(1);
    expect(sendTo(context(one), LAMP, MOTH, message('rang'), null)).toEqual([]);
    // An open chest passes everything.
    setOn(one, CHEST, { open: true });
    expect(sendTo(context(one), LAMP, GEM, message('rang'), null)).toHaveLength(1);
  });
});

describe('a broadcast', () => {
  it('reaches the sender’s range nearest first, leaving out the sender and the world', () => {
    const one = eventTurn();
    const to = broadcastFrom(context(one), LAMP, message('lit'), true).map(
      (sent) => sent.recipient,
    );
    expect(to).toEqual([HALL, CHEST, CASE, LANTERN, BELL, DOG, one.visitor, MOTH, WICK]);
    expect(to).not.toContain(LAMP);
    expect(to).not.toContain(WORLD);
  });

  it('hears a shut chest, and not what the chest holds', () => {
    const one = eventTurn();
    const to = broadcastFrom(context(one), LAMP, message('rang'), null).map(
      (sent) => sent.recipient,
    );
    expect(to).toContain(CHEST);
    expect(to).not.toContain(GEM);
    expect(to).not.toContain(MOTH);
  });

  it('from inside a shut container reaches what it holds and stops at its walls', () => {
    const one = eventTurn();
    expect(broadcastFrom(context(one), GEM, message('rang'), null)).toEqual([]);
    setOn(one, CHEST, { open: true });
    const to = broadcastFrom(context(one), GEM, message('rang'), null).map(
      (sent) => sent.recipient,
    );
    expect(to[0]).toBe(CHEST);
    expect(to).toContain(LAMP);
  });
});
