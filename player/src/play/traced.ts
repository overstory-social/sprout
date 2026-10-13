import {
  isPlace,
  readerOf,
  type CommandHost,
  type DueWake,
  type Effect,
  type Fault,
  type HostSeconds,
  type InstanceId,
  type Level,
  type Ran,
  type Reading,
  type StoredChanges,
  type VisitKey,
  type WorldState,
} from '@overstory/sprout/lang';

import type { Handed, ParseRecord } from '../parsed.js';
import type { Step } from '../script.js';

// What playing a script records (the spec's The runtime › The log, Levels):
// each line a step made at its level, each turn it ran with what the log
// keeps of it, and the stage a play runs against. `trace` notes a turn once
// the stage's state is that turn's outcome, so what it records is read from
// the world as the turn left it.

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
 * the handlers and hooks it ran; the reading it performed, the engine
 * line the parser answered with instead, or whether the consent pass
 * refused; its faults, a maintenance turn's one for each part; and every place that held a visitor once it was over, at any depth.
 */
export interface Traced {
  readonly turn: 'arrival' | 'departure' | 'command' | 'tick' | 'wake' | 'maintenance';
  readonly as: string | null;
  readonly typed: string | null;
  readonly effects: readonly Effect[];
  readonly ran: readonly Ran[];
  readonly reading: Reading | null;
  readonly answered: string | null;
  readonly refused: boolean;
  readonly faults: readonly Fault[];
  readonly standing: readonly InstanceId[];
  /** What the log keeps of the turn, which a runtime working from the log's inputs reproduces (`readings.ts`). */
  readonly logged: Logged;
  /** What the parser made of the line, which a turn that faults performs none of; null where it made none. */
  readonly read: Reading | null;
  /** The bounds the parser drew below while it read the line, in order: the turn's stream begins with them. */
  readonly parseDraws: readonly number[];
  /** What the parser said before the reading's own lines. */
  readonly asides: readonly Aside[];
  /** What `host.parse` returned for a command turn, and what it spent; null where the turn read no words. */
  readonly parsed: ParseRecord | null;
  /** What a later turn of a line was handed in place of words; null for every other turn. */
  readonly handed: Handed | null;
  /** The world a command turn after the first in its step began from; null for every other turn. */
  readonly before: WorldState | null;
}

/**
 * A line the parser says before the reading's own (the spec's Parsing › Pronouns, Choosing a reading):
 * the world's `pronoun_correction` for a thing a pronoun named, with the pronoun it declares, or the
 * engine's `meant`, telling the actor which thing a reading drawn from a tie took the words to name.
 */
export interface Aside {
  readonly line: 'meant' | 'pronoun_correction';
  readonly thing: InstanceId;
  readonly pronoun: string | null;
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
}

/** The host's side of one play: the world as it stands, the instant, the seed, each nickname's visit, and every turn run. */
export interface Stage {
  readonly host: CommandHost;
  state: WorldState;
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

/**
 * Every place that holds a visitor present under `stage`'s state, at any
 * depth out to the world, so one riding a boat is in each river reach the
 * boat stands in; visitors in arrival order, each from their own place out.
 */
function standing(stage: Stage): InstanceId[] {
  const reader = readerOf(stage.state);
  const places: InstanceId[] = [];
  for (const visit of stage.visits.values()) {
    const record = stage.state.visitors.get(visit);
    let at =
      record === undefined ? null : (stage.state.instances.get(record.instance)?.container ?? null);
    while (at !== null) {
      if (isPlace(reader, at) && !places.includes(at)) places.push(at);
      at = stage.state.instances.get(at)?.container ?? null;
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
    serial: stage.state.serial,
    wakes: null,
    stale: null,
    changes: null,
    ...parts,
  };
}

/** Note a turn `stage` ran, once its state is the turn's outcome. */
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
    ran: [],
    reading: null,
    answered: null,
    refused: false,
    faults: [],
    read: null,
    parseDraws: [],
    asides: [],
    parsed: null,
    handed: null,
    before: null,
    ...parts,
    standing: standing(stage),
    logged,
  });
}
