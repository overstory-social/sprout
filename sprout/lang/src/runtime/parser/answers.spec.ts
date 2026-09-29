import { describe, expect, it } from 'vitest';

import { HALL, study } from '../../fixtures/parser.js';
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
  });

  it('says `not_here` in the world’s words, with `actor` and `here` bound and nothing it names', () => {
    const none = answer(one.draft, 'not_here', actor, HALL);
    expect(text(none.said)).toEqual([
      'sprout.World',
      'not_here',
      'You see nothing like that here.',
    ]);
    expect([...none.bindings.keys()]).toEqual(['actor', 'here']);
  });

  it('says `cannot` in the world’s words, with the reading as far as it was understood', () => {
    const cannot = answer(one.draft, 'cannot', actor, HALL, 'unlock the door with the gong');
    expect(text(cannot.said)).toEqual(['sprout.World', 'cannot', "You can't {reading}."]);
    expect([...cannot.bindings]).toEqual([
      ['actor', { binds: 'object', id: actor }],
      ['here', { binds: 'object', id: HALL }],
      ['reading', { binds: 'value', value: 'unlock the door with the gong' }],
    ]);
  });

  it('is the standard library’s words, said by the engine, where nothing writes the line', () => {
    const world = one.draft.instance(one.draft.world)!;
    const bare = { ...world, kind: { ...world.kind, passages: new Map() } };
    const state: StateReader = {
      world: one.draft.world,
      instance: (id) => (id === one.draft.world ? bare : one.draft.instance(id)),
      children: (id) => one.draft.children(id),
      visitor: (visit) => one.draft.visitor(visit),
      tombstoned: (id) => one.draft.tombstoned(id),
    };
    expect(answer(state, 'unknown', actor, HALL)).toMatchObject({
      by: one.draft.world,
      said: { text: 'That is not something you can do here.' },
    });
  });
});
