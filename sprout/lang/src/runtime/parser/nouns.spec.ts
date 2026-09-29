import { describe, expect, it } from 'vitest';

import { typedWords } from '../../declare/addressing.js';
import type { ResolvedRole } from '../../declare/verbs.js';
import {
  BRASS_KEY,
  CHEST,
  COIN,
  DOOR,
  GONG,
  IRON_KEY,
  LAMP,
  PEBBLE_A,
  PEBBLE_B,
  study,
  STUDY,
} from '../../fixtures/parser.js';
import type { InstanceId } from '../ids.js';
import { addressOf } from './address.js';
import { answersTo, fits, forms, nounIn, nounsOfRun, runIn, type Candidate } from './nouns.js';

const one = study();
const context = { world: one.draft.world, nicknames: one.nicknames };
/** `id` as a noun may name it, everything in the hall equally near unless a case says otherwise. */
const candidate = (id: InstanceId, near = 2): Candidate => {
  const instance = one.draft.instance(id)!;
  return { instance, address: addressOf(instance, context), near };
};
// Each nearer than the next, as the list is ordered.
const HERE = [BRASS_KEY, IRON_KEY, LAMP, GONG, PEBBLE_A, PEBBLE_B, DOOR].map(candidate);
const role = (verb: string, name: string, library = 'study'): ResolvedRole =>
  STUDY.verbs.qualified(library, verb)!.roles.find((one) => one.name === name)!;
const TAKE = role('take', 'target', 'sprout');
const TOOL = role('unlock', 'tool');
const THINGS = role('juggle', 'things');
const within = { budget: one.budget };
const noun = (line: string, as = TAKE) => nounIn(typedWords(line), as, HERE, within);

describe('what a noun names', () => {
  it('is tried as typed and without a leading article or determiner', () => {
    expect(forms(['the', 'brass', 'key'])).toEqual([
      ['the', 'brass', 'key'],
      ['brass', 'key'],
    ]);
    expect(forms(['the'])).toEqual([['the']]);
    expect(forms(['key'])).toEqual([['key']]);
    expect(answersTo(['my', 'brass', 'key'], candidate(BRASS_KEY).address)).toBe('name');
    expect(answersTo(['metal'], candidate(BRASS_KEY).address)).toBe('noun');
    expect(answersTo(['iron'], candidate(BRASS_KEY).address)).toBeNull();
  });

  it('is every thing that answers and fits, with how near it is and how many words it matched', () => {
    expect(noun('this gong')).toEqual({
      found: 'some',
      things: [{ id: GONG, near: 3, literal: 1 }],
    });
    expect(noun('brass key', TOOL)).toEqual({
      found: 'some',
      things: [{ id: BRASS_KEY, near: 0, literal: 2 }],
    });
    // The parser ranks the readings they make; nothing is asked, and nothing is drawn here.
    expect(noun('key')).toEqual({
      found: 'some',
      things: [
        { id: BRASS_KEY, near: 0, literal: 1 },
        { id: IRON_KEY, near: 1, literal: 1 },
      ],
    });
    const alike = [candidate(PEBBLE_A), candidate(PEBBLE_B, 1)];
    expect(nounIn(['pebble'], TAKE, alike, within)).toEqual({
      found: 'some',
      things: [
        { id: PEBBLE_A, near: 2, literal: 1 },
        { id: PEBBLE_B, near: 1, literal: 1 },
      ],
    });
  });

  it('prefers what was named in full', () => {
    expect(noun('lamp')).toEqual({ found: 'some', things: [{ id: LAMP, near: 2, literal: 1 }] });
  });

  it('is unfit where what answers cannot fill the role, and nothing where nothing answers', () => {
    expect(noun('gong', TOOL)).toEqual({ found: 'unfit' });
    expect(noun('unicorn')).toEqual({ found: 'nothing' });
    expect(fits(TOOL, candidate(IRON_KEY).instance)).toBe(true);
    expect(fits(TOOL, candidate(DOOR).instance)).toBe(false);
    expect(fits(TAKE, candidate(DOOR).instance)).toBe(true);
  });

  it('charges one step for every candidate it is tried against', () => {
    const before = one.budget.spentSteps;
    noun('gong');
    expect(one.budget.spentSteps - before).toBe(HERE.length);
  });
});

describe('a name of adjectives, and a relative phrase', () => {
  it('names a thing by adjectives alone weakly, matching no word literally', () => {
    expect(answersTo(['brass'], candidate(BRASS_KEY).address)).toBe('adjective');
    expect(answersTo(['brass', 'key'], candidate(BRASS_KEY).address)).toBe('name');
    expect(answersTo(['brass', 'metal'], candidate(BRASS_KEY).address)).toBe('noun');
    expect(answersTo(['metal', 'brass'], candidate(BRASS_KEY).address)).toBeNull();
    expect(noun('brass')).toEqual({
      found: 'some',
      things: [
        { id: BRASS_KEY, near: 0, literal: 0 },
        { id: GONG, near: 3, literal: 0 },
      ],
    });
  });

  it('names what stands directly in what the words after `in` or `on` name, counting every word', () => {
    const held = [...HERE, candidate(CHEST, 7), candidate(COIN, 8)];
    const named = (line: string) => nounIn(typedWords(line), TAKE, held, within);
    for (const line of ['coin in chest', 'the coin on the chest', 'coin that is in the chest']) {
      expect(named(line), line).toMatchObject({ found: 'some', things: [{ id: COIN, near: 8 }] });
    }
    expect(named('coin that is in the chest')).toEqual({
      found: 'some',
      things: [{ id: COIN, near: 8, literal: 5 }],
    });
    expect(named('the one in the chest')).toEqual({
      found: 'some',
      things: [{ id: COIN, near: 8, literal: 3 }],
    });
    // The keys are not in the chest, and nothing is in the gong.
    expect(named('key in chest')).toEqual({ found: 'nothing' });
    expect(named('one in gong')).toEqual({ found: 'nothing' });
  });
});

describe('what a set role’s run names', () => {
  const run = (line: string) => runIn(typedWords(line), THINGS, HERE, within);

  it('splits on `and` and commas, a comma before `and` one split', () => {
    const at = (line: string) =>
      nounsOfRun(typedWords(line)).map(({ start, end }) =>
        typedWords(line).slice(start, end).join(' '),
      );
    expect(at('gong and lamp')).toEqual(['gong', 'lamp']);
    expect(at('gong, lamp, and brass key')).toEqual(['gong', 'lamp', 'brass key']);
    expect(at('gong and')).toEqual(['gong', '']);
    expect(at(', gong')).toEqual(['', 'gong']);
    expect(at('gong , , lamp')).toEqual(['gong', '', 'lamp']);
  });

  it('is every set its nouns make, each thing once, in the order typed', () => {
    expect(run('lamp and gong and lamp')).toEqual({
      found: 'sets',
      sets: [{ ids: [LAMP, GONG], near: 7, literal: 3 }],
    });
    // A noun that names two things makes a set with each.
    expect(run('gong and key')).toEqual({
      found: 'sets',
      sets: [
        { ids: [GONG, BRASS_KEY], near: 3, literal: 2 },
        { ids: [GONG, IRON_KEY], near: 4, literal: 2 },
      ],
    });
  });

  it('is decided by its first noun that names nothing it may take, with where that noun runs', () => {
    expect(run('gong and unicorn')).toEqual({ found: 'nothing', start: 2, end: 3 });
    expect(run('gong and')).toEqual({ found: 'unfit', start: 2, end: 2 });
  });
});
