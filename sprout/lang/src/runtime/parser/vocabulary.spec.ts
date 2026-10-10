import { describe, expect, it } from 'vitest';

import { compiledWorld } from '../../fixtures/bundle.js';
import { turn } from '../../fixtures/reading.js';
import { declaredId, type InstanceId } from '../ids.js';
import { addressOf } from './address.js';
import { inVocabulary, worldWords } from './vocabulary.js';

// A thing in reach, one shut away in a chest, one in another place, and one of a named kind.
const ATTIC = compiledWorld('attic', {
  'attic.sprout': [
    'world attic is sprout.World { visitors are Person visitors arrive at loft',
    '  object loft is sprout.Place {',
    '    object lamp is sprout.Fixture { grammar { name "brass lamp"  nouns "lantern"  adjectives "dented" } }',
    '    object chest is sprout.Container { :open false  object locket is sprout.Fixture }',
    '  }',
    '  object cellar is sprout.Place { object barrel is SpiceJar }',
    '}',
    'kind SpiceJar { }',
  ].join('\n'),
  'person.sprout': 'kind Person is sprout.Visitor { }\n',
});

function wordsOf() {
  const one = turn(ATTIC, [declaredId('attic', ['loft'])]);
  const address = (id: InstanceId) =>
    addressOf(one.draft.instance(id)!, { world: one.draft.world, nicknames: new Map() });
  const before = one.budget.spentSteps;
  const words = worldWords({ state: one.draft, address, budget: one.budget });
  return { words, steps: one.budget.spentSteps - before };
}

describe('the words a noun may hold in the world', () => {
  it('are every name, noun and adjective of every thing, in reach or not, and its kinds’ names', () => {
    const { words } = wordsOf();
    for (const word of ['brass', 'lamp', 'lantern', 'dented', 'locket', 'barrel', 'spice', 'jar']) {
      expect(words.has(word), word).toBe(true);
    }
    expect(words.has('unicorn')).toBe(false);
  });

  it('are the parser’s own a noun may hold, but not `again` or `then`', () => {
    const { words } = wordsOf();
    for (const word of [
      'the',
      'my',
      'and',
      ',',
      'in',
      'on',
      'that',
      'it',
      'them',
      'all',
      'except',
    ]) {
      expect(words.has(word), word).toBe(true);
    }
    expect(words.has('again')).toBe(false);
    expect(words.has('then')).toBe(false);
  });

  it('cost a step for each thing in the world', () => {
    expect(wordsOf().steps).toBeGreaterThanOrEqual(6);
  });

  it('hold a noun only where every one of its words is one', () => {
    const { words } = wordsOf();
    expect(inVocabulary(['the', 'barrel', 'in', 'the', 'chest'], words)).toBe(true);
    expect(inVocabulary(['the', 'lamp', 'again'], words)).toBe(false);
  });
});
