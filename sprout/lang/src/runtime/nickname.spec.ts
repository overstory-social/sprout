import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { emitCartridge } from '../bundle/cartridge.js';
import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { compiledWorld } from '../fixtures/bundle.js';
import {
  CATALOGUE,
  harbour,
  HARBOUR,
  HARBOUR_FILES,
  INES,
  MARTA,
  QUAY,
} from '../fixtures/arrival.js';
import { chooser } from '../fixtures/parse.js';
import { GONG, STUDY, study, typed } from '../fixtures/parser.js';
import { catalogueOf } from './catalogue.js';
import { visitKey, type InstanceId } from './ids.js';
import { Draft } from './draft.js';
import { initialState, saveWorld } from './load.js';
import { newInstance } from './state.js';
import { RESERVED_WORDS } from '../syntax/reserved.js';
import { keptNickname, moderated, nicknameRefusal } from './nickname.js';

const BUDGETS = DEFAULT_LIMITS.budgets;

/** Why `nickname` is refused for Marta in the harbour as `state` stands, or null. */
const refusal = (nickname: string, state = harbour(), budgets = BUDGETS) =>
  nicknameRefusal(state, CATALOGUE, budgets, MARTA, nickname);

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

  it('is refused past the host’s nickname budget, counted in characters as kept', () => {
    const cap = { ...BUDGETS, nicknameCharacters: 7 };
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
  });

  it('may have 24 characters by default, the figure in the spec’s Limits › Runtime budgets', () => {
    expect(BUDGETS.nicknameCharacters).toBe(24);
    expect(refusal('M'.repeat(24))).toBeNull();
    expect(refusal('M'.repeat(25))?.words).toBe(
      `"${'M'.repeat(25)}" is 25 characters, and a nickname here may have at most 24: choose a shorter one.`,
    );
  });
});

describe('a nickname shaped like source', () => {
  it('is refused where a word of it begins with a colon, naming the word', () => {
    expect(refusal(':team')).toEqual({
      reason: 'source-shaped',
      nickname: ':team',
      collides: [':team'],
      words:
        'A nickname\'s word may not begin with a colon, and ":team" does: choose another nickname.',
    });
    expect(refusal('Marta :b')?.collides).toEqual([':b']);
    expect(refusal(':')?.collides).toEqual([':']);
  });

  it('is refused where a word of it has a period inside it, naming the word', () => {
    expect(refusal('marta.b')).toEqual({
      reason: 'source-shaped',
      nickname: 'marta.b',
      collides: ['marta.b'],
      words:
        'A nickname\'s word may not have a period inside it, and "marta.b" does: choose another nickname.',
    });
    expect(refusal('Marta B.C')?.collides).toEqual(['B.C']);
    expect(refusal('a..')?.reason).toBe('source-shaped');
  });

  it('names every such word once, as written, and both shapes where both are there', () => {
    expect(refusal(' :team  marta.b :team ')).toEqual({
      reason: 'source-shaped',
      nickname: ' :team  marta.b :team ',
      collides: [':team', 'marta.b'],
      words:
        'A nickname\'s word may not begin with a colon or have a period inside it, and ":team" and "marta.b" do: choose another nickname.',
    });
  });

  it('is admitted with a period at the end of a word, or a colon inside one, since neither is how source is written', () => {
    expect(refusal('Dr. Marta')).toBeNull();
    expect(refusal('Marta:B')).toBeNull();
    expect(refusal('.Marta')).toBeNull();
  });

  it('is refused for its shape before any word of it is looked up', () => {
    expect(refusal(':gull')?.reason).toBe('source-shaped');
    expect(refusal('gull.if')?.reason).toBe('source-shaped');
  });
});

