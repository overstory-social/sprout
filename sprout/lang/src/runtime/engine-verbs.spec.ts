import { describe, expect, it } from 'vitest';

import {
  actorOf,
  answersOf,
  CAT,
  HALL,
  INES,
  LAMP,
  lookingAt,
  LOFT,
  MARTA,
  readAnswers,
  study,
  STUDY,
  typedIn,
} from '../fixtures/describe.js';
import { NOTHING, words } from '../fixtures/reading.js';
import { arrivalsRead, engineAnswers } from './engine-verbs.js';
import type { InstanceId } from './ids.js';
import type { Notice } from './move.js';
import type { Reading } from './reading.js';

const LOOK = STUDY.verbs.qualified('sprout', 'look')!;

/** What a committed turn's reading said to anyone, apart from what the engine answered. */
function saidIn(turn: ReturnType<typeof typedIn>): string[] {
  const done = turn.value;
  if (!('acted' in done)) throw new Error('the turn did not act');
  return [...done.acted.said, ...done.drained.said].map((line) => words(line.said));
}

describe('what the engine answers a command, once the queue is empty', () => {
  it('`look`, however it is typed, is the actor’s place described to them, and nothing happening is not said', () => {
    for (const text of ['look', 'l', 'look around']) {
      const state = study();
      const turn = typedIn(state, MARTA, text);
      expect(readAnswers(turn), text).toEqual([
        [actorOf(state, MARTA), ['A long hall.', 'A box stands by the wall.']],
      ]);
      expect(saidIn(turn), text).toEqual([]);
    }
  });

  it('`examine` is the thing named described, or the world’s `unremarkable` for one with no words', () => {
    const state = study();
    const marta = actorOf(state, MARTA);
    expect(readAnswers(typedIn(state, MARTA, 'examine lamp'))).toEqual([
      [marta, ['The lamp is dark.', 'It hangs from a hook.']],
    ]);
    expect(readAnswers(typedIn(state, MARTA, 'x mirror'))).toEqual([
      [marta, ['The glass shows you, in a hall.']],
    ]);
    for (const text of ['look at stool', 'inspect stool', 'x blank']) {
      expect(readAnswers(typedIn(state, MARTA, text))[0]![1]![0], text).toMatch(
        /^There is nothing special about a (stool|blank)\.$/,
      );
    }
    // A person is looked at as anything is, and reads as "you" to themselves.
    expect(readAnswers(typedIn(state, MARTA, 'x marta'))).toEqual([
      [marta, ['There is nothing special about you.']],
    ]);
  });

  it('describes after the queue, so what the turn did is what the one looking reads', () => {
    const state = study(undefined, [[LAMP, 'lit', true]]);
    expect(readAnswers(typedIn(state, MARTA, 'x lamp'))[0]![1]).toEqual([
      'The lamp burns.',
      'It hangs from a hook.',
    ]);
  });

  it('`inventory` is the actor’s own `inventory`, said from them, as `sprout.Actor` writes it', () => {
    const state = study();
    const marta = actorOf(state, MARTA);
    const [answer] = answersOf(typedIn(state, MARTA, 'i'));
    if (answer === undefined || !('said' in answer)) throw new Error('no inventory was said');
    expect([answer.said.effect, answer.said.by, answer.said.to]).toEqual(['said', marta, [marta]]);
    expect(readAnswers(typedIn(state, MARTA, 'inventory'))).toEqual([
      [marta, ['You are carrying nothing.']],
    ]);
  });

  it('`help` is what the actor can do there, in the engine’s words, each reading its consent pass allows', () => {
    const state = study(undefined, [[LAMP, 'lit', true]]);
    const [[reader, [line]]] = readAnswers(typedIn(state, MARTA, 'help')) as unknown as [
      [string, [string]],
    ];
    expect(reader).toBe(actorOf(state, MARTA));
    expect(line).toMatch(/^You can type: pull hall, pull mirror, /);
    // The lamp refuses to be pulled once lit, so it is not offered.
    expect(line).not.toContain('pull lamp');
    for (const typed of ['go north', 'look', 'examine lamp', 'inventory', 'wait', 'help']) {
      expect(line, typed).toContain(typed);
    }
    expect(line.endsWith('give pin to cat.')).toBe(true);
    const [answer] = answersOf(typedIn(state, MARTA, '?'));
    expect(answer !== undefined && 'said' in answer && answer.said.effect).toBe('notice');
  });

  it('`wait` does nothing, and is answered as any command that says nothing is', () => {
    const turn = typedIn(study(), MARTA, 'wait');
    expect(answersOf(turn)).toEqual([]);
    expect(saidIn(turn)).toEqual([NOTHING]);
    expect(saidIn(typedIn(study(), MARTA, 'z'))).toEqual([NOTHING]);
  });

  it('`go` is answered with the place arrived in, described to the one who went', () => {
    const state = study();
    const turn = typedIn(state, MARTA, 'north');
    expect(readAnswers(turn)).toEqual([[actorOf(state, MARTA), ['Rafters, and dust.']]]);
    expect(saidIn(turn)).toEqual([]);
  });

  it('describes a place arrived in only to a person who still stands there, once', () => {
    const state = study([
      [MARTA, HALL, 'Marta'],
      [INES, LOFT, 'Ines'],
    ]);
    const marta = actorOf(state, MARTA);
    const ines = actorOf(state, INES);
    const reading: Reading = { verb: LOOK, actor: marta, bindings: new Map() };
    const described = (place: InstanceId, who: InstanceId): Notice => ({
      notice: 'described',
      place,
      audience: [who],
    });
    // Ines was carried to the loft twice, and the hall is not where she
    // stands; the cat is nobody; and Marta's own `look` is answered last.
    const answers = engineAnswers(
      reading,
      [described(LOFT, ines), described(LOFT, ines), described(HALL, ines), described(HALL, CAT)],
      lookingAt(state),
    );
    expect(
      answers.map((answer) =>
        'description' in answer ? [answer.description.of, answer.description.to] : 'said',
      ),
    ).toEqual([
      [LOFT, ines],
      [HALL, marta],
    ]);
  });
});

describe('the places people arrived in, as they read them', () => {
  const described = (place: InstanceId, who: InstanceId): Notice => ({
    notice: 'described',
    place,
    audience: [who],
  });

  it('are in the order the moves were made, and leave out every other notice', () => {
    const state = study([
      [MARTA, HALL, 'Marta'],
      [INES, LOFT, 'Ines'],
    ]);
    const [marta, ines] = [actorOf(state, MARTA), actorOf(state, INES)];
    const read = arrivalsRead([described(LOFT, ines), described(HALL, marta)], lookingAt(state));
    expect(
      read.map((one) => ('description' in one ? [one.description.of, one.description.to] : 'said')),
    ).toEqual([
      [LOFT, ines],
      [HALL, marta],
    ]);
  });

  it('are nothing for an NPC, or for someone a later move carried on', () => {
    const state = study();
    const marta = actorOf(state, MARTA);
    expect(arrivalsRead([described(HALL, CAT), described(LOFT, marta)], lookingAt(state))).toEqual(
      [],
    );
  });
});
