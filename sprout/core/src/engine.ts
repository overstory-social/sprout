import type {
  Arrival,
  Catalogue,
  Closed,
  Command,
  Departure,
  DueWake,
  Effect,
  Fault,
  InstanceId,
  NicknameRefused,
  PolledReadings,
  PolledScene,
  PolledView,
  Ran,
  RuntimeBudgets,
  StoredChanges,
  Tick,
  VisitKey,
  Wake,
  WriteInputs,
} from '@overstory/sprout/lang';

import type { Heard } from './conversation.js';
import type { TurnEntry } from './log/entry.js';
import type { ParsedCommand } from './parse.js';
import type { StoredState } from './records.js';

// The engine that runs one world, as core and its host reach it (the spec's
// The runtime; The host contract). Core keeps the store, the lock, the log
// and the caches; the engine is given the stored state as the store hands it
// over and gives back what a host reads: each turn's effects, whose views it
// made stale and its fault, what the store writes and the log keeps, each
// poll, and what the host asks of the committed world between turns.

/**
 * What a turn ran, as a report of a playthrough reads it: each handler and
 * hook in the order it ran, the engine line the parser answered a command
 * with, by its passage's name or its words, and whether the consent pass
 * refused the command's reading.
 */
export interface Account {
  readonly ran: readonly Ran[];
  readonly answered: string | null;
  readonly refused: boolean;
}

/** What one write turn did, what it writes, its log entry and its account; null for any it has none of, a turn that ran nothing having no account. */
export interface Step<T> {
  readonly turn: T;
  readonly changes: StoredChanges | null;
  readonly entry: TurnEntry | null;
  readonly account: Account | null;
}

/** A write turn that committed: what each reader is told, whose views it made stale, and who was cut short. */
export interface GivenCommitted {
  readonly committed: true;
  readonly effects: readonly Effect[];
  /** Every visitor present once it committed, in code-unit order of the visit. */
  readonly stale: readonly VisitKey[];
  readonly cutShort: readonly InstanceId[];
}

/** A write turn that faulted and was abandoned. */
export interface GivenFaulted {
  readonly committed: false;
  readonly fault: Fault;
}

/**
 * What a host records of a command that committed, beside its effects: for
 * a reading, the step of a line of several it ran as, which is logged at
 * info, how many readings tied where the parser drew one, a warning, and
 * the seconds the host is to let pass once it is over, lowered to the
 * host's longest pass (the spec's Time › Passing time); nothing for a line
 * the parser answered or a visitor displaced. `answered` and `displaced`
 * only mark which: nothing reads what they hold.
 */
export type CommandNotes =
  | { readonly answered: object }
  | { readonly displaced: object }
  | {
      readonly step: { readonly verb: { readonly library: string; readonly name: string } } | null;
      readonly drawn: { readonly among: number } | null;
      readonly passes: number;
    };

/** A command turn: committed, or faulted with the world's `fault` told to the one who typed. */
export type GivenCommand =
  | (GivenCommitted & { readonly value: CommandNotes })
  | (GivenFaulted & { readonly effects: readonly Effect[] });

/** A tick turn: committed, faulted and dropped, or not run for want of anyone there. */
export type GivenTick =
  GivenCommitted | GivenFaulted | { readonly committed: false; readonly unoccupied: true };

/** A wake turn: committed, faulted and consumed, or not run because the wake is no longer pending. */
export type GivenWake =
  GivenCommitted | GivenFaulted | { readonly committed: false; readonly unwoken: true };

/**
 * An arrival turn: admitted, refused by the place in its words (its
 * effects; `refused` only marks it, and nothing reads what it holds),
 * closed, or faulted, with words for the person.
 */
export type GivenArrival =
  | (GivenCommitted & { readonly value: { readonly returning: boolean } })
  | { readonly committed: false; readonly refused: object; readonly effects: readonly Effect[] }
  | { readonly committed: false; readonly closed: Closed }
  | (GivenFaulted & { readonly words: string });

