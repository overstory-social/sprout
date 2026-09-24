import { describe, expect, it } from 'vitest';

import {
  CONNECTORS,
  defaultArticle,
  defaultNouns,
  DETERMINERS,
  humanisedIdentifier,
  humanisedKind,
  typedWords,
} from './addressing.js';

describe('words as a visitor types them', () => {
  it('are lower case, split on white space, a comma a word of its own', () => {
    expect(typedWords('  Take the BRASS\tkey ')).toEqual(['take', 'the', 'brass', 'key']);
    expect(typedWords('juggle gong,lamp , and key')).toEqual([
      'juggle',
      'gong',
      ',',
      'lamp',
      ',',
      'and',
      'key',
    ]);
    expect(typedWords('')).toEqual([]);
    expect(typedWords('?')).toEqual(['?']);
  });

  it('take the spec’s articles and determiners as optional, and split a run on `and` and commas', () => {
    expect(DETERMINERS).toEqual(['a', 'an', 'the', 'my', 'this', 'that']);
    expect(CONNECTORS).toEqual(['and', ',']);
  });
});

describe('what a thing is called where nothing says', () => {
  it('is its identifier humanised', () => {
    expect(humanisedIdentifier('oak_door')).toBe('oak door');
    expect(humanisedIdentifier('lamp')).toBe('lamp');
  });

  it('is its kind’s name humanised in lower case, for a thing with no identifier', () => {
    expect(humanisedKind('MazeCell')).toBe('maze cell');
    expect(humanisedKind('Lamp')).toBe('lamp');
    expect(humanisedKind('TVSet')).toBe('tv set');
    expect(humanisedKind('Room2B')).toBe('room2 b');
  });

  it('takes `a`, and `an` before a name whose first letter is a, e, i, o or u in either case', () => {
    expect(['apple', 'Echo', 'iron key', 'Oskar', 'urn'].map(defaultArticle)).toEqual([
      'an',
      'an',
      'an',
      'an',
      'an',
    ]);
    expect(['brass key', 'yew', 'hour', '', '1 coin'].map(defaultArticle)).toEqual([
      'a',
      'a',
      'a',
      'a',
      'a',
    ]);
  });

  it('answers to its full name and the last word of it', () => {
    expect(defaultNouns('brass key')).toEqual(['brass key', 'key']);
    expect(defaultNouns('Brass  Key')).toEqual(['brass key', 'key']);
    expect(defaultNouns('lamp')).toEqual(['lamp']);
  });
});
