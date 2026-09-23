// A handler binds the sender and the value a message carries, `_` typed
// out of scope rather than bound under another name; a hook binds a
// property's previous value; and the engine's own eight messages —
// `entered`, `left`, `moved`, `arrived`, `departed`, `spawned`, `tick`,
// `woke` — bind what the spec names them, `elapsed` as an integer and
// everything else as an object.

import { describe, expect, it } from 'vitest';

import type { Ident } from '../../syntax/ast.js';
import { ENGINE_MESSAGES } from '../../declare/engine-messages.js';
import {
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
  it('binds them positionally, under the names the spec writes', () => {
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
      const made = engineParameters(
        message,
        parameters(...written[message.name]!),
        at('item'),
        new Diagnostics(),
      );
      expect(
        made.map((b) => b.name),
        message.name,
      ).toEqual(written[message.name]);
    }
  });

  it('types `elapsed` as an integer and everything else as an object', () => {
    for (const message of ENGINE_MESSAGES) {
      const names = message.parameters.map((one) => one.name);
      const made = engineParameters(message, parameters(...names), at('item'), new Diagnostics());
      for (const binding of made) {
        const wanted = binding.name === 'elapsed' ? valueOf(integer()) : OPEN_OBJECT;
        expect(binding.type, `:${message.name} (${binding.name})`).toEqual(wanted);
      }
    }
  });
});

describe('the engine’s own messages bind positionally, under the author’s names', () => {
  const entered = ENGINE_MESSAGES.find((one) => one.name === 'entered')!;

  it('binds what a position passes under whatever the author named it', () => {
    const made = engineParameters(
      entered,
      parameters('thing', 'pot'),
      at('thing'),
      new Diagnostics(),
    );
    expect(made.map((b) => [b.name, b.type])).toEqual([
      ['thing', OPEN_OBJECT],
      ['pot', OPEN_OBJECT],
    ]);
  });

  it('leaves `_` unbound, and what is left off after the last named', () => {
    const made = engineParameters(entered, parameters(null, 'from'), at('from'), new Diagnostics());
    expect(made.map((b) => b.name)).toEqual(['from']);
    expect(
      engineParameters(entered, parameters('item'), at('item'), new Diagnostics()).map(
        (b) => b.name,
      ),
    ).toEqual(['item']);
  });

  it('refuses one past what the message passes, naming what it does', () => {
    const { made, said } = trying((d) =>
      engineParameters(entered, parameters('item', 'from', 'n'), at('n'), d),
    );
    expect(made).toEqual([]);
    expect(said).toEqual([
      '`:entered` passes `item` and `from`, and nothing else. Write `on :entered (item, from)`, naming as many as you need.',
    ]);
  });
});
