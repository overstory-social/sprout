import { describe, expect, it } from 'vitest';

import { compiledWorld } from '../../fixtures/bundle.js';
import { declaredId } from '../ids.js';
import { typedPhrasesOf, type TypedPhrase } from './phrases.js';

const SHOP = compiledWorld('shop', {
  'shop.sprout': [
    'world shop is sprout.World { visitors are Person visitors arrive at hall',
    '  object hall is sprout.Place',
    '}',
    'verb take { role target  "Take  [target]"  "snatch [target]" }',
    'verb polish { role target  role cloth  "polish [target] with [cloth]" }',
    'verb dance { }',
  ].join('\n'),
  'person.sprout': 'kind Person is sprout.Visitor { }\n',
});

/** A phrase as a case reads it: whose verb, and its parts. */
const shown = (phrase: TypedPhrase): string =>
  `${phrase.verb.library}.${phrase.verb.name}: ${phrase.parts
    .map((part) =>
      'slot' in part ? `[${phrase.verb.roles[part.slot]!.name}]` : part.words.join(' '),
    )
    .join(' ')}`;

describe('the phrases a visitor may type', () => {
  const phrases = typedPhrasesOf(SHOP.verbs.all(), 'shop').map(shown);

  it('are the world’s own first, then the standard library’s, each verb’s in declared order', () => {
    expect(phrases.slice(0, 3)).toEqual([
      'shop.take: take [target]',
      'shop.take: snatch [target]',
      'shop.polish: polish [target] with [cloth]',
    ]);
    expect(phrases.indexOf('sprout.look: look')).toBeGreaterThan(2);
    expect(phrases).toContain('sprout.examine: look at [target]');
    expect(phrases).toContain('sprout.go: [way]');
  });

  it('leave out a library verb the world’s own verb of its name shadows, and a verb with no phrases', () => {
    expect(phrases.filter((phrase) => phrase.startsWith('sprout.take'))).toEqual([]);
    expect(phrases.some((phrase) => phrase.startsWith('shop.dance'))).toBe(false);
  });

  it('read their words as a typed line is read', () => {
    expect(phrases).toContain('sprout.help: ?');
    expect(phrases[0]).toBe('shop.take: take [target]');
  });
});

describe('the phrases synonyms give', () => {
  const YARD = compiledWorld('yard', {
    'yard.sprout': [
      'world yard is sprout.World { visitors are Person visitors arrive at hall',
      '  object hall is sprout.Place { object chest is sprout.Fixture { synonyms pry: "force" } }',
      '  synonyms pry: "lever"',
      '}',
      'verb pry { role target  "pry [target]"  "use a bar on [target]"  synonyms "prise" }',
    ].join('\n'),
    'person.sprout': 'kind Person is sprout.Visitor { }\n',
  });
  const phrases = typedPhrasesOf(YARD.verbs.all(), 'yard', YARD.synonyms);

  it('follow the verb’s own, its synonyms’ first, then the world’s, then each object’s', () => {
    expect(phrases.filter((one) => one.verb.name === 'pry').map(shown)).toEqual([
      'yard.pry: pry [target]',
      'yard.pry: use a bar on [target]',
      'yard.pry: prise [target]',
      'yard.pry: lever [target]',
      'yard.pry: force [target]',
    ]);
  });

  it('are for an object alone where its synonym gave them, and for anyone otherwise', () => {
    const only = phrases.filter((one) => one.verb.name === 'pry').map((one) => one.only);
    expect(only).toEqual([null, null, null, null, declaredId('yard', ['hall', 'chest'])]);
  });
});
