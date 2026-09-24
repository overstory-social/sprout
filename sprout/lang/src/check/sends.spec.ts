import { describe, expect, it } from 'vitest';

import type { BroadcastStatement, SendStatement } from '../syntax/ast.js';
import { Diagnostics } from '../source/diagnostics.js';
import { SourceFile } from '../source/source.js';
import { parseDeclarations } from '../syntax/parse.js';
import { EnumTable } from '../declare/enums.js';
import { MessageTable } from '../declare/messages.js';
import { readStatement } from '../fixtures/parse.js';
import { bodyOf, saidBy, vessel, VESSEL } from '../fixtures/check.js';
import type { CheckContext } from './check.js';
import { checkBroadcast, checkSend } from './sends.js';

const MESSAGES = (() => {
  const diagnostics = new Diagnostics();
  const table = new MessageTable();
  table.add(
    'shop',
    parseDeclarations(
      new SourceFile(
        'm.sprout',
        'message :illuminating with boolean\nmessage :gust\nmessage :pong with integer\n',
      ),
      diagnostics,
    ).filter((d) => d.kind === 'message'),
    new EnumTable(),
    diagnostics,
  );
  return table;
})();

/** A body that may send, with a hook telling of a message nothing declares. */
function sending(base: CheckContext = bodyOf(VESSEL)) {
  const told: string[] = [];
  const context: CheckContext = {
    ...base,
    messages: { lookup: MESSAGES, onUnknown: (written) => told.push(written.text) },
  };
  return { context, told };
}

function checked(text: string, base?: CheckContext) {
  const { statement } = readStatement(text);
  const { context, told } = sending(base);
  const passed =
    statement!.kind === 'send'
      ? checkSend(statement as SendStatement, context)
      : checkBroadcast(statement as BroadcastStatement, context);
  return { passed, said: saidBy(context), told };
}

describe('a send', () => {
  it('goes to one thing, with what its message carries', () => {
    expect(checked('send self :illuminating with true')).toEqual({
      passed: true,
      said: [],
      told: [],
    });
    expect(checked('send actor :gust').said).toEqual([]);
    expect(checked('send target :pong with 3', vessel()).said).toEqual([]);
  });

  it('refuses a set or a value as who it goes to', () => {
    expect(checked('send tools :gust', vessel()).said).toEqual([
      '`send` sends to one thing, and `tools` is a set of shop.Rib. Name one thing, as in `send oak_door :unlock_attempt`; a set is sent to one of its things at a time.',
    ]);
  });

  it('refuses one of the engine’s messages, which the engine sends itself', () => {
    expect(checked('send self :entered').said).toEqual([
      "`:entered` is one of the engine's messages, and the engine sends those itself. The engine's messages are `:entered`, `:left`, `:moved`, `:arrived`, `:departed`, `:spawned`, `:tick` and `:woke`. Declare one of your own, as in `message :rang`, and send that.",
    ]);
  });

  it('tells of a message nothing declares, as the absent table’s row has it at load', () => {
    const { passed, told, said } = checked('send self :gusst');
    expect([passed, told, said]).toEqual([false, ['gusst'], []]);
  });

  it('refuses a value its message does not carry, one it leaves out, and one of the wrong type', () => {
    expect(checked('send self :gust with 1').said).toEqual([
      '`:gust` carries no value. Take `with …` off, as in `send self :gust`, or declare the value with `message :gust with <type>`.',
    ]);
    expect(checked('send self :illuminating').said).toEqual([
      '`:illuminating` carries true or false, and `send self :illuminating` gives it none. Write `send self :illuminating with <value>`, the value it carries.',
    ]);
    expect(checked('send self :illuminating with 1').said).toHaveLength(1);
  });
});

describe('a broadcast', () => {
  it('names a declared message and gives what it carries', () => {
    expect(checked('broadcast :illuminating with false').said).toEqual([]);
    expect(checked('broadcast :pong').said).toEqual([
      '`:pong` carries a whole number, and `broadcast :pong` gives it none. Write `broadcast :pong with <value>`, the value it carries.',
    ]);
  });
});
