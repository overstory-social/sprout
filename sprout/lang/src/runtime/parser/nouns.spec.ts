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
} from '../../fixtures/parser.js';
import { Draws } from '../draws.js';
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
const HERE = [BRASS_KEY, IRON_KEY, LAMP, GONG, PEBBLE_A, PEBBLE_B, DOOR].map(candidate);
const role = (verb: string, name: string, library = 'study'): ResolvedRole =>
  STUDY.verbs.qualified(library, verb)!.roles.find((one) => one.name === name)!;
const TAKE = role('take', 'target', 'sprout');
const TOOL = role('unlock', 'tool');
const THINGS = role('juggle', 'things');
const draws = new Draws(7);
const within = { budget: one.budget, draws };
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

  it('is the one thing that answers and fits', () => {
    expect(noun('this gong')).toEqual({ found: 'one', id: GONG });
    expect(noun('brass key', TOOL)).toEqual({ found: 'one', id: BRASS_KEY });
  });

  it('asks which, nearest first, among things that fit and differ', () => {
    expect(noun('key')).toEqual({ found: 'which', candidates: [BRASS_KEY, IRON_KEY] });
  });

  it('prefers what was named in full', () => {
    expect(noun('lamp')).toEqual({ found: 'one', id: LAMP });
  });

  it('takes the nearest of things written alike, drawing nothing', () => {
    const fresh = new Draws(7);
    const nearer = [candidate(PEBBLE_A), candidate(PEBBLE_B, 1)];
    const found = nounIn(['pebble'], TAKE, nearer, { budget: one.budget, draws: fresh });
    expect(found).toEqual({ found: 'one', id: PEBBLE_B });
    expect(fresh.drawn).toBe(0);
  });

  it('draws from the turn’s seed among things written alike and equally near, one step', () => {
    const alike = [candidate(PEBBLE_A), candidate(PEBBLE_B)];
    const taken = (seed: number) => {
      const stream = new Draws(seed);
      const before = one.budget.spentSteps;
      const found = nounIn(['pebble'], TAKE, alike, { budget: one.budget, draws: stream });
      expect(one.budget.spentSteps - before, `seed ${seed}`).toBe(alike.length + 1);
      expect(stream.drawn, `seed ${seed}`).toBe(1);
      return found.found === 'one' ? found.id : null;
    };
    const seeds = Array.from({ length: 32 }, (_, seed) => seed);
    for (const seed of seeds) expect(taken(seed), `seed ${seed}`).toBe(taken(seed));
    // Either may be meant, as the seed decides, and never anything else.
    expect(new Set(seeds.map(taken))).toEqual(new Set([PEBBLE_A, PEBBLE_B]));
  });

  it('draws nothing where one thing answers or the visitor is asked which', () => {
    const fresh = new Draws(7);
    const context = { budget: one.budget, draws: fresh };
    nounIn(['gong'], TAKE, HERE, context);
    nounIn(['key'], TAKE, HERE, context);
    expect(fresh.drawn).toBe(0);
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
