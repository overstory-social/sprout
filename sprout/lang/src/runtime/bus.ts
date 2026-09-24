// The queue, drained (the spec's Events, messages and the bus; The
// runtime › Turns; The world model › Destroying; Limits › Runtime
// budgets). A message is queued, never called: the body that sent it runs
// to its end, and then the queue drains breadth-first, in insertion order,
// each handler's own sends queued behind everything already waiting. A
// delivery runs every handler the recipient's kind composes for the
// message, or every hook for the property, in run order, and each one that
// runs is one event against the turn's budget, one deeper than the event
// that sent it against the cascade depth.
//
// Two invariants. A destroyed object has no effects: what is queued to it,
// what it sent that is still waiting, and the engine's messages naming it
// as their `from` are dropped, and what its destroying body sent goes with
// it. And the queue is the one place those rules are kept: nothing else
// delivers. Once it is empty, what `finally destroy self` marked is
// destroyed, in the order marked, and that sends nothing.

import { libraryOf } from '../declare/enums.js';
import type { KindRef } from '../declare/kinds.js';
import { messageKey } from '../declare/messages.js';
import type { Block, Parameters } from '../syntax/ast.js';
import { runBody } from './body.js';
import { boundObject, boundValue, type Evaluated, type Frame } from './evaluate.js';
import type { InstanceId } from './ids.js';
import { destroyInstance } from './lifecycle.js';
import { isLive } from './live.js';
import type { Notice } from './move.js';
import { actingSink, turnState, type ReadingContext, type Said } from './reading.js';
import type { Sent } from './sends.js';

/** What the effect pass left: what it queued, what it destroyed, and what it marked. */
export interface Queued {
  readonly sends: readonly Sent[];
  readonly destroyed: readonly InstanceId[];
  readonly marked: readonly InstanceId[];
}

/** What draining the queue did, in delivery order. */
export interface Drained {
  /**
   * What handlers had said: a refused `move`, said to nobody, since
   * nobody is acting; and an NPC's reading performed with `act`, heard as
   * its own is.
   */
  readonly said: readonly Said[];
  /** What the places spoke of each actor a handler moved between two. */
  readonly notices: readonly Notice[];
  /** Everything destroyed while the queue drained, and once it was empty. */
  readonly destroyed: readonly InstanceId[];
  /** How many deliveries ran a handler or a hook. */
  readonly events: number;
}

/** One delivery waiting in the queue, and how deep it runs. */
interface Envelope {
  readonly sent: Sent;
  readonly depth: number;
}

/**
 * Deliver everything `queued` holds, and everything that sends, until the
 * queue is empty, then destroy what was marked. Each delivery is one event
 * deeper than what sent it, the effect pass's own at depth 1.
 */
export function drain(queued: Queued, context: ReadingContext): Drained {
  const { draft, budget } = context;
  const gone = new Set<InstanceId>();
  const said: Said[] = [];
  const notices: Notice[] = [];
  const destroyed: InstanceId[] = [];
  const marked: InstanceId[] = [...queued.marked];
  // Read from `head`; what is before it has been delivered.
  let queue: Envelope[] = [];
  let head = 0;
  let events = 0;

  const drop = (removed: readonly InstanceId[]): void => {
    if (removed.length === 0) return;
    for (const id of removed) gone.add(id);
    destroyed.push(...removed);
    queue = queue.slice(head).filter(({ sent }) => !touchesGone(sent, gone));
    head = 0;
  };
  const enqueue = (sends: readonly Sent[], depth: number): void => {
    for (const sent of sends) if (!touchesGone(sent, gone)) queue.push({ sent, depth });
  };

  drop(queued.destroyed);
  enqueue(queued.sends, 1);

  while (head < queue.length) {
    const { sent, depth } = queue[head++]!;
    const recipient = draft.instance(sent.recipient);
    if (recipient === undefined || !isLive(draft, sent.recipient)) continue;
    const bodies = bodiesFor(sent, recipient.kind);
    if (bodies.length === 0) continue;
    budget.event();
    budget.cascadeTo(depth);
    events += 1;
    for (const body of bodies) {
      // `destroy self` takes effect as the body that ran it ends, so a
      // composed handler after it has no `self` to run for.
      if (draft.instance(sent.recipient) === undefined) break;
      const { sink, acted } = actingSink(context, depth, () => [], null);
      runBody(body.block, frameFor(sent, body, context), 'act', sink);
      said.push(...acted.said);
      notices.push(...acted.notices);
      marked.push(...acted.marked);
      drop(acted.destroyed);
      enqueue(acted.sends, depth + 1);
    }
  }

  // Once every message is handled, what was marked goes, as `destroy self` would.
  for (const id of marked) {
    if (gone.has(id) || draft.instance(id) === undefined) continue;
    drop(destroyInstance(draft, id).removed);
  }
  return { said, notices, destroyed, events };
}

