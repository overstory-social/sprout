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
import { words } from '../fixtures/reading.js';
import { arrivalsRead, engineAnswers, withArrivals, type Arrived } from './engine-verbs.js';
import type { InstanceId } from './ids.js';
import type { Owed } from './move.js';
import type { Reading, Said } from './reading.js';

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

  it('`examine` says the thing’s own `contents` after its description, where its kinds write one', () => {
    const state = study();
    const marta = actorOf(state, MARTA);
    expect(readAnswers(typedIn(state, MARTA, 'examine box'))).toEqual([
      [marta, ['Something is in it.']],
      [marta, ['One thing is in it, where you can see.']],
    ]);
    // `look` says no `contents`, and a thing with none says only its description.
    expect(readAnswers(typedIn(state, MARTA, 'look'))).toHaveLength(1);
    expect(readAnswers(typedIn(state, MARTA, 'x lamp'))).toHaveLength(1);
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

  it('`help` is what the actor can do there, through the world’s `help`, less what no participant plays a part in', () => {
    const state = study(undefined, [[LAMP, 'lit', true]]);
    const [[reader, [line]]] = readAnswers(typedIn(state, MARTA, 'help')) as unknown as [
      [string, [string]],
    ];
    expect(reader).toBe(actorOf(state, MARTA));
    // Nothing but the lamp plays `pull`, and the lamp refuses it once lit,
    // so `pull` is offered for nothing.
    expect(line).not.toMatch(/\bpull /);
    // Only the cat plays `ask`, so every other target is left out.
    expect(line).toContain('ask cat about …');
    expect(line).not.toMatch(/\bask (hall|lamp|mirror|stool|blank|box|pin) /);
    for (const typed of ['go north', 'look', 'examine lamp', 'inventory', 'wait', 'help']) {
      expect(line, typed).toContain(typed);
    }
    // `sprout.Actor` plays the actor's own part in every `take`, whatever
    // the target, and refuses to drop or give what it does not hold,
    // which Marta holds nothing of.
    expect(line.endsWith('take pin.')).toBe(true);
    expect(line).not.toMatch(/\b(drop|give|put) /);
    const [answer] = answersOf(typedIn(state, MARTA, '?'));
    expect(answer !== undefined && 'said' in answer && answer.said.effect).toBe('notice');
  });

  it('`wait` says the world’s `waited`, “Time passes.” by default', () => {
    const state = study();
    const marta = actorOf(state, MARTA);
    expect(readAnswers(typedIn(state, MARTA, 'wait'))).toEqual([[marta, ['Time passes.']]]);
    expect(readAnswers(typedIn(state, MARTA, 'z'))).toEqual([[marta, ['Time passes.']]]);
  });

  it('`go` is answered with the place arrived in, described to the one who went', () => {
    const state = study();
    const turn = typedIn(state, MARTA, 'north');
    expect(readAnswers(turn)).toEqual([[actorOf(state, MARTA), ['Rafters, and dust.']]]);
    expect(saidIn(turn)).toEqual([]);
  });

  it('answers the command alone, and reads no arrival', () => {
    const state = study();
    const marta = actorOf(state, MARTA);
    const reading: Reading = { verb: LOOK, actor: marta, bindings: new Map() };
    expect(
      engineAnswers(reading, lookingAt(state)).map((answer) =>
        'description' in answer ? [answer.description.of, answer.description.to] : 'said',
      ),
    ).toEqual([[HALL, marta]]);
  });
});

describe('the places people arrived in, as they read them', () => {
  const owed = (place: InstanceId, mover: InstanceId, after: number): Owed => ({
    mover,
    place,
    after,
  });
  const read = (arrived: readonly Arrived[]) =>
    arrived.map(({ after, line }) =>
      'description' in line ? [line.description.of, line.description.to, after] : 'said',
    );

  it('are in the order the moves were made, each where its move was', () => {
    const state = study([
      [MARTA, HALL, 'Marta'],
      [INES, LOFT, 'Ines'],
    ]);
    const [marta, ines] = [actorOf(state, MARTA), actorOf(state, INES)];
    expect(
      read(arrivalsRead([owed(LOFT, ines, 0), owed(HALL, marta, 2)], lookingAt(state))),
    ).toEqual([
      [LOFT, ines, 0],
      [HALL, marta, 2],
    ]);
  });

  it('are once for each place, where the last move that owed it was', () => {
    const state = study([[INES, LOFT, 'Ines']]);
    const ines = actorOf(state, INES);
    expect(
      read(arrivalsRead([owed(LOFT, ines, 0), owed(LOFT, ines, 3)], lookingAt(state))),
    ).toEqual([[LOFT, ines, 3]]);
  });

  it('are nothing for an NPC, or for someone a later move carried on', () => {
    const state = study();
    const marta = actorOf(state, MARTA);
    expect(arrivalsRead([owed(HALL, CAT, 0), owed(LOFT, marta, 0)], lookingAt(state))).toEqual([]);
  });

  it('fall among the turn’s lines where their `after` says, before what follows', () => {
    const state = study();
    const marta = actorOf(state, MARTA);
    const line = (name: string): Said => ({
      effect: 'told',
      to: [marta],
      by: HALL,
      speaker: null,
      said: { absent: name },
      bindings: new Map(),
    });
    const said = [line('one'), line('two')];
    const [here] = arrivalsRead([owed(HALL, marta, 1)], lookingAt(state));
    const at = (after: number): Arrived[] => [{ ...here!, after }];
    const order = (arrived: readonly Arrived[]) =>
      withArrivals(said, arrived).map((one) =>
        'said' in one ? words(one.said.said) : 'described',
      );
    expect(order(at(0))).toEqual(['described', 'absent one', 'absent two']);
    expect(order(at(1))).toEqual(['absent one', 'described', 'absent two']);
    expect(order(at(2))).toEqual(['absent one', 'absent two', 'described']);
    expect(order([])).toEqual(['absent one', 'absent two']);
  });
});
