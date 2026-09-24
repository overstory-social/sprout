// A value role as each role-player hears it: bound for the player whose
// `from` holds the option, read from that player as it stands now, and a
// number bound within the range written or the property's own.

import { describe, expect, it } from 'vitest';

import type { InstanceId } from '../ids.js';
import type { SproutList } from '../lists.js';
import { heardBy, runReading } from '../reading.js';
import {
  acted,
  contextOf,
  DIAL,
  GUARD,
  HALL,
  lines,
  reading,
  SAFE,
  setOn,
  turn,
  YARD,
} from '../../fixtures/reading.js';

describe('a value role, as each role-player hears it', () => {
  it('binds for the player whose `from` holds the option, and not for one that wrote none', () => {
    const one = turn(YARD, [HALL]);
    const [visitor] = one.people;
    const ask = (topic: string) =>
      acted(
        runReading(
          reading(
            YARD,
            'ask',
            visitor!,
            { target: { object: GUARD }, topic: { value: topic } },
            'sprout',
          ),
          contextOf(one),
        ),
      );
    const toll = ask('toll');
    expect(lines(toll)).toEqual([
      [visitor, 'You ask.'],
      [GUARD, 'bound'],
    ]);
    expect(toll.said[0]!.bindings.has('topic')).toBe(false);
    expect(toll.said[1]!.bindings.get('topic')).toEqual({ binds: 'value', value: 'toll' });
    expect(lines(ask('weather'))[1]).toEqual([GUARD, 'unbound']);
  });

  it('reads the options from the role-player as it stands now', () => {
    const one = turn(YARD, [HALL]);
    const [visitor] = one.people;
    const knows = one.draft.instance(GUARD)!.properties.get('knows') as SproutList;
    setOn(one, GUARD, { knows: knows.add('weather') });
    const said = acted(
      runReading(
        reading(
          YARD,
          'ask',
          visitor!,
          { target: { object: GUARD }, topic: { value: 'weather' } },
          'sprout',
        ),
        contextOf(one),
      ),
    );
    expect(lines(said)[1]).toEqual([GUARD, 'bound']);
  });

  it('binds a number within the range written, or within the property’s range', () => {
    const one = turn(YARD, [HALL]);
    const [visitor] = one.people;
    const dial = (target: InstanceId, number: number) =>
      lines(
        acted(
          runReading(
            reading(YARD, 'dial', visitor!, {
              target: { object: target },
              number: { value: number },
            }),
            contextOf(one),
          ),
        ),
      )[0]![1];
    expect([dial(DIAL, 1), dial(DIAL, 12), dial(DIAL, 0), dial(DIAL, 13)]).toEqual([
      'bound',
      'bound',
      'unbound',
      'unbound',
    ]);
    expect([dial(SAFE, 0), dial(SAFE, 99), dial(SAFE, 100)]).toEqual(['bound', 'bound', 'unbound']);
  });

  it('says whether any participant hears a value, as the command parser asks before binding one', () => {
    const one = turn(YARD, [HALL]);
    const [visitor] = one.people;
    const ask = reading(YARD, 'ask', visitor!, { target: { object: GUARD } }, 'sprout');
    const topic = ask.verb.roles.find((role) => role.name === 'topic')!;
    expect(heardBy(ask, topic, 'toll', one.draft)).toBe(true);
    expect(heardBy(ask, topic, 'weather', one.draft)).toBe(false);
    const dial = reading(YARD, 'dial', visitor!, { target: { object: DIAL } });
    const number = dial.verb.roles.find((role) => role.name === 'number')!;
    expect([heardBy(dial, number, 12, one.draft), heardBy(dial, number, 13, one.draft)]).toEqual([
      true,
      false,
    ]);
  });
});