/** One body a delivery runs: its block, what it names what it is passed, and the kind that wrote it. */
interface Delivered {
  readonly block: Block;
  readonly parameters: Parameters;
  readonly origin: string;
}

/** What `sent` runs on a recipient of `kind`: its handlers for the message, or its hooks for the property. */
function bodiesFor(sent: Sent, kind: KindRef): Delivered[] {
  if (sent.message === 'changed') {
    return (kind.hooks.get(sent.property) ?? []).map(({ origin, declaration }) => ({
      block: declaration.body,
      parameters: declaration.parameters,
      origin,
    }));
  }
  const key = sent.message === 'authored' ? messageKey({ declared: sent.declared }) : sent.message;
  return (kind.handlers.get(key) ?? []).map(({ origin, declaration }) => ({
    block: declaration.body,
    parameters: declaration.parameters,
    origin,
  }));
}

/**
 * What a delivery passes its handler, positionally: an authored message's
 * sender and the value it carries; an engine message's objects in the
 * order Receiving names them, or the `elapsed` of a tick or a wake; a
 * hook's previous value.
 */
function passed(sent: Sent): Evaluated[] {
  switch (sent.message) {
    case 'authored':
      return sent.value === null
        ? [boundObject(sent.from)]
        : [boundObject(sent.from), boundValue(sent.value)];
    case 'changed':
      return [boundValue(sent.was)];
    case 'entered':
      return [boundObject(sent.item), boundObject(sent.from)];
    case 'left':
      return [boundObject(sent.item), boundObject(sent.to)];
    case 'moved':
      return [boundObject(sent.from), boundObject(sent.to)];
    case 'arrived':
      return [boundObject(sent.actor), boundObject(sent.from)];
    case 'departed':
      return [boundObject(sent.actor), boundObject(sent.to)];
    case 'spawned':
      return [boundObject(sent.from)];
    case 'tick':
    case 'woke':
      return [boundValue(sent.elapsed)];
  }
}

/** The frame a handler or a hook runs in: `self` the recipient, and each parameter it names bound. */
function frameFor(sent: Sent, body: Delivered, context: ReadingContext): Frame {
  const values = passed(sent);
  const bindings = new Map<string, Evaluated>();
  body.parameters.forEach((name, i) => {
    const value = values[i];
    if (name !== null && value !== undefined) bindings.set(name.text, value);
  });
  return {
    state: turnState(context.draft),
    kinds: context.catalogue.lookup,
    library: libraryOf(body.origin),
    self: sent.recipient,
    bindings,
    budget: context.budget,
    caps: context.catalogue.caps,
    names: context.catalogue.names,
    passes: context.passes,
  };
}

/**
 * Whether a destroyed object takes `sent` with it: queued to it, sent by
 * it, or an engine message naming it as its `from`.
 */
function touchesGone(sent: Sent, gone: ReadonlySet<InstanceId>): boolean {
  if (gone.has(sent.recipient)) return true;
  return 'from' in sent && gone.has(sent.from);
}
