import { describe, expect, it } from 'vitest';

import { ENGINE_MESSAGES, engineMessage } from './engine-messages.js';

describe('the engine’s own messages', () => {
  it('are the eight the spec lists, and only those', () => {
    expect(ENGINE_MESSAGES.map((m) => m.name)).toEqual([
      'entered',
      'left',
      'moved',
      'arrived',
      'departed',
      'spawned',
      'tick',
      'woke',
    ]);
  });

  it('pass what the spec names, in its order', () => {
    const passed = Object.fromEntries(
      ENGINE_MESSAGES.map((m) => [m.name, m.parameters.map((p) => `${p.name}:${p.binds}`)]),
    );
    expect(passed).toEqual({
      entered: ['item:object', 'from:object'],
      left: ['item:object', 'to:object'],
      moved: ['from:object', 'to:object'],
      arrived: ['actor:object', 'from:object'],
      departed: ['actor:object', 'to:object'],
      spawned: ['from:object'],
      tick: ['elapsed:integer'],
      woke: ['elapsed:integer'],
    });
  });

  it('knows one of its own from an authored one', () => {
    expect(engineMessage('tick')!.name).toBe('tick');
    expect(engineMessage('entered')!.parameters.map((p) => p.name)).toEqual(['item', 'from']);
    expect(engineMessage('illuminating')).toBeNull();
    expect(engineMessage('stir')).toBeNull();
  });
});
