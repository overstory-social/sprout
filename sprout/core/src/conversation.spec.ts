import { describe, expect, it } from 'vitest';

import { visitKey, type VisitKey } from '@overstory/sprout/lang';

import {
  ConversationPace,
  hearers,
  keptSaying,
  runConversation,
  sayingRefusal,
  type ConversationHost,
  type ConversationRules,
} from './conversation.js';
import { HALL, MARTA, seeded as seededTally, tally } from './fixtures/tally.js';
import type { SproutStore } from './store.js';
import { committedState, runArrival, runDeparture, type NicknameHost } from './turns.js';

const { host } = tally();
const INES = visitKey('v-ines');
const OPEN_NICKNAMES: NicknameHost = { moderate: () => true };
const UNBOUNDED: ConversationRules = { characters: null, pace: null };
/** A host that caps nothing and whose moderation declines nothing. */
const OPEN: ConversationHost = { rules: UNBOUNDED, moderate: () => true };

/** The tally with Marta in the hall, and Ines too unless `alone`. */
async function hall(alone = false): Promise<SproutStore> {
  const store = await seededTally(host);
  if (!alone) {
    const at = { now: 0, seed: 1, mayHold: null };
    await runArrival(
      store,
      'w',
      host,
      at,
      { visit: INES, nickname: 'Ines', ...at },
      OPEN_NICKNAMES,
    );
  }
  return store;
}

const say = (text: string, at = 0, visit: VisitKey = MARTA) => ({ visit, text, at });
const stored = (store: SproutStore) =>
  store.read('w', async (tx) => ({ state: await tx.state(), log: await tx.log({ limit: 1000 }) }));

describe('what may be said, whoever hears it', () => {
  it('keeps text as its words, single-spaced', () => {
    expect(keptSaying('  hello \n\t there  ')).toBe('hello there');
  });

  it('refuses nothing to say, in words the speaker reads', () => {
    for (const text of ['', '   ', '\n\t']) {
      expect(sayingRefusal(UNBOUNDED, text)).toEqual({
        said: false,
        reason: 'empty',
        words: 'Say something for the others here to read.',
      });
    }
  });

  it('refuses a control or format character, which is no part of a word', () => {
    for (const text of ['ring\u0007', 'zero\u200Bwidth', 'turn\u202Earound']) {
      expect(sayingRefusal(UNBOUNDED, text)?.reason).toBe('not-words');
    }
  });

  it("caps the length at the host's figure, counted in characters as kept, and at none where it sets none", () => {
    const rules = { characters: 5, pace: null };
    expect(sayingRefusal(rules, '  héllo  ')).toBeNull();
    expect(sayingRefusal(rules, 'hello!')).toEqual({
      said: false,
      reason: 'too-long',
      words: 'That is 6 characters, and one thing said here may have at most 5: say it in fewer.',
    });
    expect(sayingRefusal(UNBOUNDED, 'x'.repeat(100_000))).toBeNull();
  });
});

describe('who hears it', () => {
  it('is everyone standing directly in the place, the speaker among them, in contents order', async () => {
    const state = await committedState(await hall(), 'w', host);
    expect(hearers(state, MARTA)).toEqual({ place: HALL, to: [MARTA, INES] });
    expect(hearers(state, INES)).toEqual({ place: HALL, to: [MARTA, INES] });
  });

  it('is nobody for one who is away or never came', async () => {
    const store = await hall();
    await runDeparture(store, 'w', host, { visit: INES, now: 1, seed: 1, mayHold: null });
    const state = await committedState(store, 'w', host);
    expect(hearers(state, INES)).toBeNull();
    expect(hearers(state, MARTA)).toEqual({ place: HALL, to: [MARTA] });
    expect(hearers(state, visitKey('v-nobody'))).toBeNull();
  });
});

describe('the pace', () => {
  const pace = { messages: 2, seconds: 10 };

  it('admits at most so many in any window of so many seconds, per visitor and per world', () => {
    const kept = new ConversationPace();
    expect(kept.admit('w', MARTA, 0, pace)).toBe(true);
    expect(kept.admit('w', MARTA, 5, pace)).toBe(true);
    expect(kept.admit('w', MARTA, 9, pace)).toBe(false);
    expect(kept.admit('w', INES, 9, pace)).toBe(true);
    expect(kept.admit('elsewhere', MARTA, 9, pace)).toBe(true);
    // The first falls out of the window ten seconds on, and a refusal was not counted.
    expect(kept.admit('w', MARTA, 10, pace)).toBe(true);
    expect(kept.admit('w', MARTA, 11, pace)).toBe(false);
  });

  it('admits everything where the host sets no pace', () => {
    const kept = new ConversationPace();
    for (let i = 0; i < 1000; i++) expect(kept.admit('w', MARTA, 0, null)).toBe(true);
  });

  it('forgets a visitor in every world', () => {
    const kept = new ConversationPace();
    const one = { messages: 1, seconds: 60 };
    kept.admit('w', MARTA, 0, one);
    kept.admit('elsewhere', MARTA, 0, one);
    kept.admit('w', INES, 0, one);
    kept.forget(MARTA);
    expect(kept.admit('w', MARTA, 1, one)).toBe(true);
    expect(kept.admit('elsewhere', MARTA, 1, one)).toBe(true);
    expect(kept.admit('w', INES, 1, one)).toBe(false);
  });
});

