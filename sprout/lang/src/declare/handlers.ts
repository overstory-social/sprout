// Which handlers and hooks run, and in what order, on a composed kind (the
// spec's Kinds, composition and libraries › How members combine, the rows
// "`on :m` handler: all run" and "`changed :p` hook: all run"; Suppressing
// a contribution; Events, messages and the bus › Receiving).
//
// Both compose as guards do, through `contributions.ts`: each origin's
// runs once, in closure order, the composer's own last, less what a
// `without` leaves out. A handler is keyed by the message it answers as
// `messageKey` names it, resolved from the library of the kind that wrote
// it, so two libraries' `:stir` are two messages; a hook by the property.

import type { HandlerDeclaration, HookDeclaration, Ident, KindMember } from '../syntax/ast.js';
import type { Diagnostics } from '../source/diagnostics.js';
import type { Suppression } from './kinds.js';
import { composeContributions } from './contributions.js';
import {
  messageKey,
  reachMessage,
  unknownMessage,
  type MessageLookup,
  type ReachedMessage,
} from './messages.js';

/** One kind's handler, as a composed kind runs it. */
export interface ResolvedHandler {
  /** The kind that wrote it, by qualified name. */
  readonly origin: string;
  /** The message it answers, reached from the library that wrote it. */
  readonly message: ReachedMessage;
  readonly declaration: HandlerDeclaration;
}

/** One kind's hook, as a composed kind runs it. */
export interface ResolvedHook {
  readonly origin: string;
  readonly declaration: HookDeclaration;
}

/** Every handler a composed kind runs, by `messageKey`, in run order. */
export type Handlers = ReadonlyMap<string, readonly ResolvedHandler[]>;

/** Every hook a composed kind runs, by the property it watches, in run order. */
export type Hooks = ReadonlyMap<string, readonly ResolvedHook[]>;

/**
 * Told of a message a handler, a pass rule or a send names that nothing
 * declares. A compile at load makes it the absent table's `message` row;
 * with none it is refused.
 */
export type OnUnknownMessage = (written: Ident, message: string, remedy: string) => void;

/** What a composer's handlers name messages from: its library, and every message there is. */
export interface MessageSetting {
  readonly library: string;
  readonly messages: MessageLookup;
  readonly onUnknownMessage?: OnUnknownMessage;
  readonly diagnostics: Diagnostics;
}

/**
 * The message a member names, reached from `setting.library`, or null
 * having said, or told `onUnknownMessage`, that nothing declares it.
 */
export function namedMessage(written: Ident, setting: MessageSetting): ReachedMessage | null {
  const reached = reachMessage(written.text, setting.library, setting.messages);
  if (reached !== null) return reached;
  const { message, remedy } = unknownMessage(written.text, setting.library, setting.messages);
  if (setting.onUnknownMessage !== undefined) setting.onUnknownMessage(written, message, remedy);
  else setting.diagnostics.refuse(written.at, message, remedy);
  return null;
}

/**
 * The handlers a composer's own body writes, by `messageKey`, with
 * `origin` as their origin. One written twice for a message is refused
 * at the second, which is dropped; one whose message nothing declares is
 * dropped having said so.
 */
export function ownHandlers(
  composer: string,
  members: readonly KindMember[],
  origin: string,
  setting: MessageSetting,
): Map<string, ResolvedHandler> {
  const own = new Map<string, ResolvedHandler>();
  for (const member of members) {
    if (member.kind !== 'handler') continue;
    const message = namedMessage(member.message, setting);
    if (message === null) continue;
    const key = messageKey(message);
    if (own.has(key)) {
      setting.diagnostics.refuse(
        member.at,
        `\`${composer}\` writes \`on :${member.message.text}\` twice.`,
        'A kind answers a message once. Keep one, and write what both do in it, with `if` where they differ.',
      );
      continue;
    }
    own.set(key, { origin, message, declaration: member });
  }
  return own;
}

/** The hooks a composer's own body writes, by property; one written twice is refused at the second. */
export function ownHooks(
  composer: string,
  members: readonly KindMember[],
  origin: string,
  diagnostics: Diagnostics,
): Map<string, ResolvedHook> {
  const own = new Map<string, ResolvedHook>();
  for (const member of members) {
    if (member.kind !== 'hook') continue;
    const name = member.property.text;
    if (own.has(name)) {
      diagnostics.refuse(
        member.at,
        `\`${composer}\` writes \`changed :${name}\` twice.`,
        'A kind watches a property once. Keep one, and write what both do in it, with `if` where they differ.',
      );
      continue;
    }
    own.set(name, { origin, declaration: member });
  }
  return own;
}

/**
 * The handlers a composer runs, for each message: what its composed kinds
 * run, each origin once and in closure order (`order`, the composer not
 * in it), less what its own `suppressed` leaves out, then its own.
 */
export function composeHandlers(
  composed: readonly Handlers[],
  order: readonly string[],
  suppressed: readonly Suppression[],
  own: ReadonlyMap<string, ResolvedHandler>,
): Handlers {
  return composeKeyed(composed, order, suppressed, own, (suppression, handler) => {
    const { member, source } = suppression;
    return (
      member.kind === 'handler-ref' &&
      member.message.text === handler.declaration.message.text &&
      source === handler.origin
    );
  });
}

/** The hooks a composer runs, for each property, as `composeHandlers` composes handlers. */
export function composeHooks(
  composed: readonly Hooks[],
  order: readonly string[],
  suppressed: readonly Suppression[],
  own: ReadonlyMap<string, ResolvedHook>,
): Hooks {
  return composeKeyed(composed, order, suppressed, own, (suppression, hook) => {
    const { member, source } = suppression;
    return (
      member.kind === 'hook-ref' &&
      member.property.text === hook.declaration.property.text &&
      source === hook.origin
    );
  });
}

/** Whether a kind's handlers include one for the bare message `name` written by `origin` itself. */
export function writesHandler(handlers: Handlers, name: string, origin: string): boolean {
  return [...handlers.values()].some((runs) =>
    runs.some((one) => one.origin === origin && one.declaration.message.text === name),
  );
}

/** Whether a kind's hooks include one for `property` written by `origin` itself. */
export function writesHook(hooks: Hooks, property: string, origin: string): boolean {
  return (hooks.get(property) ?? []).some((one) => one.origin === origin);
}

function composeKeyed<C extends { readonly origin: string }>(
  composed: readonly ReadonlyMap<string, readonly C[]>[],
  order: readonly string[],
  suppressed: readonly Suppression[],
  own: ReadonlyMap<string, C>,
  leavesOut: (suppression: Suppression, contribution: C) => boolean,
): ReadonlyMap<string, readonly C[]> {
  const keys = new Set<string>();
  for (const map of composed) for (const key of map.keys()) keys.add(key);
  for (const key of own.keys()) keys.add(key);
  const runs = new Map<string, readonly C[]>();
  for (const key of keys) {
    const each = composeContributions(
      composed.map((map) => map.get(key) ?? []),
      order,
      suppressed,
      own.get(key),
      leavesOut,
    );
    if (each.length > 0) runs.set(key, each);
  }
  return runs;
}
