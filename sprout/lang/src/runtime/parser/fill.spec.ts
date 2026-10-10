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
import type { InstanceId } from '../ids.js';
import type { Reading } from '../reading.js';
import { addressOf } from './address.js';
import { fillIntentSlot, fillSlot, valueOf } from './fill.js';

const one = study();
const addressing = { world: one.draft.world, nicknames: one.nicknames };
/** What the one typing can reach, everything equally near, and carrying what `carried` names. */
const reaching = (carried: readonly InstanceId[] = []) =>
  [BRASS_KEY, IRON_KEY, GONG, GUARD, DIAL].map((id: InstanceId) => {
    const instance = one.draft.instance(id)!;
    const address = addressOf(instance, addressing);
    return { instance, address, near: 2, carried: carried.includes(id) };
  });
const candidates = reaching();
const context = {
  candidates,
  exits: EXITS,
  labels: new Set(['through the window']),
  budget: one.budget,
  referents: [],
};
const verb = (name: string, library = 'study') => STUDY.verbs.qualified(library, name)!;
const role = (verbName: string, name: string, library = 'study'): ResolvedRole =>
  verb(verbName, library).roles.find((one) => one.name === name)!;
const fill = (r: ResolvedRole, line: string) => fillSlot(r, typedWords(line), context);

