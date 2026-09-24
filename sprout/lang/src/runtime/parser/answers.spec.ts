import { describe, expect, it } from 'vitest';

import { BRASS_KEY, COIN, HALL, IRON_KEY, study } from '../../fixtures/parser.js';
import type { StateReader } from '../state.js';
import { answer } from './answers.js';

const one = study();
const actor = one.people[0]!;
const text = (said: ReturnType<typeof answer>['said']) =>
  'passage' in said ? [said.passage.origin, said.passage.name, said.passage.body.text.trim()] : [];

describe('the world’s answers to a line it could not run', () => {
  it('says `unknown` in the world’s words, with `actor` and `here` bound', () => {
    const unknown = answer(one.draft, 'unknown', actor, HALL);
    expect(text(unknown.said)).toEqual([
      'sprout.World',
      'unknown',
      'That is not something you can do here.',
    ]);
    expect([...unknown.bindings]).toEqual([
      ['actor', { binds: 'object', id: actor }],
      ['here', { binds: 'object', id: HALL }],
    ]);
    expect(unknown.choices).toEqual([]);
  });

  it('says `unreachable` with the thing it names bound as `thing`', () => {
    const far = answer(one.draft, 'unreachable', actor, HALL, { thing: COIN });
    expect(text(far.said)).toEqual([
      'sprout.World',
      'unreachable',
      'You cannot reach {thing} from here.',
    ]);
    expect(far.bindings.get('thing')).toEqual({ binds: 'object', id: COIN });
  });

  it('asks `which` with the candidates bound as a set, in the order offered', () => {
    const choices = [
      { id: BRASS_KEY, line: 'take brass key' },
      { id: IRON_KEY, line: 'take iron key' },
    ];
    const which = answer(one.draft, 'which', actor, HALL, { choices });
    expect(text(which.said)).toEqual([
      'sprout.World',
      'which',
      'Which do you mean: {for thing of candidates}{thing}{if $last}?{else}, {/if}{/for}',
    ]);
    expect(which.bindings.get('candidates')).toEqual({ binds: 'set', ids: [BRASS_KEY, IRON_KEY] });
    expect(which.choices).toEqual(choices);
  });

  it('is an engine error where the world composes no such passage', () => {
    const world = one.draft.instance(one.draft.world)!;
    const bare = { ...world, kind: { ...world.kind, passages: new Map() } };
    const state: StateReader = {
      world: one.draft.world,
      instance: (id) => (id === one.draft.world ? bare : one.draft.instance(id)),
      children: (id) => one.draft.children(id),
      visitor: (visit) => one.draft.visitor(visit),
      tombstoned: (id) => one.draft.tombstoned(id),
    };
    expect(() => answer(state, 'unknown', actor, HALL)).toThrow(
      'the world composes no `unknown` passage, which `sprout.World` writes.',
    );
  });
});
