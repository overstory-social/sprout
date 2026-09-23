// What a `send` and a `broadcast` queue when they run (the spec's Events,
// messages and the bus › Sending). A directed send is queued to its target
// where the target is live and in the sender's range for that message,
// and to no one otherwise; a broadcast walks the sender's range for the
// message, nearest first (The world model › Range), and is queued to
// everything the walk reaches but the sender itself and a container
// outward that refuses, which the walk reaches only as a surface.
//
// Nothing is delivered here. The walk is made, and the value evaluated,
// when the statement runs, against the tree as it stands then; what is
// queued is the queue's to deliver (`bus.ts`), and the one thing it holds
// from each send is who sent what to whom.

import type { DeclaredMessage } from '../declare/messages.js';
import type { Budget } from './budget.js';
import type { InstanceId } from './ids.js';
import type { EngineSend } from './lifecycle.js';
import { isLive, liveTree } from './live.js';
import type { PlaceSend } from './move.js';
import { rangeOf, reaches, type PassRule } from './range.js';
import type { StateReader } from './state.js';
import type { Value } from './values.js';

/** A message an object's body sent, to one recipient. */
export interface AuthoredSend {
  readonly message: 'authored';
  readonly declared: DeclaredMessage;
  readonly recipient: InstanceId;
  /** The object whose body ran the statement: the handler's sender. */
  readonly from: InstanceId;
  /** What it carries, where its declaration says it carries anything. */
  readonly value: Value | null;
}

/**
 * A hook queued to `recipient` by a write of its own that changed
 * `property`, with the value it held before (the spec's Events › Receiving).
 */
export interface ChangedSend {
  readonly message: 'changed';
  readonly recipient: InstanceId;
  readonly property: string;
  readonly was: Value;
}

/** Everything queued: what the engine sends for itself, what bodies send, and hooks. */
export type Sent = EngineSend | PlaceSend | AuthoredSend | ChangedSend;

/** What a send reads: the turn's state, the pass rules, and the meter its walk is charged to. */
export interface SendContext {
  readonly state: StateReader;
  readonly passes: PassRule<InstanceId>;
  readonly budget: Budget;
}

/** `send target :m` by `sender`: one send where the target is live and in range, else none. */
export function sendTo(
  context: SendContext,
  sender: InstanceId,
  target: InstanceId | null,
  declared: DeclaredMessage,
  value: Value | null,
): AuthoredSend[] {
  if (target === null || !isLive(context.state, target)) return [];
  const range = { tree: liveTree(context.state), passes: context.passes, budget: context.budget };
  if (!reaches(range, sender, target, declared)) return [];
  return [{ message: 'authored', declared, recipient: target, from: sender, value }];
}

/** `broadcast :m` by `sender`: one send to each thing its range walk reaches, in walk order. */
export function broadcastFrom(
  context: SendContext,
  sender: InstanceId,
  declared: DeclaredMessage,
  value: Value | null,
): AuthoredSend[] {
  const range = { tree: liveTree(context.state), passes: context.passes, budget: context.budget };
  return rangeOf(range, sender, declared)
    .reached.filter(({ via }) => via === 'held' || via === 'passed')
    .map(({ node }) => ({ message: 'authored', declared, recipient: node, from: sender, value }));
}