describe('what a slot’s words fill its role with', () => {
  it('is each thing for a thing role, and a set, even of one, for a set role', () => {
    expect(fill(role('take', 'target', 'sprout'), 'gong')).toEqual({
      fills: 'options',
      options: [{ bound: { object: GONG }, near: 2, literal: 1, byName: 0 }],
    });
    expect(fill(role('juggle', 'things'), 'gong')).toEqual({
      fills: 'options',
      options: [{ bound: { set: [GONG] }, near: 2, literal: 1, byName: 0 }],
    });
    expect(fill(role('juggle', 'things'), 'gong and brass key')).toEqual({
      fills: 'options',
      options: [{ bound: { set: [GONG, BRASS_KEY] }, near: 4, literal: 3, byName: 1 }],
    });
  });

  it('is a run for a thing role given several nouns: the first item’s things, and each item after it', () => {
    expect(fill(role('take', 'target', 'sprout'), 'gong, dial and the unicorn')).toEqual({
      fills: 'run',
      options: [{ bound: { object: GONG }, near: 2, literal: 1, byName: 0 }],
      later: [
        {
          start: 2,
          end: 3,
          filled: {
            fills: 'options',
            options: [{ bound: { object: DIAL }, near: 2, literal: 1, byName: 1 }],
          },
        },
        { start: 4, end: 6, filled: { fills: 'nothing', start: 0, end: 2 } },
      ],
    });
  });

  it('says where a run’s first item runs where it names nothing', () => {
    expect(fill(role('take', 'target', 'sprout'), 'gong and unicorn')).toMatchObject({
      fills: 'run',
    });
    expect(fill(role('take', 'target', 'sprout'), 'the unicorn and gong')).toEqual({
      fills: 'nothing',
      start: 0,
      end: 2,
    });
  });

  it('is every thing a noun may name, for the readings they make to be ranked', () => {
    expect(fill(role('take', 'target', 'sprout'), 'the key')).toEqual({
      fills: 'options',
      options: [
        { bound: { object: BRASS_KEY }, near: 2, literal: 1, byName: 0 },
        { bound: { object: IRON_KEY }, near: 2, literal: 1, byName: 0 },
      ],
    });
  });

  it('is the exit named for an exit role, and does not match where none is', () => {
    expect(fill(role('go', 'way', 'sprout'), 'n')).toEqual({
      fills: 'options',
      options: [{ bound: { exit: EXITS[0] }, near: 0, literal: 1, byName: 0 }],
    });
    expect(fill(role('go', 'way', 'sprout'), 'gong')).toEqual({ fills: 'unfit', things: [] });
  });

  it('names nothing, for an exit role, by the label of a way out in the world that does not apply', () => {
    expect(fill(role('go', 'way', 'sprout'), 'through the window')).toEqual({
      fills: 'nothing',
      start: 0,
      end: 3,
    });
    expect(fill(role('go', 'way', 'sprout'), 'through the door')).toEqual({
      fills: 'unfit',
      things: [],
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

describe('what a carried role’s words fill it with', () => {
  const carriedRole = (verbName: string, name: string, library = 'study'): ResolvedRole => ({
    ...role(verbName, name, library),
    carried: true,
  });
  const holding = (carried: readonly InstanceId[], r: ResolvedRole, line: string) =>
    fillSlot(r, typedWords(line), { ...context, candidates: reaching(carried) });

  it('is only what is carried, where something carried answers, and an outward thing never competes', () => {
    expect(holding([IRON_KEY], carriedRole('unlock', 'tool'), 'key')).toEqual({
      fills: 'options',
      options: [{ bound: { object: IRON_KEY }, near: 2, literal: 1, byName: 0 }],
    });
  });

  it('is outward, each thing further out that fills it, where nothing carried answers', () => {
    expect(holding([], carriedRole('unlock', 'tool'), 'key')).toEqual({
      fills: 'outward',
      things: [
        { bound: { object: BRASS_KEY }, near: 2, literal: 1, byName: 0 },
        { bound: { object: IRON_KEY }, near: 2, literal: 1, byName: 0 },
      ],
    });
    expect(holding([GONG], carriedRole('unlock', 'tool'), 'brass key')).toEqual({
      fills: 'outward',
      things: [{ bound: { object: BRASS_KEY }, near: 2, literal: 2, byName: 1 }],
    });
  });

  it('is unfit where what answers cannot fill it, carried or not, and nothing where nothing answers', () => {
    expect(holding([GONG], carriedRole('unlock', 'tool'), 'gong')).toEqual({
      fills: 'unfit',
      things: [{ bound: { object: GONG }, near: 2, literal: 1, byName: 0 }],
    });
    expect(holding([], carriedRole('unlock', 'tool'), 'gong')).toEqual({
      fills: 'unfit',
      things: [{ bound: { object: GONG }, near: 2, literal: 1, byName: 0 }],
    });
    expect(holding([BRASS_KEY], carriedRole('unlock', 'tool'), 'anvil')).toEqual({
      fills: 'nothing',
      start: 0,
      end: 1,
    });
  });

  it('is a set of what is carried for a set role, and outward naming the first thing not carried', () => {
    const things = carriedRole('juggle', 'things');
    expect(holding([GONG, BRASS_KEY], things, 'gong and brass key')).toEqual({
      fills: 'options',
      options: [{ bound: { set: [GONG, BRASS_KEY] }, near: 4, literal: 3, byName: 1 }],
    });
    expect(holding([GONG], things, 'gong and brass key')).toEqual({
      fills: 'outward',
      things: [{ bound: { object: BRASS_KEY }, near: 4, literal: 3, byName: 1 }],
    });
  });

  it('is filled the same for an intent’s slot given to a carried role in any step', () => {
    const roles = [carriedRole('unlock', 'tool'), role('turn', 'target')];
    const fillIntent = (carried: readonly InstanceId[], line: string) =>
      fillIntentSlot(roles, typedWords(line), { ...context, candidates: reaching(carried) });
    expect(fillIntent([BRASS_KEY], 'metal')).toEqual({
      fills: 'options',
      options: [{ bound: { object: BRASS_KEY }, near: 2, literal: 1, byName: 0 }],
    });
    expect(fillIntent([], 'metal')).toMatchObject({ fills: 'outward' });
  });
});

describe('what an intent’s slot is filled with', () => {
  const roles = [role('unlock', 'tool'), role('turn', 'target')];
  const fillIntent = (line: string) => fillIntentSlot(roles, typedWords(line), context);

  it('is each thing its words name that fits any role the slot is given to', () => {
    expect(fillIntent('metal')).toEqual({
      fills: 'options',
      options: [
        { bound: { object: BRASS_KEY }, near: 2, literal: 1, byName: 0 },
        { bound: { object: IRON_KEY }, near: 2, literal: 1, byName: 0 },
      ],
    });
    expect(fillIntent('dial')).toEqual({
      fills: 'options',
      options: [{ bound: { object: DIAL }, near: 2, literal: 1, byName: 1 }],
    });
  });

  it('is unfit where what the words name fits none of its roles, and nothing where they name nothing', () => {
    expect(fillIntent('gong')).toEqual({
      fills: 'unfit',
      things: [{ bound: { object: GONG }, near: 2, literal: 1, byName: 0 }],
    });
    expect(fillIntent('zebra')).toEqual({ fills: 'nothing', start: 0, end: 1 });
  });
});
