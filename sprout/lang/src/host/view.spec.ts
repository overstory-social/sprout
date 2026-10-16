import { describe, expect, it } from 'vitest';

import type { InstanceId } from './ids.js';
import type { SeenFiller } from './view.js';

describe('a reading’s fillers', () => {
  it('each carry the words before their role’s slot, whatever fills them', () => {
    const fillers: SeenFiller[] = [
      {
        role: 'target',
        words: '',
        binds: 'object',
        id: 'w.sack' as InstanceId,
        name: 'a sack',
        all: true,
      },
      {
        role: 'things',
        words: 'with',
        binds: 'set',
        ids: ['w.sack' as InstanceId],
        names: ['a sack'],
        all: true,
      },
      {
        role: 'way',
        words: '',
        binds: 'exit',
        direction: null,
        label: 'the stair',
        to: 'w.hall' as InstanceId,
      },
      { role: 'source', words: 'from', binds: 'unbound' },
    ];
    expect(fillers.map((filler) => filler.words)).toEqual(['', 'with', '', 'from']);
    // A tool a reading leaves out keeps its word, so a client can offer it beside the readings that fill it.
    expect(fillers.filter((filler) => filler.binds === 'unbound').map((f) => f.words)).toEqual([
      'from',
    ]);
  });
});
