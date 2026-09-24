// What a fault is, and the world's words for one (the spec's The runtime
// › Faults, The view). Anything a turn's body throws is a fault and
// abandons the turn's transaction: a rule the language names — a budget
// spent, a spawn, a move, a `connect` or an `act` that could not be made,
// a name that reaches nothing, a value its property cannot hold, an
// extension that threw or gave what it may not, an integer out of range,
// a full list, a wake past the host's cap — or a
// defect of the engine's own, which is told the same way, since no turn
// ends with nothing said, and is marked for the host to report loudly.
//
// A fault is told in the world's own passage, `fault` to a command's
// actor and `unseen` for a poll, as it applies on the world's kind. A
// world whose standard library leaves one out is told the stock line in
// fixed words instead, so a fault is never silent.

import type { ResolvedPassage } from '../declare/passages.js';
import { ActFault } from './act.js';
import { ValueOutOfRange, type Speech } from './body.js';
import { engineLine } from './engine-lines.js';
import { ExtensionFault } from './extension-fault.js';
import { BudgetExhausted } from './budget.js';
import { boundObject, IntegerOverflow, type Evaluated } from './evaluate.js';
import type { Effect } from './effects.js';
import type { InstanceId, VisitKey } from './ids.js';
import { LifecycleFault } from './lifecycle.js';
import { ConnectFault } from './links.js';
import { ListFull } from './lists.js';
import { MoveFault } from './move.js';
import { DestroyedReference, NameOutOfRange } from './named.js';
import type { Said } from './reading.js';
import type { StateReader } from './state.js';
import { WakeFault } from './wakes.js';

/** A turn that faulted: what was broken, for the log and the host; never shown to a visitor. */
export interface Fault {
  /** The rule broken, by the error's name: `BudgetExhausted`, `MoveFault`, `ListFull`, …. */
  readonly name: string;
  /** What happened, naming objects by id. */
  readonly detail: string;
  /** The instance the fault is about, where the rule names one. */
  readonly object: InstanceId | null;
  /** True where nothing the world did explains it: the engine's own defect, which the host reports loudly. */
  readonly engine: boolean;
  /** The extension whose code threw or gave what it may not, which the host reports as that extension's; null for every other fault. */
  readonly extension: string | null;
}

/** The world's passages a fault is told in: `fault` to a command's actor, `unseen` for a poll. */
export type FaultPassage = 'fault' | 'unseen';

/** The stock lines, in fixed words, for a world whose standard library leaves the passage out. */
const STOCK: Readonly<Record<FaultPassage, string>> = {
  fault: 'Something in this world has gone wrong, and nothing has changed.',
  unseen: 'Something here is too much to take in.',
};

/** The stock line for `name`, in the engine's fixed words, which binds nothing. */
export function stockLine(name: FaultPassage): string {
  return STOCK[name];
}

/** What `thrown` says about the turn it ended. */
export function faultOf(thrown: unknown): Fault {
  if (!(thrown instanceof Error)) {
    return { name: 'Error', detail: String(thrown), object: null, engine: true, extension: null };
  }
  const about = objectOf(thrown);
  return {
    name: thrown.name,
    detail: thrown.message,
    object: about === undefined ? null : about,
    engine: about === undefined,
    extension: thrown instanceof ExtensionFault ? thrown.extension : null,
  };
}

/**
 * The object a fault the language names is about: an id, null where it
 * names none, or undefined for an error that is no rule of the language's.
 */
function objectOf(error: Error): InstanceId | null | undefined {
  if (
    error instanceof LifecycleFault ||
    error instanceof MoveFault ||
    error instanceof ConnectFault ||
    error instanceof ActFault ||
    error instanceof DestroyedReference ||
    error instanceof NameOutOfRange ||
    error instanceof WakeFault ||
    error instanceof ExtensionFault
  ) {
    return error.object;
  }
  if (
    error instanceof BudgetExhausted ||
    error instanceof ValueOutOfRange ||
    error instanceof IntegerOverflow ||
    error instanceof ListFull
  ) {
    return null;
  }
  return undefined;
}

/** The world's passage `name`, as it applies on the world's kind, or its stock line where the world has none. */
export function worldSpeech(state: StateReader, name: FaultPassage): Speech {
  const passage: ResolvedPassage | undefined = state.instance(state.world)?.kind.passages.get(name);
  return passage === undefined ? engineLine(STOCK[name]) : { passage };
}

/**
 * What `actor` is told of a fault: the world's `fault`, from the world,
 * rendered with `actor` and `here` (the spec's Faults). Where the place
 * the actor stands in is gone, `here` cannot be bound, so the stock line
 * is told instead, which binds nothing.
 */
export function faultTold(state: StateReader, actor: InstanceId): Said {
  const bindings = new Map<string, Evaluated>([['actor', boundObject(actor)]]);
  const place = state.instance(actor)?.container ?? null;
  const gone = place === null || state.instance(place) === undefined;
  if (!gone) bindings.set('here', boundObject(place));
  return {
    effect: 'notice',
    to: [actor],
    by: state.world,
    speaker: null,
    said: gone ? engineLine(STOCK.fault) : worldSpeech(state, 'fault'),
    bindings,
  };
}

/**
 * The stock line for a fault, from the world, to `actor`, as the effect
 * it is: told where the world's own words cannot be rendered, and made
 * without rendering, since it names nothing, so a fault is never silent.
 */
export function stockFaultEffect(state: StateReader, actor: InstanceId, visit: VisitKey): Effect {
  return {
    kind: 'notice',
    from: state.world,
    actor,
    to: actor,
    visit,
    paragraphs: [STOCK.fault],
  };
}
