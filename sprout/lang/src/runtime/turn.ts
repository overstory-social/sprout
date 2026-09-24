// Turns (the spec's The runtime › Turns, Effects, Faults; Limits ›
// Runtime budgets). Everything that runs is a turn: the spec's five
// kinds, and a visitor's arrival and departure. A write turn — every kind
// but the poll — runs in a draft over the last committed state, under a
// budget of its own, and either commits, giving the next state, the
// change set a store writes, what it said rendered as its effects
// (`effects.ts`), and who now holds a stale view, or faults: the draft is
// dropped, and the world is exactly as it was. Every draw it makes comes
// from one stream begun from its seed, and its words are rendered inside
// it, so a line too long for the turn's actor faults the turn as any
// budget spent does, and anyone else is cut short. A poll reads the
// committed state itself, under the poll's own step budget; it can write
// nothing, draws no seed, and one that faults yields the world's `unseen`.
//
// This is the frame, and it holds no store: serializing a world's write
// turns under its lock, and writing a committed change set in the
// store's transaction, is core's. What each kind does inside the frame is
// its own module's — `command.ts`, `tick.ts`, `wake.ts`, `maintenance.ts`,
// `arrival.ts`, `departure.ts` — and the view a poll builds is
// `view.ts`'s. Every write turn is handed the instant it runs; nothing
// here reads a clock but the backstop.

import type { RuntimeBudgets } from '../bundle/limits.js';
import type { Speech } from './body.js';
import { Budget, type TurnKind } from './budget.js';
import type { Catalogue } from './catalogue.js';
import { changesBetween, Draft, storedChanges, type StoredChanges } from './draft.js';
import { Draws } from './draws.js';
import { SILENT, type Effect, type Renderer, type Speaking } from './effects.js';
import { faultOf, worldSpeech, type Fault } from './faults.js';
import type { InstanceId, VisitKey } from './ids.js';
import type { LifecycleContext } from './lifecycle.js';
import { passRules } from './passes.js';
import type { PassRule } from './range.js';
import { turnState } from './reading.js';
import {
  codeUnitOrder,
  readerOf,
  type StateReader,
  type VisitorRecord,
  type WorldState,
} from './state.js';
import { hostSeconds, type HostSeconds } from './time.js';

/** A turn that may write: every kind but the poll. */
export type WriteTurnKind = Exclude<TurnKind, 'poll'>;

/** What the host runs a world's turns with. */
export interface TurnHost {
  readonly catalogue: Catalogue;
  /** The host's runtime budgets now. */
  readonly budgets: RuntimeBudgets;
  /**
   * The host's clock, read by the wall-clock backstop and by nothing
   * else (the spec's Limits › Runtime budgets); without one there is no
   * backstop.
   */
  readonly clock?: () => number;
  /** How a write turn's lines become its effects: the language's is `prose/`'s `renderEffects`. */
  readonly render: Renderer;
}

/** What the host gives one write turn, and records beside it (the spec's The log). */
export interface WriteInputs {
  /** The seed the host drew for this turn, a whole number from 0 to `SEED_MAX`, which every draw it makes comes from. */
  readonly seed: number;
  /** The most instances the host will store for this world this turn; null where it sets no bound. */
  readonly mayHold: number | null;
  /** When the turn runs, in whole host seconds. */
  readonly now: HostSeconds;
}

/** A write turn as its body sees it: its kind and seed, and what a body reads, writes and draws through. */
export interface WriteTurn extends LifecycleContext {
  readonly kind: WriteTurnKind;
  readonly seed: number;
}

/** A write turn that committed. */
export interface Committed<T> {
  readonly committed: true;
  /** The world after the turn: what the next turn reads. */
  readonly state: WorldState;
  /** What the store writes, in the stored form. */
  readonly changes: StoredChanges;
  /**
   * Every visitor present once it committed, in code-unit order of the
   * visit: their views are stale (the spec's The view).
   */
  readonly stale: readonly VisitKey[];
  /** What the turn said, one effect for each reader of each line, in the order said (the spec's Effects). */
  readonly effects: readonly Effect[];
  /** What the body gave. */
  readonly value: T;
}

/** A write turn that faulted and was abandoned: nothing it did is kept. */
export interface Faulted {
  readonly committed: false;
  readonly fault: Fault;
}

export type Written<T> = Committed<T> | Faulted;

/**
 * Run `body` as one write turn of `kind` over `state`: in a draft, under
 * a fresh budget, what `speaking` finds it said rendered once it returns,
 * then committed; abandoned when anything it runs, or rendering, throws.
 */
export function writeTurn<T>(
  state: WorldState,
  kind: WriteTurnKind,
  host: TurnHost,
  inputs: WriteInputs,
  body: (turn: WriteTurn) => T,
  speaking: (value: T) => Speaking = () => SILENT,
): Written<T> {
  return writeUnder(sharedFor(kind, host, inputs), state, kind, host, inputs, body, speaking);
}

/** What every part of one write turn shares: the budget it is charged to and its one stream of draws. */
export interface TurnShared {
  readonly budget: Budget;
  readonly draws: Draws;
}

/**
 * Run `body` as `writeTurn` does, charged to `shared`'s budget and drawing
 * from its stream: a maintenance turn's catch-up runs each wake so, under
 * the one budget and the one seed the turn has. An instant that is not
 * whole host seconds is the host's defect, thrown before the turn opens.
 */
