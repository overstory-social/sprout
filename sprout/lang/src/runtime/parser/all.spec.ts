import { describe, expect, it } from 'vitest';

import { typedWords } from '../../declare/addressing.js';
import {
  BRASS_KEY,
  CHEST,
  DIAL,
  DOOR,
  GONG,
  GUARD,
  HALL,
  IRON_KEY,
  LAMP,
  LAMP_OIL,
  PEBBLE_A,
  PEBBLE_B,
  study,
  STUDY,
} from '../../fixtures/parser.js';
import { Budget } from '../budget.js';
import { DEFAULT_LIMITS } from '../../bundle/limits.js';
import type { InstanceId } from '../ids.js';
import { addressOf } from './address.js';
import { allIn } from './all.js';
import type { Filled } from './fill.js';

const one = study();
const actor = one.people[0]!;
const addressing = { world: one.draft.world, nicknames: one.nicknames };
const REACHED = [
  actor,
  BRASS_KEY,
  IRON_KEY,
  LAMP,
  LAMP_OIL,
  GONG,
  PEBBLE_A,
  PEBBLE_B,
  CHEST,
  GUARD,
  DIAL,
  DOOR,
];
const candidates = REACHED.map((id: InstanceId, near) => {
  const instance = one.draft.instance(id)!;
  return { instance, address: addressOf(instance, addressing), near, carried: false };
});
const context = (setRoleObjects = DEFAULT_LIMITS.budgets.setRoleObjects) => ({
  candidates,
  budget: new Budget({ ...DEFAULT_LIMITS.budgets, setRoleObjects }),
  referents: [],
  actor,
  here: HALL,
  kinds: one.catalogue.kinds.values(),
});
const verb = (name: string, library = 'study') => STUDY.verbs.qualified(library, name)!;
const all = (line: string, verbName: string, role: string, library = 'study', cap?: number) => {
  const of = verb(verbName, library);
  return allIn(
    typedWords(line),
    of.roles.find((one) => one.name === role)!,
    of,
    context(cap),
  );
};
const ids = (filled: Filled | null) =>
  filled?.fills === 'all'
    ? filled.things.map(({ bound }) => ('object' in bound ? bound.object : null))
    : filled?.fills === 'options'
      ? filled.options.map(({ bound }) => ('set' in bound ? bound.set : null))
      : filled;

describe('`all` in a slot', () => {
  it('is no `all` where the words do not begin with it, or the role takes a value', () => {
    expect(all('key', 'take', 'target', 'sprout')).toBeNull();
    expect(all('all', 'turn', 'number')).toBeNull();
  });

  it('takes, for a role only the actor plays, every thing in reach but people, in the order reached', () => {
    expect(ids(all('all', 'take', 'target', 'sprout', 20))).toEqual([
      BRASS_KEY,
      IRON_KEY,
      LAMP,
      LAMP_OIL,
      GONG,
      PEBBLE_A,
      PEBBLE_B,
      CHEST,
      GUARD,
      DIAL,
      DOOR,
    ]);
  });

  it('takes, for a role of a kind, what composes the kind, and for a set role all at once', () => {
    expect(ids(all('all', 'unlock', 'tool'))).toEqual([BRASS_KEY, IRON_KEY]);
    expect(ids(all('all', 'juggle', 'things'))).toEqual([
      [BRASS_KEY, IRON_KEY, LAMP, LAMP_OIL, GONG, PEBBLE_A, PEBBLE_B, CHEST],
    ]);
  });

  it('takes, for an open role a kind plays, what plays a part in the verb', () => {
    expect(ids(all('all', 'ask', 'target', 'sprout'))).toEqual([GUARD]);
  });

  it('leaves out what `except` names, by name, noun or kind, and is `nothing` where it names nothing', () => {
    expect(ids(all('all except the brass key and pebble', 'unlock', 'tool'))).toEqual([IRON_KEY]);
    expect(ids(all('all except metal', 'unlock', 'tool'))).toEqual({
      fills: 'nothing',
      start: 0,
      end: 3,
    });
    expect(all('all except zebra', 'unlock', 'tool')).toEqual({
      fills: 'nothing',
      start: 2,
      end: 3,
    });
    expect(all('all except', 'unlock', 'tool')).toEqual({ fills: 'unfit', things: [] });
    expect(all('all the keys', 'unlock', 'tool')).toEqual({ fills: 'unfit', things: [] });
  });

  it('takes, for a carried role, only what the actor carries', () => {
    const of = verb('unlock');
    const tool = { ...of.roles.find((one) => one.name === 'tool')!, carried: true };
    const carrying = candidates.map((one) => ({
      ...one,
      carried: one.instance.id === IRON_KEY || one.instance.id === GONG,
    }));
    expect(ids(allIn(typedWords('all'), tool, of, { ...context(), candidates: carrying }))).toEqual(
      [IRON_KEY],
    );
    const nothing = allIn(typedWords('all'), tool, of, context());
    expect(nothing).toEqual({ fills: 'nothing', start: 0, end: 1 });
  });

  it('takes no more than a set role may bind', () => {
    expect(ids(all('all', 'take', 'target', 'sprout', 3))).toEqual([BRASS_KEY, IRON_KEY, LAMP]);
  });
});

describe('what `all` costs', () => {
  it('is a step for each kind asked whether it plays the role, and each thing `except` is weighed against', () => {
    const plain = context();
    const of = verb('take', 'sprout');
    allIn(typedWords('all'), of.roles[0]!, of, plain);
    const excepting = context();
    allIn(typedWords('all except gong'), of.roles[0]!, of, excepting);
    expect(plain.budget.spentSteps).toBeGreaterThan(candidates.length);
    expect(excepting.budget.spentSteps).toBeGreaterThan(
      plain.budget.spentSteps + candidates.length,
    );
  });
});