describe('saying something against a store', () => {
  it('is said to everyone in the place, by nickname, as kept', async () => {
    const store = await hall();
    const said = await runConversation(
      store,
      'w',
      host,
      OPEN,
      new ConversationPace(),
      say('  shall we   bump it? ', 7),
    );
    expect(said).toEqual({
      said: true,
      from: MARTA,
      nickname: 'Marta',
      text: 'shall we bump it?',
      place: HALL,
      to: [MARTA, INES],
      at: 7,
    });
  });

  it('writes nothing of the world and nothing to its log', async () => {
    const store = await hall();
    const before = await stored(store);
    await runConversation(store, 'w', host, OPEN, new ConversationPace(), say('hello'));
    await runConversation(store, 'w', host, OPEN, new ConversationPace(), say(''));
    expect(await stored(store)).toEqual(before);
  });

  it('refuses where nobody else is there to hear it, and asks no moderation', async () => {
    const asked: string[] = [];
    const moderating: ConversationHost = {
      rules: UNBOUNDED,
      moderate: (text) => (asked.push(text), true),
    };
    const said = await runConversation(
      await hall(true),
      'w',
      host,
      moderating,
      new ConversationPace(),
      say('anyone?'),
    );
    expect(said).toEqual({
      said: false,
      reason: 'nobody-here',
      words: 'There is nobody else here to hear you.',
    });
    expect(asked).toEqual([]);
  });

  it("asks the host's moderation with the text as kept and who says it, and tells the speaker when it declines", async () => {
    const asked: [string, VisitKey][] = [];
    const strict: ConversationHost = {
      rules: UNBOUNDED,
      moderate: async (text, visit) => (asked.push([text, visit]), !text.includes('rude')),
    };
    const pace = new ConversationPace();
    const store = await hall();
    expect(await runConversation(store, 'w', host, strict, pace, say(' so  rude '))).toEqual({
      said: false,
      reason: 'moderated',
      words: 'That cannot be said here.',
    });
    expect((await runConversation(store, 'w', host, strict, pace, say('fine'))).said).toBe(true);
    expect(asked).toEqual([
      ['so rude', MARTA],
      ['fine', MARTA],
    ]);
  });

  it("refuses past the host's pace, in words that say the figure, and a declined line counts", async () => {
    const store = await hall();
    const pace = new ConversationPace();
    const paced: ConversationHost = {
      rules: { characters: null, pace: { messages: 1, seconds: 30 } },
      moderate: (text) => text !== 'no',
    };
    expect((await runConversation(store, 'w', host, paced, pace, say('no', 0))).said).toBe(false);
    expect(await runConversation(store, 'w', host, paced, pace, say('yes', 10))).toEqual({
      said: false,
      reason: 'too-fast',
      words: 'You may say one thing every 30 seconds here: wait a moment and say it again.',
    });
    expect((await runConversation(store, 'w', host, paced, pace, say('yes', 30))).said).toBe(true);
    const plural: ConversationHost = {
      rules: { characters: null, pace: { messages: 3, seconds: 1 } },
      moderate: () => true,
    };
    const quick = new ConversationPace();
    for (const at of [0, 0, 0])
      await runConversation(store, 'w', host, plural, quick, say('a', at));
    expect(await runConversation(store, 'w', host, plural, quick, say('a', 0))).toEqual({
      said: false,
      reason: 'too-fast',
      words: 'You may say 3 things every second here: wait a moment and say it again.',
    });
  });

  it('reads who hears it again once moderation answers, so one who left meanwhile is not told', async () => {
    const store = await hall();
    const slow: ConversationHost = {
      rules: UNBOUNDED,
      moderate: async () => {
        await runDeparture(store, 'w', host, { visit: INES, now: 1, seed: 1, mayHold: null });
        return true;
      },
    };
    expect(
      await runConversation(store, 'w', host, slow, new ConversationPace(), say('hi')),
    ).toEqual({
      said: false,
      reason: 'nobody-here',
      words: 'There is nobody else here to hear you.',
    });
  });

  it('tells a speaker who left while moderation decided that it was not said, not that nobody was there', async () => {
    const store = await hall();
    const slow: ConversationHost = {
      rules: UNBOUNDED,
      moderate: async () => {
        await runDeparture(store, 'w', host, { visit: MARTA, now: 1, seed: 1, mayHold: null });
        return true;
      },
    };
    expect(
      await runConversation(store, 'w', host, slow, new ConversationPace(), say('hi')),
    ).toEqual({
      said: false,
      reason: 'gone',
      words: 'You left before that was said: say it again where you are now.',
    });
  });

  it("throws the host's defect for one who never came or is away, and for time not in whole seconds", async () => {
    const store = await hall();
    const pace = new ConversationPace();
    await expect(
      runConversation(store, 'w', host, OPEN, pace, say('hi', 0, visitKey('v-nobody'))),
    ).rejects.toThrow('`v-nobody` has never visited this world.');
    await runDeparture(store, 'w', host, { visit: INES, now: 1, seed: 1, mayHold: null });
    await expect(runConversation(store, 'w', host, OPEN, pace, say('hi', 2, INES))).rejects.toThrow(
      '`v-ines` is not in this world, so has nobody to talk to.',
    );
    await expect(runConversation(store, 'w', host, OPEN, pace, say('hi', 1.5))).rejects.toThrow(
      'whole seconds',
    );
  });

  it('never ends with nothing to tell the speaker: every refusal has words', async () => {
    const store = await hall();
    const pace = new ConversationPace();
    const capped: ConversationHost = {
      rules: { characters: 3, pace: { messages: 1, seconds: 60 } },
      moderate: (text) => text !== 'bad',
    };
    for (const text of ['', 'bell\u0007', 'far too long', 'bad', 'ok', 'ok']) {
      const said = await runConversation(store, 'w', host, capped, pace, say(text));
      if (!said.said) expect(said.words.length).toBeGreaterThan(0);
      else expect(said.to).toContain(MARTA);
    }
  });
});
