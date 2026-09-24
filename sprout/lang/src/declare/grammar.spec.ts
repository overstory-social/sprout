import { describe, expect, it } from 'vitest';

import type { KindDeclaration } from '../syntax/ast.js';
import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { Diagnostics } from '../source/diagnostics.js';
import { locationOf, SourceFile } from '../source/source.js';
import { parseDeclarations } from '../syntax/parse.js';
import { EnumTable } from './enums.js';
import {
  checkGrammar,
  composeGrammar,
  NO_GRAMMAR,
  ownGrammar,
  type ComposedGrammar,
} from './grammar.js';
import { KindTable, type KindRef } from './kinds.js';

function parsed(text: string) {
  const diagnostics = new Diagnostics();
  const declared = parseDeclarations(new SourceFile('k.sprout', text), diagnostics);
  return {
    kinds: declared.filter((d): d is KindDeclaration => d.kind === 'kind'),
    diagnostics,
  };
}

/** What the first tier says of each kind's grammar lines, under `caps`. */
function checked(text: string, caps = DEFAULT_LIMITS.caps) {
  const { kinds, diagnostics } = parsed(text);
  for (const kind of kinds) checkGrammar(kind, caps, diagnostics);
  return diagnostics.refusals.map((d) => [locationOf(d.at), d.message, d.remedy]);
}

/** Every kind in `text`, composed. */
function composed(text: string) {
  const { kinds: declared, diagnostics } = parsed(text);
  const kinds = new KindTable();
  kinds.add('shop', declared, diagnostics);
  kinds.resolve('shop', new EnumTable(), diagnostics);
  return {
    grammar: (name: string): ComposedGrammar => kinds.qualified('shop', name)!.grammar,
    kind: (name: string): KindRef => kinds.qualified('shop', name)!,
    said: diagnostics.refusals.map((d) => [locationOf(d.at), d.message, d.remedy]),
  };
}

const values = (grammar: ComposedGrammar) => ({
  name: grammar.name === null ? null : [grammar.name.value, grammar.name.origin],
  article: grammar.article === null ? null : [grammar.article.value, grammar.article.origin],
  nouns: grammar.nouns,
});

describe('one body’s grammar lines, in the first tier', () => {
  it('say nothing of a block written well, however many blocks hold it', () => {
    expect(
      checked('kind Key { grammar { name "brass key" } grammar { article the  nouns "brass" } }'),
    ).toEqual([]);
  });

  it('refuse a name that begins with an article, saying the name without it', () => {
    expect(checked('kind Key { grammar { name "The Brass Key" } }')).toEqual([
      [
        'k.sprout:1:22',
        'A name never begins with an article, and `The Brass Key` begins with `The`.',
        'Write `name "Brass Key"`, and say the article on its own line: `article the`.',
      ],
    ]);
    expect(checked('kind Key { grammar { name "an" } }')[0]![2]).toBe(
      'Write the name without it, and say the article on its own line: `article an`.',
    );
    // A word that only starts with one is no article.
    expect(checked('kind Key { grammar { name "anvil" } }')).toEqual([]);
    expect(checked('kind Key { grammar { name "theatre ticket" } }')).toEqual([]);
  });

  it('refuse a name or an article written twice, at the second', () => {
    expect(
      checked('kind Key { grammar { name "a1" } grammar { name "b"  article a  article the } }'),
    ).toEqual([
      [
        'k.sprout:1:44',
        '`Key` writes its `name` twice.',
        'A thing has one name. Keep one `name` line.',
      ],
      [
        'k.sprout:1:65',
        '`Key` writes its `article` twice.',
        'A thing is written with one article. Keep one `article` line.',
      ],
    ]);
  });

  it('refuse an empty name and an empty noun', () => {
    expect(
      checked('kind Key { grammar { name " "  nouns "brass" "" } }').map((said) => said[1]),
    ).toEqual(["`Key`'s name is empty.", 'This noun is empty.']);
  });

  it('hold the nouns to the host’s cap, said once at the first past it', () => {
    const caps = { ...DEFAULT_LIMITS.caps, nounsPerObject: 2 };
    expect(checked('kind Key { grammar { nouns "a" "b" } }', caps)).toEqual([]);
    expect(
      checked('kind Key { grammar { nouns "a" "b" } grammar { nouns "c" "d" } }', caps),
    ).toEqual([
      [
        'k.sprout:1:54',
        '`Key` writes more than 2 nouns, and 2 is as many as a thing may have.',
        'Keep the ones a visitor is most likely to type: its name and the last word of it are nouns already.',
      ],
    ]);
  });

  it('hold each word of a name and a noun to the host’s cap on its characters', () => {
    const caps = { ...DEFAULT_LIMITS.caps, nounCharacters: 5 };
    expect(checked('kind Key { grammar { name "brass key"  nouns "iron" } }', caps)).toEqual([]);
    expect(checked('kind Key { grammar { name "golden key"  nouns "keyring" } }', caps)).toEqual([
      [
        'k.sprout:1:22',
        '`golden` is 6 characters long, and 5 is as long as a word a thing answers to may be.',
        'Use a shorter word: it is one a visitor types.',
      ],
      [
        'k.sprout:1:47',
        '`keyring` is 7 characters long, and 5 is as long as a word a thing answers to may be.',
        'Use a shorter word: it is one a visitor types.',
      ],
    ]);
  });
});