export function writeUnder<T>(
  shared: TurnShared,
  state: WorldState,
  kind: WriteTurnKind,
  host: TurnHost,
  inputs: WriteInputs,
  body: (turn: WriteTurn) => T,
  speaking: (value: T) => Speaking = () => SILENT,
): Written<T> {
  const now = hostSeconds(inputs.now, 'a turn’s time');
  const { budget, draws } = shared;
  const draft = new Draft(state);
  const { catalogue } = host;
  const passes = passRules({
    state: draft,
    kinds: catalogue.lookup,
    caps: catalogue.caps,
    budget,
    names: catalogue.names,
  });
  try {
    const value = body({
      kind,
      seed: inputs.seed,
      draft,
      catalogue,
      passes,
      budget,
      draws,
      mayHold: inputs.mayHold,
      now,
    });
    const said = speaking(value);
    const effects =
      said.lines.length === 0
        ? []
        : host.render(said.lines, {
            ...visitorsIn(draft.everyVisitor()),
            state: turnState(draft),
            catalogue,
            passes,
            budget,
            draws,
            actor: said.actor,
          });
    const committed = draft.commit();
    return {
      committed: true,
      state: committed.state,
      changes: storedChanges(committed.state, committed.changes),
      stale: present(committed.state),
      effects,
      value,
    };
  } catch (thrown) {
    return { committed: false, fault: faultOf(thrown) };
  }
}

/**
 * One committed write turn made of the parts that took `base` to
 * `after`: what the store writes is everything between the two, and who
 * holds a stale view is who is present after. It says nothing, as
 * catch-up does not (the spec's Time › Absence).
 */
export function committedOver<T>(base: WorldState, after: WorldState, value: T): Committed<T> {
  return {
    committed: true,
    state: after,
    changes: storedChanges(after, changesBetween(base, after)),
    stale: present(after),
    effects: [],
    value,
  };
}

/**
 * What `speaking` says, rendered over the committed `state` under a fresh
 * budget of `kind` and a stream begun again from the turn's seed: how a
 * turn that faulted, whose own budget and draws went with it, tells its
 * actor so.
 */
export function effectsOver(
  state: WorldState,
  kind: WriteTurnKind,
  host: TurnHost,
  inputs: WriteInputs,
  speaking: Speaking,
): Effect[] {
  const reader = readerOf(state);
  const { budget, draws } = sharedFor(kind, host, inputs);
  const { catalogue } = host;
  const passes = passRules({
    state: reader,
    kinds: catalogue.lookup,
    caps: catalogue.caps,
    budget,
    names: catalogue.names,
  });
  return host.render(speaking.lines, {
    ...visitorsIn([...state.visitors.values()]),
    state: reader,
    catalogue,
    passes,
    budget,
    draws,
    actor: speaking.actor,
  });
}

/** A fresh budget of `kind` and a stream begun from the turn's seed. */
function sharedFor(kind: WriteTurnKind, host: TurnHost, inputs: WriteInputs): TurnShared {
  return { budget: new Budget(host.budgets, kind, host.clock), draws: new Draws(inputs.seed) };
}

/** Each visitor's nickname and visit, by the instance that is them. */
function visitorsIn(records: readonly VisitorRecord[]): {
  readonly nicknames: ReadonlyMap<InstanceId, string>;
  readonly visits: ReadonlyMap<InstanceId, VisitKey>;
} {
  return {
    nicknames: new Map(records.map((one) => [one.instance, one.nickname])),
    visits: new Map(records.map((one) => [one.instance, one.visit])),
  };
}

/** A poll as its look sees it: the committed state, read-only, and the poll's own meter. */
export interface PollTurn {
  readonly state: StateReader;
  readonly catalogue: Catalogue;
  readonly passes: PassRule<InstanceId>;
  readonly budget: Budget;
}

/** A poll's outcome: what its look gave, or, where it faulted, the world's `unseen`. */
export type Polled<T> =
  | { readonly faulted: false; readonly view: T }
  | { readonly faulted: true; readonly fault: Fault; readonly unseen: Speech };

/**
 * Run `look` as a poll over the committed `state`, writing nothing, under
 * the poll's own step budget; `chargedAs` a command, it is budgeted as the
 * command turn it stands in for, as an inspector reading a line is.
 */
export function pollTurn<T>(
  state: WorldState,
  host: TurnHost,
  look: (turn: PollTurn) => T,
  chargedAs: 'poll' | 'command' = 'poll',
): Polled<T> {
  const reader = readerOf(state);
  const budget = new Budget(host.budgets, chargedAs, host.clock);
  const { catalogue } = host;
  const passes = passRules({
    state: reader,
    kinds: catalogue.lookup,
    caps: catalogue.caps,
    budget,
    names: catalogue.names,
  });
  try {
    return { faulted: false, view: look({ state: reader, catalogue, passes, budget }) };
  } catch (thrown) {
    return { faulted: true, fault: faultOf(thrown), unseen: worldSpeech(reader, 'unseen') };
  }
}

/** Every visitor whose instance stands somewhere in `state`, by visit. */
function present(state: WorldState): VisitKey[] {
  return [...state.visitors.values()]
    .filter((visitor) => (state.instances.get(visitor.instance)?.container ?? null) !== null)
    .map((visitor) => visitor.visit)
    .sort(codeUnitOrder);
}
