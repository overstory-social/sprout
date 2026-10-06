import { describe, expect, it } from 'vitest';

import { compiledWorld } from '../../fixtures/bundle.js';
import { commandContext, type Study } from '../../fixtures/parser.js';
import { turn } from '../../fixtures/reading.js';
import { declaredId, type InstanceId } from '../ids.js';
import type { CommandOutcome } from '../parser.js';
import type { Reading } from '../reading.js';
import { readItem } from './item.js';

const SHELF = compiledWorld('shelf', {
  'shelf.sprout': [
    'world shelf is sprout.World { visitors are Person visitors arrive at room',
    '  object room is sprout.Place {',
    '    object coin is sprout.Fixture',
    '    object brass_key is sprout.Fixture',
    '    object iron_key is sprout.Fixture',
    '    object box is sprout.Container',
    '  }',
    '}',
    'verb wave { role thing carried  "wave [thing]" }',
  ].join('\n'),
  'person.sprout': 'kind Person is sprout.Visitor { }\n',
});
const at = (name: string): InstanceId => declaredId('shelf', ['room', name]);
const [COIN, BRASS_KEY, IRON_KEY, BOX] = ['coin', 'brass_key', 'iron_key', 'box'].map(at) as [
  InstanceId,
  InstanceId,
  InstanceId,
  InstanceId,
];
const shelf = (): Study => ({
  ...turn(SHELF, [declaredId('shelf', ['room'])]),
  nicknames: new Map(),
});

/** `words` read as the item filling `role` of `verb`, every other role as `bound` fills it. */
function item(
  words: string,
  verb: [string, string],
  role: string,
  bound: [string, InstanceId][],
  seed = 7,
  referents: readonly InstanceId[] = [],
): CommandOutcome {
  const one = shelf();
  const actor = one.people[0]!;
  const within: Reading = {
    verb: SHELF.verbs.qualified(...verb)!,
    actor,
    bindings: new Map(bound.map(([name, id]) => [name, { object: id }])),
  };
  return readItem(words, actor, within, role, commandContext(one, [], seed, referents));
}

const answerOf = (outcome: CommandOutcome) => ('answer' in outcome ? outcome.answer : null);

describe('an item of a run read on its own turn', () => {
  it('fills only its own role, every other role keeping what the line bound', () => {
    // `it` names the coin now, and the box was what the line's `it` named.
    const outcome = item('brass key', ['sprout', 'put'], 'item', [['container', BOX]], 7, [COIN]);
    if (!('understood' in outcome)) throw new Error('answered');
    expect([...outcome.understood.bindings]).toEqual([
      ['container', { object: BOX }],
      ['item', { object: BRASS_KEY }],
    ]);
    expect(outcome.rest).toEqual([]);
    expect(outcome.drawn).toBeNull();
  });

  it('draws among things that tie, as a line does, and says which was meant', () => {
    const picked = new Set<InstanceId>();
    for (let seed = 0; seed < 12; seed++) {
      const outcome = item('key', ['sprout', 'take'], 'target', [], seed);
      if (!('understood' in outcome)) throw new Error('answered');
      const bound = outcome.understood.bindings.get('target');
      if (bound === undefined || !('object' in bound)) throw new Error('no target');
      picked.add(bound.object);
      expect(outcome.drawn).toEqual({ among: 2, meant: bound.object });
    }
    expect([...picked].sort()).toEqual([BRASS_KEY, IRON_KEY].sort());
  });

  it('is `not_here` where its words name nothing in reach', () => {
    expect(answerOf(item('unicorn', ['sprout', 'take'], 'target', []))).toBe('not_here');
  });

  it('is `not_carrying` where a carried role names only what the actor does not carry', () => {
    const outcome = item('coin', ['shelf', 'wave'], 'thing', []);
    expect(answerOf(outcome)).toBe('not_carrying');
    expect('answer' in outcome && outcome.bindings.get('thing')).toEqual({
      binds: 'object',
      id: COIN,
    });
  });

  it('is `cannot` where what it names cannot fill the role, written with what the line bound', () => {
    const outcome = item('coin', ['sprout', 'put'], 'container', [['item', BRASS_KEY]]);
    expect(answerOf(outcome)).toBe('cannot');
    expect('answer' in outcome && outcome.bindings.get('reading')).toMatchObject({
      value: 'put the brass key in the coin',
    });
  });
});
