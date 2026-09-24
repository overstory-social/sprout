// A maintenance turn: catch-up after an absence (the spec's Time ›
// Absence; The runtime › Faults; The host contract › Time). Run before an
// arriving visitor is admitted, it delivers every object's oldest due
// wake, one per object, oldest first, under the one budget the turn has;
// a wake one of them asks for waits for live time. Catch-up does not
// narrate: what the wakes did is kept and nothing they said is told.
//
// Each wake is a part of the turn, kept once it has run. A part that
// faults is abandoned and its wake consumed, as any faulted wake is, and
// the rest of the catch-up is abandoned with it, left pending; what
// earlier parts did stands, and the visitor is admitted either way.

import { Budget } from './budget.js';
import { Draws } from './draws.js';
import type { Fault } from './faults.js';
import type { WorldState } from './state.js';
import { elapsedSince, hostSeconds } from './time.js';
import {
  committedOver,
  writeUnder,
  type Committed,
  type TurnHost,
  type WriteInputs,
} from './turn.js';
import { consumeWake, deliverWake, pendingWake } from './wake.js';
import { dueWakes, onePerObject, type DueWake } from './wakes.js';

/** What a maintenance turn did. */
export interface CaughtUp {
  /** The wakes delivered, in the order they were. */
  readonly delivered: readonly DueWake[];
  /** The wake whose part faulted, consumed, and its fault; null where none did. */
  readonly faulted: { readonly wake: DueWake; readonly fault: Fault } | null;
  /** The wakes catch-up would have delivered after it, still pending for live time. */
  readonly abandoned: readonly DueWake[];
}

/**
 * Run catch-up as one maintenance turn over the committed `state`, at
 * the instant `inputs` gives. It always commits what it kept, which may
 * be nothing.
 */
export function maintenanceTurn(
  state: WorldState,
  host: TurnHost,
  inputs: WriteInputs,
): Committed<CaughtUp> {
  const now = hostSeconds(inputs.now, 'a maintenance turn’s time');
  const due = onePerObject(dueWakes(state, now));
  // Every part is charged to the one budget and draws from the one seed.
  const shared = {
    budget: new Budget(host.budgets, 'maintenance', host.clock),
    draws: new Draws(inputs.seed),
  };
  const delivered: DueWake[] = [];
  let at = state;
  for (const [i, listed] of due.entries()) {
    // An earlier wake may have destroyed this one's object, or moved it out of the tree.
    const wake = pendingWake(at, listed.object, listed.serial);
    if (wake === null) continue;
    const elapsed = elapsedSince(wake.askedAt, now);
    const part = writeUnder(shared, at, 'maintenance', host, inputs, (turn) => {
      deliverWake(turn, wake, elapsed);
    });
    if (part.committed) {
      at = part.state;
      delivered.push(wake);
      continue;
    }
    at = consumeWake(at, 'maintenance', host, inputs, wake).state;
    const after = at;
    const abandoned = due
      .slice(i + 1)
      .filter((rest) => pendingWake(after, rest.object, rest.serial) !== null);
    return committedOver(state, at, {
      delivered,
      faulted: { wake, fault: part.fault },
      abandoned,
    });
  }
  return committedOver(state, at, { delivered, faulted: null, abandoned: [] });
}
