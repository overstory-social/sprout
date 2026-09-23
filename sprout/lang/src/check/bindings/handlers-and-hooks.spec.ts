// A handler binds the sender and the value a message carries, `_` typed
// out of scope rather than bound under another name; a hook binds a
// property's previous value; and the engine's own eight messages —
// `entered`, `left`, `moved`, `arrived`, `departed`, `spawned`, `tick`,
// `woke` — bind what the spec names them, `elapsed` as an integer and
// everything else as an object.

import { describe, expect, it } from 'vitest';

import type { Ident } from '../../syntax/ast.js';
import {
  ENGINE_MESSAGES,
  engineMessage,
  engineParameters,
  handlerParameters,
  OPEN_OBJECT,
  valueOf,
  wasBinding,
} from '../bindings.js';
import type { DeclaredMessage } from '../../declare/messages.js';
import { Diagnostics } from '../../source/diagnostics.js';
import { integer } from '../../declare/types.js';
import { at, KNOWS, message, parameters, trying } from '../../fixtures/bindings.js';

describe('a handler binds the sender and the value it carries', () => {
  it('reads the spec’s own four handlers', () => {
    const shapes: [DeclaredMessage, (Ident | null)[], string[]][] = [
      [message('illuminating'), parameters('from', 'value'), ['from', 'value']],
      [message('gust'), parameters('from'), ['from']],
      [message('gust'), parameters(), []],
      [message('pong'), parameters(null, 'value'), ['value']],
    ];
    for (const [declared, written, names] of shapes) {
      const { made, said } = trying((d) => handlerParameters(declared, written, at('from'), d));
      expect(said, `:${declared.name}`).toEqual([]);
      expect(
        made.map((b) => b.name),
        `:${declared.name}`,
      ).toEqual(names);
    }
  });

  it('types `_` out of scope rather than binding it under another name', () => {
    const made = handlerParameters(
      message('pong'),
      parameters(null, 'value'),
      at('value'),
      new Diagnostics(),
    );
    expect(made).toHaveLength(1);
    expect(made[0]!.name).toBe('value');
    expect(made[0]!.type).toEqual(valueOf(integer()));
  });

  it('refuses a value on a message that carries none, naming both ways out', () => {
    const { made, said } = trying((d) =>
      handlerParameters(message('gust'), parameters('from', 'value'), at('value'), d),
    );
    expect(made.map((b) => b.name)).toEqual(['from']);
    expect(said.join(' ')).toContain('carries no value');
    expect(said.join(' ')).toContain('message :gust with');
  });

  it('refuses a third parameter, because there is no third thing to bind', () => {
    const { made, said } = trying((d) =>
      handlerParameters(
        message('illuminating'),
        parameters('from', 'value', 'item'),
        at('item'),
        d,
      ),
    );
    expect(made).toEqual([]);
    expect(said.join(' ')).toContain('and nothing else');
  });

  it('binds a hook’s previous value at the property that changed', () => {
    expect(wasBinding('was', KNOWS, at('was')).type).toEqual(valueOf(KNOWS.type));
  });
});

describe('the engine’s own messages bind what they name', () => {
  it('is the eight the spec lists, in its order, and only those', () => {
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

  it('binds them under the names the spec writes', () => {
    const written: Record<string, string[]> = {
      entered: ['item', 'from'],
      left: ['item', 'to'],
      moved: ['from', 'to'],
      arrived: ['actor', 'from'],
      departed: ['actor', 'to'],
      spawned: ['from'],
      tick: ['elapsed'],
      woke: ['elapsed'],
    };
    for (const message of ENGINE_MESSAGES) {
      const made = engineParameters(message, at('item'));
      expect(
        made.map((b) => b.name),
        message.name,
      ).toEqual(written[message.name]);
    }
  });

  it('types `elapsed` as an integer and everything else as an object', () => {
    for (const message of ENGINE_MESSAGES) {
      for (const binding of engineParameters(message, at('item'))) {
        const wanted = binding.name === 'elapsed' ? valueOf(integer()) : OPEN_OBJECT;
        expect(binding.type, `:${message.name} (${binding.name})`).toEqual(wanted);
      }
    }
  });

  it('knows one of its own from an authored one', () => {
    expect(engineMessage('tick')!.name).toBe('tick');
    expect(engineMessage('entered')!.parameters.map((p) => p.name)).toEqual(['item', 'from']);
    expect(engineMessage('arrived')!.parameters.map((p) => p.name)).toEqual(['actor', 'from']);
    expect(engineMessage('departed')!.parameters.map((p) => p.name)).toEqual(['actor', 'to']);
    expect(engineMessage('illuminating')).toBeNull();
    expect(engineMessage('stir')).toBeNull();
  });
});
