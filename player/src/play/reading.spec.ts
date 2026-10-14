import { describe, expect, it } from 'vitest';

import type { InstanceId } from '@overstory/sprout/lang';

import { keptReadingOf } from './reading.js';

describe('keptReadingOf', () => {
  it('names the verb by library and name, and keeps each binding by id or value in the order it was bound', () => {
    const actor = 'yard#1' as InstanceId;
    const reading = keptReadingOf(
      {
        verb: { library: 'yard', name: 'stack' },
        bindings: [
          ['what', { set: ['yard.brick', 'yard.tile'] }],
          ['on', { object: 'yard.kiln' }],
          ['way', { exit: { direction: 'north', label: 'the gate', to: 'yard.lane' } }],
          ['times', { value: 3 }],
          ['how', { value: 'gently' }],
        ],
      },
      actor,
    );
    expect(reading).toEqual({
      verb: 'yard.stack',
      actor,
      bindings: [
        { role: 'what', binds: 'set', ids: ['yard.brick', 'yard.tile'] },
        { role: 'on', binds: 'object', id: 'yard.kiln' },
        { role: 'way', binds: 'exit', direction: 'north', label: 'the gate', to: 'yard.lane' },
        { role: 'times', binds: 'value', value: 3 },
        { role: 'how', binds: 'value', value: 'gently' },
      ],
    });
  });
});
