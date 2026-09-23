// The corpus world `good/roles`, read through `runReading`: the lever,
// the actor asked first, the warded door and its key, the rusted gate
// that `without` leaves out, and the guard's topics.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { compiledWorld } from '../../fixtures/bundle.js';
import { declaredId, type InstanceId } from '../ids.js';
import { runReading, type Bound } from '../reading.js';
import {
  acted,
  contextOf,
  lines,
  NOTHING,
  reading,
  refused,
  setOn,
  turn,
  words,
  type Turn,
} from '../../fixtures/reading.js';

describe('the corpus world `good/roles`', () => {
  const folder = join(dirname(fileURLToPath(import.meta.url)), '../../../../../corpus/good/roles');
  const ROLES = compiledWorld('roles', {
    'world.sprout': readFileSync(join(folder, 'world.sprout'), 'utf8'),
    'kinds.sprout': readFileSync(join(folder, 'kinds.sprout'), 'utf8'),
  });
  const ROLES_HALL = declaredId('roles', ['hall']);
  const thing = (name: string): InstanceId => declaredId('roles', ['hall', name]);
  const [LEVER, DOOR, GATE, CORPUS_KEY, CORPUS_GUARD] = [
    'lever',
    'door',
    'gate',
    'key',
    'guard',
  ].map(thing);
  const play = (one: Turn, verb: string, bindings: Record<string, Bound>, library = 'roles') =>
    runReading(reading(ROLES, verb, one.people[0]!, bindings, library), contextOf(one));
  const held = (one: Turn, id: InstanceId, name: string) =>
    one.draft.instance(id)!.properties.get(name);

  it('pulls the lever once, saying its passage, and refuses the second pull in its words', () => {
    const one = turn(ROLES, [ROLES_HALL]);
    expect(lines(acted(play(one, 'pull', { target: { object: LEVER! } })))).toEqual([
      [LEVER, 'roles.Lever clunk: The lever drops with a clunk.'],
    ]);
    expect(held(one, LEVER!, 'pulled')).toBe(true);
    expect(refused(play(one, 'pull', { target: { object: LEVER! } }))).toMatchObject({
      by: LEVER,
      role: 'target',
      origin: 'roles.Lever',
      said: { text: 'It is already down.' },
    });
  });

  it('asks the actor first: full hands refuse before the lever is asked', () => {
    const one = turn(ROLES, [ROLES_HALL]);
    setOn(one, one.people[0]!, { capacity: 0 });
    expect(refused(play(one, 'pull', { target: { object: LEVER! } }))).toMatchObject({
      by: one.people[0],
      role: 'actor',
      said: { text: 'Your hands are full.' },
    });
  });

  it('unlocks the warded door with the key, both locks consenting and the key worn', () => {
    const one = turn(ROLES, [ROLES_HALL]);
    const unlock = (tool?: InstanceId) =>
      play(one, 'unlock', {
        target: { object: DOOR! },
        ...(tool === undefined ? {} : { tool: { object: tool } }),
      });
    expect(words(refused(unlock()).said)).toBe('You need something to turn the lock with.');
    expect(lines(acted(unlock(CORPUS_KEY)))).toEqual([[DOOR, 'The lock turns over.']]);
    expect([held(one, DOOR!, 'locked'), held(one, CORPUS_KEY!, 'wear')]).toEqual([false, 1]);
    // `Lockable`'s refusal is asked before the ward's.
    expect(refused(unlock(CORPUS_KEY))).toMatchObject({
      origin: 'roles.Lockable',
      said: { text: 'It is already unlocked.' },
    });
  });

  it('leaves out what `without` leaves out: the rusted gate neither refuses nor turns', () => {
    const one = turn(ROLES, [ROLES_HALL]);
    setOn(one, GATE!, { locked: false });
    const said = acted(
      play(one, 'unlock', { target: { object: GATE! }, tool: { object: CORPUS_KEY! } }),
    );
    // `Lockable`'s "already unlocked" and its bolt are gone; the ward ran,
    // the key wore, and nothing was said to the actor.
    expect(lines(said)).toEqual([[declaredId('roles', []), NOTHING]]);
    expect(held(one, CORPUS_KEY!, 'wear')).toBe(1);
  });

  it('asks the guard about a topic it knows, and about one it does not', () => {
    const one = turn(ROLES, [ROLES_HALL]);
    const ask = (topic: string) =>
      lines(
        acted(
          play(
            one,
            'ask',
            { target: { object: CORPUS_GUARD! }, topic: { value: topic } },
            'sprout',
          ),
        ),
      );
    expect(ask('toll')).toEqual([
      [CORPUS_GUARD, 'roles.Guard toll_speech: Two coppers to cross, and no haggling.'],
    ]);
    expect(ask('weather')).toEqual([[CORPUS_GUARD, 'The guard has nothing to say about that.']]);
  });
});
