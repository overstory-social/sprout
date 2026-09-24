import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { compiledWorld } from '../fixtures/bundle.js';
import { CATALOGUE, harbour, HARBOUR_FILES, INES, MARTA, QUAY } from '../fixtures/arrival.js';
import { chooser } from '../fixtures/parse.js';
import { GONG, STUDY, study, typed } from '../fixtures/parser.js';
import { catalogueOf } from './catalogue.js';
import { visitKey } from './ids.js';
import { initialState } from './load.js';
import { keptNickname, moderated, nicknameRefusal, type NicknameRules } from './nickname.js';

const UNCAPPED: NicknameRules = { characters: null };

/** Why `nickname` is refused for Marta in the harbour as `state` stands, or null. */
const refusal = (nickname: string, state = harbour(), rules = UNCAPPED) =>
  nicknameRefusal(state, CATALOGUE, rules, MARTA, nickname);

describe('a nickname', () => {
  it('is kept as its words, single-spaced, its case as given', () => {
    expect(keptNickname('  Marta \t B\n')).toBe('Marta B');
    expect(refusal('  Marta \t B\n')).toBeNull();
  });

  it('is refused empty, asking for one', () => {
    for (const nickname of ['', '   ', '\n\t']) {
      expect(refusal(nickname)).toEqual({
        reason: 'empty',
        nickname,
        collides: [],
        words: 'Choose a nickname to be known by here.',
      });
    }
  });

  it('is refused holding a control or format character, since a nickname is words and nothing else', () => {
    for (const nickname of ['Mar\u0007ta', 'Mar\u200bta', 'Marta\u202e']) {
      expect(refusal(nickname)?.reason, JSON.stringify(nickname)).toBe('not-words');
      expect(refusal(nickname)?.words).toBe(
        'A nickname is words and nothing else: choose one without hidden or control characters.',
      );
    }
    expect(refusal('Mårta Ø')).toBeNull();
  });

  it('is refused past the host’s cap, counted in characters as kept, and never where the host sets none', () => {
    const cap: NicknameRules = { characters: 7 };
    expect(refusal('Marta B', harbour(), cap)).toBeNull();
    expect(refusal('  Marta   B  ', harbour(), cap)).toBeNull();
    expect(refusal('Mårtå B', harbour(), cap)).toBeNull();
    expect(refusal('Marta BC', harbour(), cap)).toEqual({
      reason: 'too-long',
      nickname: 'Marta BC',
      collides: [],
      words:
        '"Marta BC" is 8 characters, and a nickname here may have at most 7: choose a shorter one.',
    });
    expect(refusal('M'.repeat(10_000))).toBeNull();
  });
});

describe('a nickname against the bundle’s word set', () => {
  it('is refused where any word of it is a noun, a token of one, or a word a phrase, direction or article reads', () => {
    for (const [nickname, word] of [
      ['Gull', 'gull'],
      ['Grey Quay', 'quay'],
      ['North', 'north'],
      ['The Marta', 'the'],
      ['Marta To', 'to'],
      ['Look', 'look'],
      ['NE', 'ne'],
    ] as const) {
      const refused = refusal(nickname);
      expect(refused?.reason, nickname).toBe('world-word');
      expect(refused?.collides, nickname).toEqual([word]);
    }
  });

  it('is refused holding a connector, a comma among them', () => {
    expect(refusal('Marta and B')?.collides).toEqual(['and']);
    expect(refusal('Marta, B')?.collides).toEqual([',']);
  });

  it('names each word it collides on, once, in the order written, and asks for another', () => {
    expect(refusal('North Gull north')).toEqual({
      reason: 'world-word',
      nickname: 'North Gull north',
      collides: ['north', 'gull'],
      words:
        '"north" and "gull" are words this world already reads, so "North Gull north" would not always mean you: choose another nickname.',
    });
    expect(refusal('Gull')?.words).toBe(
      '"gull" is a word this world already reads, so "Gull" would not always mean you: choose another nickname.',
    );
  });

  it('is admitted where no word of it is the world’s, as "Marta B" is where nothing answers to `marta` or `b`', () => {
    expect(CATALOGUE.words.has('marta')).toBe(false);
    expect(refusal('Marta B')).toBeNull();
  });
});

