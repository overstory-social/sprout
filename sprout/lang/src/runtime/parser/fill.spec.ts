import { describe, expect, it } from 'vitest';

import { typedWords } from '../../declare/addressing.js';
import type { ResolvedRole } from '../../declare/verbs.js';
import {
  BRASS_KEY,
  DIAL,
  EXITS,
  GONG,
  GUARD,
  IRON_KEY,
  study,
  STUDY,
} from '../../fixtures/parser.js';
import { Draws } from '../draws.js';
import type { InstanceId } from '../ids.js';
import type { Reading } from '../reading.js';
import { addressOf } from './address.js';
import { fillSlot, valueOf } from './fill.js';

const one = study();
const addressing = { world: one.draft.world, nicknames: one.nicknames };
const candidates = [BRASS_KEY, IRON_KEY, GONG, GUARD, DIAL].map((id: InstanceId) => {
  const instance = one.draft.instance(id)!;
  return { instance, address: addressOf(instance, addressing), near: 2 };
});
const context = { candidates, exits: EXITS, budget: one.budget, draws: new Draws(7) };
const verb = (name: string, library = 'study') => STUDY.verbs.qualified(library, name)!;
const role = (verbName: string, name: string, library = 'study'): ResolvedRole =>
  verb(verbName, library).roles.find((one) => one.name === name)!;
const fill = (r: ResolvedRole, line: string) => fillSlot(r, typedWords(line), context);

describe('what a slot’s words fill its role with', () => {
  it('is one thing for a thing role, and a set, even of one, for a set role', () => {
    expect(fill(role('take', 'target', 'sprout'), 'gong')).toEqual({
      fills: 'bound',
      bound: { object: GONG },
    });
    expect(fill(role('juggle', 'things'), 'gong')).toEqual({
      fills: 'bound',
      bound: { set: [GONG] },
    });
    expect(fill(role('juggle', 'things'), 'gong and brass key')).toEqual({
      fills: 'bound',
      bound: { set: [GONG, BRASS_KEY] },
    });
  });

  it('is the exit named for an exit role, and does not match where none is', () => {
    expect(fill(role('go', 'way', 'sprout'), 'n')).toEqual({
      fills: 'bound',
      bound: { exit: EXITS[0] },
    });
    expect(fill(role('go', 'way', 'sprout'), 'gong')).toEqual({ fills: 'unfit' });
  });

  it('asks which about the noun in doubt, saying where it runs in the slot', () => {
    expect(fill(role('take', 'target', 'sprout'), 'the key')).toEqual({
      fills: 'which',
      candidates: [BRASS_KEY, IRON_KEY],
      start: 0,
      end: 2,
    });
    expect(fill(role('juggle', 'things'), 'gong, key')).toMatchObject({
      fills: 'which',
      start: 2,
      end: 3,
    });
  });

  it('says where the noun that names nothing runs, in a run as in one slot', () => {
    expect(fill(role('take', 'target', 'sprout'), 'unicorn')).toEqual({
      fills: 'nothing',
      start: 0,
      end: 1,
    });
    expect(fill(role('juggle', 'things'), 'gong and the unicorn')).toEqual({
      fills: 'nothing',
      start: 2,
      end: 4,
    });
  });

  it('is the words for a value role, whatever they are', () => {
    expect(fill(role('ask', 'topic', 'sprout'), 'the old press')).toEqual({
      fills: 'words',
      words: ['the', 'old', 'press'],
    });
  });
});

describe('the value a value role’s words bind', () => {
  const asking: Reading = {
    verb: verb('ask', 'sprout'),
    actor: one.people[0]!,
    bindings: new Map([['target', { object: GUARD }]]),
  };
  const turning: Reading = {
    verb: verb('turn'),
    actor: one.people[0]!,
    bindings: new Map([['target', { object: DIAL }]]),
  };
  const topic = (line: string) =>
    valueOf(role('ask', 'topic', 'sprout'), typedWords(line), asking, one.draft);
  const number = (line: string) =>
    valueOf(role('turn', 'number'), typedWords(line), turning, one.draft);

  it('is the option spelt, as typed or after an article, where a participant hears it', () => {
    expect(topic('old press')).toBe('old_press');
    expect(topic('the bridge')).toBe('bridge');
    expect(topic('Bridge')).toBe('bridge');
  });

  it('is nothing where no participant hears it, or the words spell no option', () => {
    for (const line of ['toll', 'potatoes', 'old-press', '7', 'the'])
      expect(topic(line), line).toBeNull();
    const nobody: Reading = { ...asking, bindings: new Map([['target', { object: GONG }]]) };
    expect(valueOf(role('ask', 'topic', 'sprout'), ['bridge'], nobody, one.draft)).toBeNull();
  });

  it('is the whole number typed, within the range a participant hears', () => {
    expect(number('7')).toBe(7);
    expect(number('12')).toBe(12);
    for (const line of ['13', '0', '-0', 'seven', '7 8', '99999999999999999999']) {
      expect(number(line), line).toBeNull();
    }
  });
});
