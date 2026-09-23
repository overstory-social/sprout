// The two warnings about messages (the spec's The compiler › What it warns
// about): a handler nothing sends to, and a message nothing handles, the
// second symmetric with the first, so a `send` that will never arrive is
// visible at compile time rather than a silent no-op for ever. Only the
// world's own declarations and handlers are warned about: a library's are
// its author's, and a world that uses one uses what it needs of it.
//
// A message counts as sent where any body in the bundle sends or
// broadcasts it, and as handled where any kind in the bundle answers it;
// the engine's own messages are the engine's to send, and are never
// warned about.

import type { Block, Statement } from '../../syntax/ast.js';
import type { Diagnostics } from '../../source/diagnostics.js';
import { libraryOf } from '../../declare/enums.js';
import type { KindRef } from '../../declare/kinds.js';
import { messageKey, reachMessage, type MessageLookup } from '../../declare/messages.js';

/** What the warnings read: every composed kind, every message, and whose declarations are the world's. */
export interface EventSetting {
  readonly kinds: readonly KindRef[];
  readonly messages: MessageLookup;
  /** The world's own namespace. */
  readonly namespace: string;
  readonly diagnostics: Diagnostics;
}

/** Warn at each of the world's handlers nothing sends to, and at each of its messages nothing handles. */
export function warnUnsentAndUnhandled(setting: EventSetting): void {
  const { kinds, messages, namespace, diagnostics } = setting;
  const sent = new Set<string>();
  const handled = new Set<string>();
  for (const kind of kinds) {
    for (const [key, runs] of kind.handlers) {
      handled.add(key);
      for (const handler of runs) sendsIn(handler.origin, handler.declaration.body, messages, sent);
    }
    for (const runs of kind.hooks.values()) {
      for (const hook of runs) sendsIn(hook.origin, hook.declaration.body, messages, sent);
    }
    for (const plays of kind.plays.values()) {
      for (const play of plays) sendsIn(play.origin, play.declaration.do, messages, sent);
    }
  }

  const warned = new Set<unknown>();
  for (const kind of kinds) {
    for (const [key, runs] of kind.handlers) {
      if (sent.has(key)) continue;
      for (const { origin, message, declaration } of runs) {
        if ('engine' in message || libraryOf(origin) !== namespace || warned.has(declaration))
          continue;
        warned.add(declaration);
        const name = declaration.message.text;
        diagnostics.warn(
          declaration.message.at,
          `Nothing sends \`:${name}\`, so \`on :${name}\` never runs.`,
          `Send it with \`send <thing> :${name}\` or \`broadcast :${name}\`, or take the handler out.`,
        );
      }
    }
  }
  for (const declared of messages.all()) {
    if (declared.library !== namespace || handled.has(messageKey({ declared }))) continue;
    const name = declared.name;
    diagnostics.warn(
      declared.declaration.name.at,
      `Nothing handles \`:${name}\`, so sending it does nothing.`,
      `Write \`on :${name} { … }\` in the kind that should hear it, or take the message out.`,
    );
  }
}

/** Add to `sent` the key of every message `block` sends or broadcasts, read from `origin`'s library. */
function sendsIn(
  origin: string,
  block: Block | null,
  messages: MessageLookup,
  sent: Set<string>,
): void {
  const pending: Statement[] = [...(block?.statements ?? [])];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (next.kind === 'send' || next.kind === 'broadcast') {
      const reached = reachMessage(next.message.text, libraryOf(origin), messages);
      if (reached !== null) sent.add(messageKey(reached));
    }
    if (next.kind !== 'if') continue;
    pending.push(...next.then.statements);
    if (next.otherwise === null) continue;
    if (next.otherwise.kind === 'if') pending.push(next.otherwise);
    else pending.push(...next.otherwise.statements);
  }
}