/** A departure turn: committed, or faulted, the visitor then gone away quietly, with what that told them and who it cut short. */
export type GivenDeparture =
  | GivenCommitted
  | (GivenFaulted & {
      readonly quietly: {
        readonly effects: readonly Effect[];
        readonly cutShort: readonly InstanceId[];
      };
    });

/** Where a visitor stands, as the host's status line names it for them: the place, and what else it holds. */
export interface Standing {
  readonly place: { readonly id: InstanceId; readonly name: string };
  /** The things the place directly holds other than the visitor, people among them, in contents order. */
  readonly here: readonly { readonly id: InstanceId; readonly name: string }[];
}

/**
 * The commands one typed line runs, each a turn of its own: `next` is
 * handed the turn the last command gave, and gives the command after it,
 * or null once the line is done (the spec's Parsing › Intents; Sequences).
 * A command is lang's, and one a line planned carries the reading it
 * planned and any item it re-reads. Core hands each command and each turn
 * of a line back to the engine that gave it; a replay hands any engine a
 * planned step as the log kept it, which it runs as it is.
 */
export interface CommandLine {
  next(previous: GivenCommand | null): Command | null;
}

/** One world's engine, bound to its bundle and its host's budgets. */
export interface Engine {
  command(stored: StoredState, command: Command): Step<GivenCommand>;
  /** The commands `command`'s line runs, the first with its own seed and each after it with one from `seed`. */
  line(command: Command, seed: () => number): CommandLine;
  tick(stored: StoredState, tick: Tick): Step<GivenTick>;
  wake(stored: StoredState, wake: Wake): Step<GivenWake>;
  maintenance(stored: StoredState, inputs: WriteInputs): Step<GivenCommitted>;
  arrival(stored: StoredState, arrival: Arrival): Step<GivenArrival>;
  departure(stored: StoredState, departure: Departure): Step<GivenDeparture>;
  /** Why `nickname` may not be `visit`'s here, against the world and the host's bound; null where it may. */
  nicknameRefusal(stored: StoredState, visit: VisitKey, nickname: string): NicknameRefused | null;
  view(stored: StoredState, visit: VisitKey): PolledView;
  scene(stored: StoredState, visit: VisitKey): PolledScene;
  readings(stored: StoredState, visit: VisitKey, verb: string): PolledReadings;
  /** Every place a visitor stands in, once each, in code-unit order: the places a host ticks. */
  occupiedPlaces(stored: StoredState): InstanceId[];
  /** Every wake due by `now`, on an object in the tree. */
  dueWakes(stored: StoredState, now: number): DueWake[];
  /** Who hears what `visit` says to the people with them; null where they stand in no place. */
  hearers(stored: StoredState, visit: VisitKey): Heard | null;
  /** Where `visit` stands and what is there, named for them; null where they are away or their place is gone. */
  standing(stored: StoredState, visit: VisitKey): Standing | null;
  /** What `line` would make, typed by `visit`: each command it holds, read against `stored` and never run. */
  parse(stored: StoredState, visit: VisitKey, line: string): ParsedCommand[];
  /**
   * The world's `acted` for the line `actor` typed, as `reader` reads it
   * over a console they share (the spec's The command line): its
   * paragraphs, rendered as a poll renders; null where either visit is not
   * the world's or rendering it faulted.
   */
  acted(
    stored: StoredState,
    reader: VisitKey,
    actor: VisitKey,
    typed: string,
  ): readonly string[] | null;
  /**
   * The stored state a write turn's commit landed, read back in the same
   * transaction: an engine that keeps the world live notes it as the state
   * its next turn may run on as it is. An engine that reads each stored
   * state afresh has none.
   */
  landed?(stored: StoredState): void;
}

/** What a host runs one world under: the world as it reads it, and its runtime budgets. */
export interface WorldHost {
  readonly catalogue: Catalogue;
  readonly budgets: RuntimeBudgets;
}

/** A world's host with the engine it runs that world on. */
export interface EngineHost extends WorldHost {
  readonly engine: Engine;
}
