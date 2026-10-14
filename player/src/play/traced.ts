import {
  contentAt,
  type Catalogue,
  type CommandHost,
  type DueWake,
  type Effect,
  type Fault,
  type HostSeconds,
  type InstanceId,
  type Level,
  type Reading,
  type StoredChanges,
  type StoredInstance,
  type VisitKey,
} from '@overstory/sprout/lang';
import type { Account, Engine, StoredState } from '@overstory/sprout/core';

import type { Handed, ParseRecord, ReadReading, ReadReread } from '../parsed.js';
import type { Step } from '../script.js';

// What playing a script records (the spec's The runtime › The log, Levels):
// each line a step made at its level, each turn it ran with what the log
// keeps of it, and the stage a play runs against. `trace` notes a turn once
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
  readonly reading: ReadReading | null;
  readonly faults: readonly Fault[];
  readonly standing: readonly InstanceId[];
  /** What the log keeps of the turn, which a runtime working from the log's inputs reproduces (`readings.ts`). */
  readonly logged: Logged;
  /** What the TypeScript parser made of the line, which a turn that faults performs none of; null where it made none. */
  readonly read: Reading | null;
  /** What the TypeScript parser, `host.parse`, returned for a command turn, and what it spent; null where it was not parsed. */
  readonly parsed: ParseRecord | null;
  /** What a later turn of a line was handed in place of words; null for every other turn. */
  readonly handed: Handed | null;
  /** The stored world a command turn after the first in its step began from; null for every other turn. */
  readonly before: StoredState | null;
}

/**
 * The inputs and outcome a turn's entry in the log keeps beside what it said (the spec's The runtime ›
 * The log): the seed it drew from, the instant, whom it was for, how it ended, who it cut short, the
 * world's last serial once it ended, and, for catch-up, each wake it delivered, consumed or left pending;
 * and what a host is given beside the entry: what the store writes, where the turn wrote anything (The host
 * contract › Storage), and every visitor present after it, whose views it made stale, where it committed
 * (The view; a faulted turn names nobody).
 */
export interface Logged {
  readonly seed: number;
  readonly now: HostSeconds;
  readonly who: string | null;
  /** An arrival's nickname, as the visitor came in with it; null for every other turn. */
  readonly nickname: string | null;
  /** A wake's serial, as it was asked under; null for every other turn. */
  readonly wake: number | null;
  readonly outcome: 'done' | 'faulted' | 'refused' | 'closed';
  readonly cut: readonly InstanceId[];
  readonly serial: number;
  readonly stale: readonly VisitKey[] | null;
  readonly changes: StoredChanges | null;
  readonly wakes: {
    readonly delivered: readonly DueWake[];
    readonly faulted: readonly { readonly wake: DueWake; readonly fault: Fault }[];
    readonly abandoned: readonly DueWake[];
  } | null;
  /** A command's words, the step a line planned for it, the item it re-read, and how many readings tied where its reading was drawn; null for every other turn. */
  readonly command: {
    readonly text: string;
    readonly planned: ReadReading | null;
    readonly reread: ReadReread | null;
    readonly drawn: number | null;
  } | null;
}

/**
 * The host's side of one play: the engine it runs on and the host it runs
 * for, the world as a store would hold it, the instant, the seed, each
 * nickname's visit, and every turn run. What the parser read of the
 * command turn now running is noted where the host's own parser reads it,
 * as the TypeScript engine's does.
 */
export interface Stage {
  readonly host: CommandHost;
  readonly engine: Engine;
  stored: StoredState;
  now: HostSeconds;
  seed: number;
  readonly visits: Map<string, VisitKey>;
  readonly turns: Traced[];
  /** The bounds the parser drew below reading the command turn now running. */
  readonly parsed: number[];
  /** What the parser made of the command turn now running, which a turn that faults leaves nowhere else. */
  read: Reading | null;
  /** What `host.parse` returned for the command turn now running, null until it reads words. */
  parse: ParseRecord | null;
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

/** What a turn leaves in the log beside what it said, as `stage` stands once it is over. */
export function loggedOf(stage: Stage, parts: Partial<Logged> & Pick<Logged, 'seed'>): Logged {
  return {
    now: stage.now,
    who: null,
    nickname: null,
    wake: null,
    outcome: 'done',
    cut: [],
    serial: stage.stored.serial,
    wakes: null,
    stale: null,
    changes: null,
    command: null,
    ...parts,
  };
}

/** Note a turn `stage` ran, once its stored state is the turn's outcome. */
export function trace(
  stage: Stage,
  turn: Traced['turn'],
  logged: Logged,
  parts: Partial<Omit<Traced, 'turn' | 'standing' | 'logged'>>,
): void {
  stage.turns.push({
    turn,
    as: null,
    typed: null,
    effects: [],
    account: null,
    reading: null,
    faults: [],
    read: null,
    parsed: null,
    handed: null,
    before: null,
    ...parts,
    standing: standing(stage),
    logged,
  });
}
