import { describe, expect, it } from 'vitest';

import { compiledWorld } from '../fixtures/bundle.js';
import { STUDY } from '../fixtures/parser.js';
import { WAYS } from '../fixtures/exits.js';
import { wordSetOf } from './words.js';

describe('the world’s word set', () => {
  const words = new Set(STUDY.words);

  it('holds each word of every name and noun written, of every identifier, and of every name a spawn is called by', () => {
    // Written names and nouns, an object's and a kind's.
    for (const word of ['brass', 'key', 'shiny', 'thing', 'disc', 'oskar', 'metal', 'pebble']) {
      expect(words.has(word), word).toBe(true);
    }
    // Identifiers, humanised, and a kind's name as a spawn of it is called.
    for (const word of ['iron', 'lamp', 'oil', 'gong', 'barrel', 'coin', 'dial', 'door']) {
      expect(words.has(word), word).toBe(true);
    }
    // A kind nothing spawns is called by no default: the visitor kind is a person's.
    expect(words.has('place')).toBe(true);
    expect(words.has('person')).toBe(false);
    expect(words.has('world')).toBe(false);
  });

  it('holds each word of every exit’s and link’s label', () => {
    const ways = new Set(WAYS.words);
    for (const word of ['toward', 'grey', 'light', 'daylight', 'deeper', 'dark', 'came']) {
      expect(ways.has(word), word).toBe(true);
    }
    expect(words.has('daylight')).toBe(false);
  });

  it('holds the directions and their abbreviations, the articles, determiners and connectors', () => {
    for (const word of [
      'north',
      'ne',
      'up',
      'd',
      'in',
      'out',
      'a',
      'an',
      'the',
      'my',
      'this',
      'that',
      'and',
    ]) {
      expect(words.has(word), word).toBe(true);
    }
  });

  it('holds every word of every phrase, the standard library’s and the world’s', () => {
    for (const word of [
      'take',
      'pick',
      'up',
      'look',
      'at',
      'x',
      '?',
      'juggle',
      'unlock',
      'with',
      'turn',
      'to',
    ]) {
      expect(words.has(word), word).toBe(true);
    }
  });

  it('is single words, sorted and each once, and never a comma', () => {
    expect([...STUDY.words]).toEqual([...words].sort());
    expect(STUDY.words.every((word) => !word.includes(' ') && word !== ',')).toBe(true);
    expect(words.has('unicorn')).toBe(false);
  });

  it('is drawn from what it is given and nothing else beside the fixed words', () => {
    const fixed = wordSetOf({ kinds: [], named: [], identifiers: [], verbs: [] });
    expect(fixed).toContain('north');
    expect(fixed).not.toContain('take');
    const shop = compiledWorld('shop', {
      'world.sprout':
        'world shop is sprout.World { visitors are Person visitors arrive at hall\n  object hall is sprout.Place { object old_bench is Bench }\n}\n',
      'person.sprout': 'kind Person is sprout.Visitor { }\n',
      'bench.sprout': 'kind Bench { grammar { nouns "seat" } }\n',
    });
    for (const word of ['old', 'bench', 'seat', 'hall']) expect(shop.words, word).toContain(word);
  });
});
