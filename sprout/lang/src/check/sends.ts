// What the compiler checks of a `send` and a `broadcast` (the spec's
// Events, messages and the bus › Declaring a message, Sending; The
// compiler › What it refuses). A send goes to one object, a binding or an
// identifier; the message is one a library declares, since the engine
// sends its own; and what it carries is given exactly when it carries
// something, of the type its declaration says. Where one may stand is
// `blocks.ts`'s.

import type { BroadcastStatement, Expr, Ident, SendStatement } from '../syntax/ast.js';
import { writtenPath } from '../syntax/ast.js';
import { readable } from '../source/words.js';
import { ENGINE_MESSAGES } from '../declare/engine-messages.js';
import { namedMessage } from '../declare/handlers.js';
import type { DeclaredMessage } from '../declare/messages.js';
import { describeType } from '../declare/types.js';
import { showBindingType } from './bindings.js';
import { checkValue, type CheckContext } from './check.js';
import { pathType } from './statements.js';

const ENGINE_NAMES = ENGINE_MESSAGES.map((message) => `:${message.name}`);

/** `send oak_door :unlock_attempt` — true where nothing in it was refused. */
export function checkSend(statement: SendStatement, context: CheckContext): boolean {
  const type = pathType(statement.target, context);
  let passed = type !== null;
  const written = writtenPath(statement.target);
  if (type !== null && type.binds !== 'object') {
    context.diagnostics.refuse(
      statement.target.at,
      `\`send\` sends to one thing, and \`${written}\` is ${showBindingType(type)}.`,
      type.binds === 'set'
        ? 'Name one thing, as in `send oak_door :unlock_attempt`; a set is sent to one of its things at a time.'
        : 'Name a thing in the world, as in `send oak_door :unlock_attempt`; a value hears nothing.',
    );
    passed = false;
  }
  const message = sent(statement.message, context);
  if (message === null) return false;
  const head = `send ${written} :${statement.message.text}`;
  return carries(message, statement.message, statement.value, head, context) && passed;
}

/** `broadcast :illuminating with true` — true where nothing in it was refused. */
export function checkBroadcast(statement: BroadcastStatement, context: CheckContext): boolean {
  const message = sent(statement.message, context);
  if (message === null) return false;
  const head = `broadcast :${statement.message.text}`;
  return carries(message, statement.message, statement.value, head, context);
}

/** The declared message a statement sends, or null having said why: the engine's, or nothing's. */
function sent(written: Ident, context: CheckContext): DeclaredMessage | null {
  const messages = context.messages;
  if (messages === undefined) {
    throw new Error('a send was checked with no messages to reach; a body is checked with them.');
  }
  const reached = namedMessage(written, {
    library: context.from,
    messages: messages.lookup,
    diagnostics: context.diagnostics,
    ...(messages.onUnknown === undefined ? {} : { onUnknownMessage: messages.onUnknown }),
  });
  if (reached === null) return null;
  if ('declared' in reached) return reached.declared;
  context.diagnostics.refuse(
    written.at,
    `\`:${written.text}\` is one of the engine's messages, and the engine sends those itself.`,
    `The engine's messages are ${readable(ENGINE_NAMES)}. Declare one of your own, as in \`message :rang\`, and send that.`,
  );
  return null;
}

/** Whether a send gives what its message carries: a value exactly where it carries one, of its type. */
function carries(
  message: DeclaredMessage,
  named: Ident,
  value: Expr | null,
  written: string,
  context: CheckContext,
): boolean {
  const type = message.carries;
  if (type === null) {
    if (value === null) return true;
    context.diagnostics.refuse(
      value.at,
      `\`:${message.name}\` carries no value.`,
      `Take \`with …\` off, as in \`${written}\`, or declare the value with \`message :${message.name} with <type>\`.`,
    );
    return false;
  }
  if (value === null) {
    context.diagnostics.refuse(
      named.at,
      `\`:${message.name}\` carries ${describeType(type)}, and \`${written}\` gives it none.`,
      `Write \`${written} with <value>\`, the value it carries.`,
    );
    return false;
  }
  return checkValue(value, type, context, `\`:${message.name}\` carries`);
}
