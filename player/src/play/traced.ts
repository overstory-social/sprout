import {
  contentAt,
  type Catalogue,
  type CommandHost,
  type Effect,
  type Fault,
  type HostSeconds,
  type InstanceId,
  type Level,
  type StoredInstance,
  type VisitKey,
} from '@overstory/sprout/lang';
import type { Account, Engine, StoredState } from '@overstory/sprout/core';

import type { TurnReading } from './reading.js';
import type { Step } from '../script.js';

// What playing a script records (the spec's The runtime › Levels): each
// line a step made at its level, each turn it ran, and the stage a play
// runs against. `trace` notes a turn once
// the stage's stored state is that turn's outcome, so what it records is
// read from the world as the turn left it. Everything a turn records is
// what the stage's engine gave of it (core's `Given…` and `Step`) or what
// the stored state holds.

/**
 * One line of what a line made, at its level (the spec's The runtime ›
 * Levels): its text in the transcript, which is the line in full, the
 * words where a reader read them, and `shown`, the line as a player's
 * screen shows it; `reader` is whose screen, or null for whoever is at
 * the console. An effect is prose, and so are the host's words to someone
 * it keeps at the door; a fault is an error, a reader cut short a
 * warning, and every other note of the host's info.
 */
export interface Made {
  readonly level: Level;
  readonly text: string;
  readonly words: string | null;
  /** The effect's kind where a reader read it, `said` or `told`; null for a host line. */
  readonly kind: string | null;
  readonly shown: string;
  readonly reader: string | null;
}

/**
 * One step of a script and what playing it made: null for a comment and
 * `@seed`, which make nothing; and every turn it ran, in order.
 */
export interface PlayedStep {
  readonly step: Step;
  readonly made: readonly Made[] | null;
  readonly turns: readonly Traced[];
}

/**
 * One turn a step ran, as a report of what a playthrough reached reads it
 * (`report.ts`): its kind; who typed what, for a command; what it said;
 * the engine's account of what it ran, answered with or refused; the
 * reading it performed, as the visitor's stored last reading keeps it;
 * its faults, a maintenance turn's one for each part; and every place
 * that held a visitor once it was over, at any depth.
 */
export interface Traced {
  readonly turn: 'arrival' | 'departure' | 'command' | 'tick' | 'wake' | 'maintenance';
  readonly as: string | null;
  readonly typed: string | null;
  readonly effects: readonly Effect[];
  /** What the engine says the turn ran; null where it does not say, or the turn ran nothing. */
  readonly account: Account | null;
  readonly reading: TurnReading | null;
  readonly faults: readonly Fault[];
  readonly standing: readonly InstanceId[];
}

/**
 * The host's side of one play: the engine it runs on and the host it runs
 * for, the world as a store would hold it, the instant, the seed, each
 * nickname's visit, and every turn run.
 */
export interface Stage {
  readonly host: CommandHost;
  readonly engine: Engine;
  stored: StoredState;
  now: HostSeconds;
  seed: number;
  readonly visits: Map<string, VisitKey>;
  readonly turns: Traced[];
}

/** Each stored instance of `stored`, by its id. */
export function recordsOf(stored: StoredState): Map<string, StoredInstance> {
  return new Map(stored.instances.map((one) => [one.id, one]));
}

/**
 * What holds `id` as `records` keep it: its record's container, or, for a
 * declared object no turn has written, where it was declared.
 */
export function containerOf(
  records: ReadonlyMap<string, StoredInstance>,
  catalogue: Catalogue,
  id: InstanceId,
): InstanceId | null {
  const record = records.get(id);
  if (record !== undefined) return record.container as InstanceId | null;
  return catalogue.declared.get(id)?.container ?? null;
}

/** Whether `id` is a place: an instance other than the world whose kind holds people. */
function isPlaceIn(
  records: ReadonlyMap<string, StoredInstance>,
  catalogue: Catalogue,
  id: InstanceId,
): boolean {
  if (id === catalogue.world) return false;
  const made = records.get(id)?.made ?? (catalogue.declared.has(id) ? { from: 'declared' } : null);
  if (made === null) return false;
  switch (made.from) {
    case 'world':
      return false;
    case 'declared':
      return catalogue.declared.get(id)?.kind?.containsActors === true;
    case 'visitor':
      return catalogue.visitorKind?.containsActors === true;
    case 'spawned':
      return catalogue.kinds.get(made.kind)?.containsActors === true;
    case 'given':
      return contentAt(catalogue.contents, made.kind, made.path)?.kind?.containsActors === true;
  }
}

/**
 * Every place that holds a visitor present under `stage`'s stored state, at
 * any depth out to the world, so one riding a boat is in each river reach
 * the boat stands in; visitors in arrival order, each from their own place
 * out.
 */
function standing(stage: Stage): InstanceId[] {
  const { catalogue } = stage.host;
  const records = recordsOf(stage.stored);
  const places: InstanceId[] = [];
  for (const visit of stage.visits.values()) {
    const record = stage.stored.visitors.find((one) => one.visit === visit);
    let at =
      record === undefined ? null : containerOf(records, catalogue, record.instance as InstanceId);
    while (at !== null) {
      if (isPlaceIn(records, catalogue, at) && !places.includes(at)) places.push(at);
      at = containerOf(records, catalogue, at);
    }
  }
  return places;
}

/** Note a turn `stage` ran, once its stored state is the turn's outcome. */
export function trace(
  stage: Stage,
  turn: Traced['turn'],
  parts: Partial<Omit<Traced, 'turn' | 'standing'>>,
): void {
  stage.turns.push({
    turn,
    as: null,
    typed: null,
    effects: [],
    account: null,
    reading: null,
    faults: [],
    ...parts,
    standing: standing(stage),
  });
}