describe('a nickname against the people in the world', () => {
  it('is refused where someone present holds it, typed alike whatever its case or spacing', () => {
    const state = harbour([{ visit: INES, in: QUAY }]);
    for (const nickname of ['Ines', 'INES', '  ines ']) {
      expect(refusal(nickname, state)).toEqual({
        reason: 'held',
        nickname,
        collides: [],
        words: `Someone here is already called "${keptNickname(nickname)}": choose another nickname.`,
      });
    }
    expect(refusal('Ines B', state)).toBeNull();
  });

  it('is admitted where only someone away holds it, since reservations are soft', () => {
    expect(refusal('Ines', harbour([{ visit: INES, away: QUAY }]))).toBeNull();
  });

  it('is admitted back to a returning visitor who kept it, while it is still free', () => {
    expect(refusal('Marta', harbour([{ visit: MARTA, away: QUAY }]))).toBeNull();
  });
});

describe('re-asking after a republish', () => {
  // The harbour republished with a rose on the quay: `rose` is now a noun.
  const ROSE = visitKey('v-rose');
  const republished = catalogueOf(
    compiledWorld('harbour', {
      ...HARBOUR_FILES,
      'world.sprout': HARBOUR_FILES['world.sprout']!.replace(
        'object gull is Gull',
        'object gull is Gull\n    object rose is Flower',
      ),
      'flower.sprout': 'kind Flower { }\n',
    }),
    DEFAULT_LIMITS.caps,
  );

  it('asks a returning visitor for a new name where their kept one is now the world’s, saying why', () => {
    const state = harbour([{ visit: ROSE, away: QUAY }], [], republished);
    expect(state.visitors.get(ROSE)!.nickname).toBe('Rose');
    expect(nicknameRefusal(state, republished, UNCAPPED, ROSE, 'Rose')).toEqual({
      reason: 'world-word',
      nickname: 'Rose',
      collides: ['rose'],
      words:
        'Since you were last here, "rose" is a word this world already reads, so "Rose" would not always mean you: choose another nickname.',
    });
    expect(nicknameRefusal(state, republished, UNCAPPED, ROSE, 'Rosa')).toBeNull();
  });

  it('tells a newcomer the same without the "since"', () => {
    const state = harbour([{ visit: ROSE, away: QUAY }], [], republished);
    expect(nicknameRefusal(state, republished, UNCAPPED, MARTA, 'Rose')?.words).toBe(
      '"rose" is a word this world already reads, so "Rose" would not always mean you: choose another nickname.',
    );
  });
});

describe('moderation', () => {
  it('is the host’s, refused in words it may replace', () => {
    expect(moderated('Marta')).toEqual({
      reason: 'moderated',
      nickname: 'Marta',
      collides: [],
      words: 'That nickname cannot be used here: choose another.',
    });
  });
});

describe('an admitted nickname, over generated nicknames', () => {
  it('is refused for its words exactly when one of them is the world’s, and once admitted addresses its visitor alone', () => {
    const catalogue = catalogueOf(STUDY, DEFAULT_LIMITS.caps);
    const empty = initialState(catalogue);
    const free = ['marta', 'b', 'zed', 'Ö', '7', 'o’neil', '!!', 'Q'];
    const world = [...catalogue.words];
    const c = chooser(41);
    let admitted = 0;
    for (let run = 0; run < 300; run++) {
      const nickname = Array.from({ length: 1 + c.below(3) }, () =>
        c.below(3) === 0 ? c.one(world) : c.one(free),
      )
        .map((word) => (c.below(2) === 0 ? word.toUpperCase() : word))
        .join(c.one([' ', '  ', '\t']));
      const refused = nicknameRefusal(empty, catalogue, UNCAPPED, MARTA, nickname);
      const theWorlds = nickname
        .toLowerCase()
        .split(/\s+/)
        .filter((word) => catalogue.words.has(word));
      expect(refused === null, nickname).toBe(theWorlds.length === 0);
      if (refused !== null) {
        expect(refused.collides, nickname).toEqual([...new Set(theWorlds)]);
        continue;
      }
      admitted++;
      const one = study(['Pip', keptNickname(nickname)]);
      const outcome = typed(one, `give gong to ${nickname.toLowerCase()}`);
      expect('understood' in outcome, nickname).toBe(true);
      if (!('understood' in outcome)) continue;
      expect(Object.fromEntries(outcome.understood.bindings), nickname).toEqual({
        item: { object: GONG },
        recipient: { object: one.people[1] },
      });
    }
    expect(admitted).toBeGreaterThan(50);
  });
});
