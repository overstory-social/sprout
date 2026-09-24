import { describe, expect, it } from 'vitest';

import { typedWords } from '../../declare/addressing.js';
import type { ResolvedRole } from '../../declare/verbs.js';
import {
  BRASS_KEY,
  DOOR,
  GONG,
  IRON_KEY,
  LAMP,
  PEBBLE_A,
  PEBBLE_B,
  study,
  STUDY,
} from '../../fixtures/command.js';
import type { InstanceId } from '../ids.js';
import { addressOf } from './address.js';
import { answersTo, fits, forms, nounIn, nounsOfRun, runIn, type Candidate } from './nouns.js';

const one = study();
const context = { world: one.draft.world, nicknames: one.nicknames };
const candidate = (id: InstanceId): Candidate => {
  const instance = one.draft.instance(id)!;
  return { instance, address: addressOf(instance, context) };
};
const HERE = [BRASS_KEY, IRON_KEY, LAMP, GONG, PEBBLE_A, PEBBLE_B, DOOR].map(candidate);
const role = (verb: string, name: string, library = 'study'): ResolvedRole =>
  STUDY.verbs.qualified(library, verb)!.roles.find((one) => one.name === name)!;
const TAKE = role('take', 'target', 'sprout');
const TOOL = role('unlock', 'tool');
const THINGS = role('juggle', 'things');
const noun = (line: string, as = TAKE) => nounIn(typedWords(line), as, HERE, one.budget);

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

  it('is the one thing that answers and fits', () => {
    expect(noun('this gong')).toEqual({ found: 'one', id: GONG });
    expect(noun('brass key', TOOL)).toEqual({ found: 'one', id: BRASS_KEY });
  });

  it('asks which, nearest first, among things that fit and differ', () => {
    expect(noun('key')).toEqual({ found: 'which', candidates: [BRASS_KEY, IRON_KEY] });
  });

  it('prefers what was named in full, and takes the nearest of things written alike', () => {
    expect(noun('lamp')).toEqual({ found: 'one', id: LAMP });
    expect(noun('pebble')).toEqual({ found: 'one', id: PEBBLE_A });
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

describe('what a set role’s run names', () => {
  const run = (line: string) => runIn(typedWords(line), THINGS, HERE, one.budget);

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

  it('is every thing in the order typed, each once', () => {
    expect(run('lamp and gong and lamp')).toEqual({ found: 'set', ids: [LAMP, GONG] });
  });

  it('is decided by its first noun that names no one thing, with where that noun runs', () => {
    expect(run('gong and key and lamp')).toEqual({
      found: 'which',
      candidates: [BRASS_KEY, IRON_KEY],
      start: 2,
      end: 3,
    });
    expect(run('gong and unicorn')).toEqual({ found: 'nothing', start: 2, end: 3 });
    expect(run('gong and')).toEqual({ found: 'unfit', start: 2, end: 2 });
  });
});