describe('a nickname against the reserved words of the language', () => {
  it('is refused where any word of it is reserved, typed alike whatever its case, naming the word', () => {
    expect(RESERVED_WORDS.has('when')).toBe(true);
    expect(CATALOGUE.words.has('when')).toBe(false);
    expect(refusal('When')).toEqual({
      reason: 'reserved',
      nickname: 'When',
      collides: ['when'],
      words:
        '"when" is a word every world here reads, so "When" would not always mean you: choose another nickname.',
    });
    expect(refusal('Marta IF when if')).toEqual({
      reason: 'reserved',
      nickname: 'Marta IF when if',
      collides: ['if', 'when'],
      words:
        '"if" and "when" are words every world here reads, so "Marta IF when if" would not always mean you: choose another nickname.',
    });
  });

  it('is refused for every reserved word, and for none as part of a longer word', () => {
    for (const word of RESERVED_WORDS) {
      const refused = refusal(word);
      expect(refused?.reason, word).toMatch(/^(reserved|world-word)$/);
      expect(refused?.collides, word).toEqual([word]);
    }
    expect(refusal('Whenever')).toBeNull();
    expect(refusal('Ifrit')).toBeNull();
  });

  it('is refused as the world’s word first where a word is both, so the refusal names what this world reads', () => {
    expect(CATALOGUE.words.has('to')).toBe(true);
    expect(RESERVED_WORDS.has('to')).toBe(true);
    expect(refusal('Marta To')?.reason).toBe('world-word');
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
      'harbour.sprout': HARBOUR_FILES['harbour.sprout']!.replace(
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
    expect(nicknameRefusal(state, republished, BUDGETS, ROSE, 'Rose')).toEqual({
      reason: 'world-word',
      nickname: 'Rose',
      collides: ['rose'],
      words:
        'Since you were last here, "rose" is a word this world already reads, so "Rose" would not always mean you: choose another nickname.',
    });
    expect(nicknameRefusal(state, republished, BUDGETS, ROSE, 'Rosa')).toBeNull();
  });

  it('tells a newcomer the same without the "since"', () => {
    const state = harbour([{ visit: ROSE, away: QUAY }], [], republished);
    expect(nicknameRefusal(state, republished, BUDGETS, MARTA, 'Rose')?.words).toBe(
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
  it('is refused for its words exactly when one is shaped like source, the world’s or reserved, and once admitted addresses its visitor alone', () => {
    const catalogue = catalogueOf(STUDY, DEFAULT_LIMITS.caps);
    const empty = initialState(catalogue);
    const free = ['marta', 'b', 'zed', 'Ö', '7', 'o’neil', '!!', 'Q', 'dr.', 'x:y'];
    const world = [...catalogue.words];
    const reserved = [...RESERVED_WORDS].filter((word) => !catalogue.words.has(word));
    const shaped = [':team', 'a.b', ':', 'x..y'];
    const c = chooser(41);
    let admitted = 0;
    const seen = new Set<string>();
    for (let run = 0; run < 400; run++) {
      const nickname = Array.from({ length: 1 + c.below(3) }, () => {
        const pick = c.below(8);
        if (pick === 0) return c.one(shaped);
        if (pick <= 2) return c.one(world);
        if (pick === 3) return c.one(reserved);
        return c.one(free);
      })
        .map((word) => (c.below(2) === 0 ? word.toUpperCase() : word))
        .join(c.one([' ', '  ', '\t']));
      const refused = nicknameRefusal(empty, catalogue, BUDGETS, MARTA, nickname);
      const written = keptNickname(nickname).split(' ');
      const shapedOnes = written.filter((word) => /^:/.test(word) || /.\../.test(word));
      const typedOnes = nickname.toLowerCase().split(/\s+/);
      const theWorlds = typedOnes.filter((word) => catalogue.words.has(word));
      const theLanguages = typedOnes.filter((word) => RESERVED_WORDS.has(word));
      // Past the host's length a nickname is refused for that, before its words are read.
      const tooLong = [...keptNickname(nickname)].length > BUDGETS.nicknameCharacters;
      const expected: [string, string[]] | null = tooLong
        ? ['too-long', []]
        : shapedOnes.length > 0
          ? ['source-shaped', shapedOnes]
          : theWorlds.length > 0
            ? ['world-word', theWorlds]
            : theLanguages.length > 0
              ? ['reserved', theLanguages]
              : null;
      if (expected !== null) {
        seen.add(expected[0]);
        expect(refused?.reason, nickname).toBe(expected[0]);
        expect(refused?.collides, nickname).toEqual([...new Set(expected[1])]);
        continue;
      }
      expect(refused, nickname).toBeNull();
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
    for (const reason of ['reserved', 'source-shaped', 'world-word'])
      expect(seen).toContain(reason);
  });
});

describe('the nicknames the C runtime admits and refuses as this one does', () => {
  const DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), '../../../../corpus/goldens');
  const NICKNAMES = [
    'Marta B',
    '  Marta \t B\n',
    '',
    '   ',
    'Mar\u0007ta',
    'Mar\u200bta',
    'Marta\u202e',
    'Mårta Ø',
    'M'.repeat(24),
    'M'.repeat(25),
    ':team',
    ' :team  marta.b :team ',
    'marta.b',
    'Dr. Marta',
    'Marta:B',
    '.Marta',
    'When',
    'Marta IF when if',
    'Whenever',
    'Ifrit',
    'Gull',
    'Grey Quay',
    'North Gull north',
    'Marta, B',
    'Marta and B',
    'The Marta',
    'NE',
    'Look',
    'Ines',
    'INES',
    '  ines ',
    'Odo',
    'ODO',
    'Marta',
    'Pell',
    'ΑΣ',
    'ας',
    'ασ',
    'ΑΣ Β',
    'Σ',
    'ΣΑΣ',
    'ΑΣ.',
    'ΑΣ, Β',
    'İstanbul',
    'istanbul',
    'Straße',
    'STRASSE',
    'ǅ',
    'Ünï',
    'ünï',
    '𐐀𐐁',
    '𐐨𐐩',
    'a\u0301Σ',
    'Ὀδυσσεύς',
    'ὀδυσσεύς',
  ];
  const VISITS = ['v-marta', 'v-ines', 'v-odo', 'v-new'];

  it('are held in the golden, with the cartridge and the stored world they were asked against', () => {
    // Ines and Pell stand in the harbour, Odo is away; the others are asked as a visitor no one has met.
    const draft = new Draft(initialState(CATALOGUE));
    const people: readonly [string, string, InstanceId | null][] = [
      ['v-marta', 'Marta', null],
      ['v-ines', 'Ines', QUAY],
      ['v-odo', 'Odo', null],
      ['v-pell', 'ΑΣ', QUAY],
      ['v-quill', 'İSTANBUL', QUAY],
    ];
    for (const [key, nickname, where] of people) {
      const id = draft.mint();
      const arrival = where === null ? null : draft.nextSerial();
      draft.add(
        newInstance(
          id,
          { from: 'visitor' },
          CATALOGUE.visitorKind!,
          where,
          arrival,
          CATALOGUE.caps,
        ),
      );
      draft.putVisitor({
        visit: visitKey(key),
        nickname,
        instance: id,
        lastPlace: where ?? QUAY,
        referents: [],
        lastReading: null,
      });
    }
    const state = draft.commit().state;
    const cases = VISITS.flatMap((visit) =>
      [...NICKNAMES, ...(visit === 'v-marta' ? ['marta', 'MARTA  '] : [])].flatMap((nickname) =>
        [24, 7].map((cap) => {
          const refused = nicknameRefusal(
            state,
            CATALOGUE,
            { ...BUDGETS, nicknameCharacters: cap },
            visitKey(visit),
            nickname,
          );
          return { visit, nickname, cap, refused };
        }),
      ),
    );
    const text = `${JSON.stringify({ world: saveWorld(state), cases }, null, 2)}\n`;
    const cartridge = emitCartridge(HARBOUR);
    if (process.env['SPROUT_WRITE_GOLDENS'] === '1') {
      writeFileSync(join(DIRECTORY, 'nicknames.json'), text);
      writeFileSync(join(DIRECTORY, 'nicknames.sproutworld'), cartridge);
    }
    // The file is formatted by prettier after it is written, so it is compared as data.
    expect(JSON.parse(text)).toEqual(
      JSON.parse(readFileSync(join(DIRECTORY, 'nicknames.json'), 'utf8')),
    );
    expect(
      Buffer.from(cartridge).equals(readFileSync(join(DIRECTORY, 'nicknames.sproutworld'))),
    ).toBe(true);
    const reasons = new Set(cases.map((one) => one.refused?.reason ?? 'admitted'));
    for (const reason of [
      'admitted',
      'empty',
      'not-words',
      'too-long',
      'source-shaped',
      'world-word',
      'reserved',
      'held',
    ]) {
      expect(reasons, reason).toContain(reason);
    }
  });
});
