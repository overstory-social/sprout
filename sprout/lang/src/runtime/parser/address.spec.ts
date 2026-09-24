import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '../../bundle/limits.js';
import {
  BRASS_KEY,
  GONG,
  GUARD,
  IRON_KEY,
  LAMP,
  LAMP_OIL,
  PEBBLE_B,
  study,
  UKULELE,
} from '../../fixtures/parser.js';
import { mintedId, type InstanceId } from '../ids.js';
import { newInstance, type Instance } from '../state.js';
import { addressOf, type Address } from './address.js';

const one = study(['Marta B']);
const context = { world: one.draft.world, nicknames: one.nicknames };
const of = (id: InstanceId): Address => addressOf(one.draft.instance(id)!, context);
const nouns = (address: Address): string[] => address.nouns.map((noun) => noun.join(' '));

/** An instance of the study's `kind` made while the world runs, as a spawn or a kind's content. */
function made(kind: string, how: 'spawned' | 'given'): Instance {
  const ref = one.catalogue.kinds.get(kind)!;
  return newInstance(
    mintedId('study', 90),
    how === 'spawned' ? { from: 'spawned', kind } : { from: 'given', kind, path: ['spare_wick'] },
    ref,
    null,
    null,
    DEFAULT_LIMITS.caps,
  );
}

describe('what a thing is called and answers to', () => {
  it('is its written name, its article `a` unless written, and answers to the name, its last word and every noun, its kind’s first', () => {
    expect(of(BRASS_KEY)).toEqual({
      name: 'brass key',
      article: 'a',
      nouns: [['brass', 'key'], ['key'], ['metal'], ['shiny', 'thing']],
    });
  });

  it('writes `a` as `an` before a vowel where no article is written, and a written article as written', () => {
    expect(of(IRON_KEY).article).toBe('an');
    expect(of(LAMP_OIL).article).toBe('a');
    expect(of(UKULELE)).toMatchObject({ name: 'ukulele', article: 'a' });
  });

  it('is its identifier humanised where it writes no name, and answers to that', () => {
    expect(of(IRON_KEY).name).toBe('iron key');
    expect(nouns(of(LAMP_OIL))).toEqual(['lamp oil', 'oil', 'lamp']);
    expect(of(LAMP).article).toBe('the');
  });

  it('answers to its identifier beside a name written otherwise', () => {
    expect(of(GONG)).toMatchObject({ name: 'brass disc', article: 'the' });
    expect(nouns(of(GONG))).toEqual(['brass disc', 'disc', 'gong']);
  });

  it('takes a name its kind writes, and keeps the case a name is written in', () => {
    expect(of(PEBBLE_B).name).toBe('pebble');
    expect(of(GUARD)).toMatchObject({ name: 'Oskar', article: 'none' });
    expect(nouns(of(GUARD))).toEqual(['oskar', 'guard']);
  });

  it('is its kind’s name humanised for a spawn, which has no identifier, and a content’s identifier', () => {
    expect(addressOf(made('study.Gong', 'spawned'), context)).toEqual({
      name: 'gong',
      article: 'a',
      nouns: [['gong']],
    });
    expect(nouns(addressOf(made('study.Pebble', 'spawned'), context))).toEqual(['pebble']);
    expect(addressOf(made('study.Coin', 'given'), context).name).toBe('spare wick');
  });

  it('is a visitor’s nickname, with no article, answering to the whole of it', () => {
    expect(of(one.people[0]!)).toEqual({
      name: 'Marta B',
      article: 'none',
      nouns: [['marta', 'b']],
    });
  });
});
