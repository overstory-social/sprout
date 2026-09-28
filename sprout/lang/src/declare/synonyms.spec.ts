import { describe, expect, it } from 'vitest';

import { readFile } from '../bundle/compile/reading.js';
import { limitsFrom } from '../bundle/limits.js';
import { compiledWorld, compileWorld } from '../fixtures/bundle.js';
import { locationOf, SourceFile } from '../source/source.js';
import { synonymPhrases, withSynonym } from './synonyms.js';

type Part = { readonly part: 'words'; readonly text: string } | { readonly part: 'slot' };

const words = (text: string): Part => ({ part: 'words', text });
const SLOT: Part = { part: 'slot' };

/** A world whose verbs are `verbs`, with `world` in its body and `chest` in the hall's. */
function shop(verbs: string, world = '', chest = '') {
  return {
    'shop.sprout': `world shop is sprout.World {
  visitors are Person
  visitors arrive at hall
  ${world}
  object hall is sprout.Place {
    object chest is sprout.Fixture { ${chest} }
    object crate is sprout.Fixture
  }
}
`,
    'person.sprout': 'kind Person is sprout.Visitor { }\n',
    'verbs.sprout': verbs,
  };
}

const PRY =
  'verb pry { role target  "pry [target]"  "pry at [target]"  "use a bar on [target]" }\n';

/** What compiling `files` refused, as `file:line:col message`. */
const refusedIn = (files: Record<string, string>) =>
  compileWorld('shop', files).diagnostics.flatMap((d) =>
    d.severity === 'refusal' ? [`${locationOf(d.at)} ${d.message}`] : [],
  );

describe('what a synonym gives a phrase', () => {
  it('is the phrase with the verb’s name replaced by its words, wherever the name is written', () => {
    expect(withSynonym([words('open'), SLOT], 'open', 'prise open')).toEqual([
      words('prise open'),
      SLOT,
    ]);
    expect(withSynonym([words('Open it and open'), SLOT], 'open', 'jimmy')).toEqual([
      words('jimmy it and jimmy'),
      SLOT,
    ]);
  });

  it('writes a name of several words as its words, as `look_in` is written `look in`', () => {
    expect(withSynonym([words('look in'), SLOT], 'look_in', 'peer into')).toEqual([
      words('peer into'),
      SLOT,
    ]);
    expect(withSynonym([words('look'), SLOT], 'look_in', 'peer into')).toBeNull();
  });

  it('is nothing for a phrase that does not write the name', () => {
    expect(withSynonym([words('use'), SLOT, words('on'), SLOT], 'unlock', 'pick')).toBeNull();
    expect(withSynonym([words('reopen'), SLOT], 'open', 'jimmy')).toBeNull();
  });

  it('is one phrase for each of the verb’s that writes its name, in their order', () => {
    const bundle = compiledWorld('shop', shop(PRY));
    const pry = bundle.verbs.qualified('shop', 'pry')!;
    expect(synonymPhrases(pry, 'lever').map((phrase) => phrase.text)).toEqual([
      'lever [target]',
      'lever at [target]',
    ]);
  });
});

describe('a verb’s own synonyms, as its file is read', () => {
  const said = (text: string, caps = limitsFrom({}).caps) =>
    readFile(new SourceFile('verbs.sprout', text), caps).diagnostics.map(
      (d) => `${locationOf(d.at)} ${d.message}`,
    );

  it('are taken where every phrase they give is new', () => {
    expect(said('verb pry { role target  "pry [target]"  synonyms "lever", "prise" }\n')).toEqual(
      [],
    );
  });

  it('are refused where one gives a phrase the verb has, written or given before it', () => {
    expect(
      said(
        'verb pry { role target  "pry [target]"  "lever [target]"  synonyms "lever", "prise", "prise" }\n',
      ),
    ).toEqual([
      'verbs.sprout:1:68 `"lever"` gives `pry` the phrase `"lever [target]"`, which it has already.',
      'verbs.sprout:1:86 `"prise"` gives `pry` the phrase `"prise [target]"`, which it has already.',
    ]);
  });

  it('are refused where a phrase one gives is longer than a phrase may be, and do not count toward the phrases', () => {
    const caps = limitsFrom({ caps: { phraseCharacters: 17, phrasesPerVerb: 1 } }).caps;
    expect(
      said('verb pry { role target  "pry [target]"  synonyms "lever up", "force open" }\n', caps),
    ).toEqual([
      'verbs.sprout:1:62 `"force open"` gives `pry` the phrase `"force open [target]"`, which is 19 characters long, and 17 is as long as a phrase may be.',
    ]);
  });
});

describe('a kind’s body', () => {
  it('holds no synonyms, nor does an object written in it', () => {
    const said = readFile(
      new SourceFile(
        'crate.sprout',
        'kind Crate {\n  synonyms open: "jimmy"\n  object lid is Lid { synonyms open: "flip" }\n}\n',
      ),
    ).diagnostics.map((d) => `${locationOf(d.at)} ${d.message}`);
    expect(said).toEqual([
      "crate.sprout:2:3 `Crate` is a kind, and a kind's body holds no synonyms.",
      "crate.sprout:3:23 `Crate` is a kind, and a kind's body holds no synonyms.",
    ]);
  });
});

describe('a world’s and an object’s synonyms, across the bundle', () => {
  it('give their verb phrases, the world’s for everyone and an object’s for it alone', () => {
    const bundle = compiledWorld(
      'shop',
      shop(PRY, 'synonyms pry: "lever"', 'synonyms pry: "force"'),
    );
    expect(
      bundle.synonyms.map((one) => [
        one.verb.name,
        one.words,
        one.object,
        one.phrases.map((p) => p.text),
      ]),
    ).toEqual([
      ['pry', 'lever', null, ['lever [target]', 'lever at [target]']],
      ['pry', 'force', ['hall', 'chest'], ['force [target]', 'force at [target]']],
    ]);
  });

  it('refuse a verb nothing declares, naming the one most likely meant', () => {
    expect(refusedIn(shop(PRY, 'synonyms pyr: "lever"'))).toEqual([
      'shop.sprout:4:12 `synonyms pyr:` names a verb, and nothing declares `pyr`. Did you mean `pry`?',
    ]);
  });

  it('refuse a phrase the verb has where the synonym holds, and not one another object’s gives', () => {
    const files = shop(
      'verb pry { role target  "pry [target]"  synonyms "lever" }\n',
      'synonyms pry: "force"',
      'synonyms pry: "lever", "force"',
    );
    expect(refusedIn(files)).toEqual([
      'shop.sprout:6:52 `"lever"` gives `pry` the phrase `"lever [target]"`, which it has already.',
      'shop.sprout:6:61 `"force"` gives `pry` the phrase `"force [target]"`, which it has already.',
    ]);
    const twoObjects = shop(PRY, '', 'synonyms pry: "force"');
    twoObjects['shop.sprout'] = twoObjects['shop.sprout'].replace(
      'object crate is sprout.Fixture',
      'object crate is sprout.Fixture { synonyms pry: "force" }',
    );
    expect(refusedIn(twoObjects)).toEqual([]);
  });
});