describe('a composed grammar', () => {
  it('takes a composer’s own name and article, and every noun, its own last and each once', () => {
    const { grammar, said } = composed(
      [
        'kind Metal { grammar { nouns "metal" "Brass" } }',
        'kind Named { grammar { name "old key"  article the } }',
        'kind Key is Metal, Named { grammar { name "brass key"  nouns "brass" "ring" } }',
      ].join('\n'),
    );
    expect(said).toEqual([]);
    expect(values(grammar('Key'))).toEqual({
      name: ['brass key', 'shop.Key'],
      article: ['the', 'shop.Named'],
      nouns: ['metal', 'Brass', 'ring'],
    });
  });

  it('takes one source’s name through every path to it', () => {
    const { grammar, said } = composed(
      [
        'kind Base { grammar { name "thing" } }',
        'kind Left is Base { }',
        'kind Right is Base { }',
        'kind Both is Left, Right { }',
      ].join('\n'),
    );
    expect(said).toEqual([]);
    expect(values(grammar('Both')).name).toEqual(['thing', 'shop.Base']);
  });

  it('refuses a name and an article from two sources, at the kind that brought the second', () => {
    const { said, grammar } = composed(
      [
        'kind Brass { grammar { name "brass token"  article the } }',
        'kind Coin { grammar { name "coin"  article a } }',
        'kind Token is Brass, Coin { }',
        'kind Mine is Brass, Coin { grammar { name "token"  article a } }',
      ].join('\n'),
    );
    expect(said).toEqual([
      [
        'k.sprout:3:22',
        '`Token` gets its `name` from both `Brass` and `Coin`, and a thing has one.',
        'Write `grammar { name "…" }` in `Token` to say what it is called.',
      ],
      [
        'k.sprout:3:22',
        '`Token` gets its `article` from both `Brass` and `Coin`, and a thing has one.',
        'Write `grammar { article … }` in `Token` to say which it is written with.',
      ],
    ]);
    // The composer's own replaces both, and nothing is said.
    expect(values(grammar('Mine'))).toMatchObject({
      name: ['token', 'shop.Mine'],
      article: ['a', 'shop.Mine'],
    });
  });

  it('checks a body’s exits and links with its other lines, in the first tier', () => {
    expect(
      checked('kind Wardrobe { grammar { name "wardrobe"  exit through "coats" -> narnia } }'),
    ).toEqual([
      [
        'k.sprout:1:49',
        '`through` is not a direction. A way out leads `north`, `south`, `east`, `west`, `northeast`, `northwest`, `southeast`, `southwest`, `up`, `down`, `in` or `out`.',
        'Write one of those, and say the rest in the label, as in `exit in "coats" -> narnia`.',
      ],
    ]);
  });

  it('is nothing at all where no source writes a line', () => {
    const { members } = parsed('kind Plain { :a 1 }').kinds[0]!;
    expect(ownGrammar(members, 'shop.Plain')).toEqual(NO_GRAMMAR);
    expect(composeGrammar('Plain', [], NO_GRAMMAR, (o) => o, new Diagnostics())).toEqual(
      NO_GRAMMAR,
    );
  });
});
