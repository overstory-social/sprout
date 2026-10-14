import {
  commandsOfLine,
  dueWakes,
  nicknameRefusal,
  nicknamesIn,
  objectWords,
  occupiedPlaces,
  pollReadings,
  pollScene,
  pollView,
  readerOf,
  renderActed,
  type Arrival,
  type Closed,
  type Command,
  type CommandHost,
  type CommandTurn,
  type TurnHost,
  type Departure,
  type DueWake,
  type Effect,
  type Fault,
  type InstanceId,
  type NicknameRefused,
  type PolledReadings,
  type PolledScene,
  type PolledView,
  type Tick,
  type VisitKey,
  type Wake,
  type WorldState,
  type WriteInputs,
} from '@overstory/sprout/lang';

import { hearers, type Heard } from './conversation.js';
import type { StoredState } from './records.js';
import {
  arrivalStep,
  commandStep,
  departureStep,
  kept,
  loaded,
  maintenanceStep,
  tickStep,
  wakeStep,
  type Step,
} from './steps.js';

// The engine that runs one world, as core and its host reach it (the spec's
// The runtime; The host contract). Core keeps the store, the lock, the log
// and the caches; the engine is given the stored state as the store hands it
// over and gives back what a host reads: each turn's effects, whose views it
// made stale and its fault, what the store writes and the log keeps, each
// poll, and what the host asks of the committed world between turns. What
// it gives is the same whichever runtime runs it; `tsEngine` is the
// TypeScript runtime's, and a host names another as its `engine`.

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
 * info, and how many readings tied where the parser drew one, a warning;
 * nothing for a line the parser answered or a visitor displaced. `answered`
 * and `displaced` only mark which: nothing reads what they hold.
 */
export type CommandNotes =
  | { readonly answered: object }
  | { readonly displaced: object }
  | {
      readonly step: { readonly verb: { readonly library: string; readonly name: string } } | null;
      readonly drawn: { readonly among: number } | null;
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

/** What a host names its engine by; the TypeScript runtime's where it names none. */
export interface EngineHost {
  readonly engine?: Engine;
}

const engines = new WeakMap<TurnHost, Engine>();

/** The engine `host` names, or the TypeScript runtime's for its bundle, made once. */
export function engineOf(host: TurnHost & EngineHost): Engine {
  if (host.engine !== undefined) return host.engine;
  const known = engines.get(host);
  if (known !== undefined) return known;
  const made = tsEngine(host);
  engines.set(host, made);
  return made;
}

/**
 * The TypeScript runtime as one world's engine: `steps.ts` over each stored
 * state, read once. It keeps the world each write turn left, and once core
 * reads back the stored state that turn landed (`landed`), the next turn
 * runs on that world as it is, as the WebAssembly engine runs on its live
 * state. Commands need the host's parser, so a host without one runs every
 * turn but a command.
 */
export function tsEngine(host: TurnHost | CommandHost): Engine {
  const state = (stored: StoredState): WorldState => loaded(stored, host);
  /** The world the last write turn left, until core hands back the stored state it landed as. */
  let left: WorldState | null = null;
  /** `step`, its turn having left `world`. */
  const leaving = <T>(step: Step<T>, world: WorldState): Step<T> => {
    left = world;
    return step;
  };
  return {
    landed: (stored) => {
      if (left !== null && left.serial === stored.serial) kept(stored, host, left);
      left = null;
    },
    command: (stored, command) => {
      if (!('parse' in host)) throw new Error('This host has no parser, so runs no command.');
      const before = state(stored);
      const step = commandStep(before, host, command);
      return leaving(step, step.turn.committed ? step.turn.state : before);
    },
    line: (command, seed) => {
      const commands = commandsOfLine(command, seed);
      let started = false;
      return {
        next: (previous) => {
          // The turns handed back are this engine's own, so each is the CommandTurn it gave.
          const step = started ? commands.next(previous as CommandTurn) : commands.next();
          started = true;
          return step.done ? null : step.value;
        },
      };
    },
    tick: (stored, tick) => {
      const before = state(stored);
      const step = tickStep(before, host, tick);
      const { turn } = step;
      return leaving(step, 'unoccupied' in turn || !turn.committed ? before : turn.state);
    },
    wake: (stored, wake) => {
      const before = state(stored);
      const step = wakeStep(before, host, wake);
      const { turn } = step;
      return leaving(
        step,
        'unwoken' in turn ? before : turn.committed ? turn.state : turn.consumed.state,
      );
    },
    maintenance: (stored, inputs) => {
      const step = maintenanceStep(state(stored), host, inputs);
      return leaving(step, step.turn.state);
    },
    arrival: (stored, arrival) => {
      const before = state(stored);
      const step = arrivalStep(before, host, arrival);
      return leaving(step, step.turn.committed ? step.turn.state : before);
    },
    departure: (stored, departure) => {
      const step = departureStep(state(stored), host, departure);
      const { turn } = step;
      return leaving(step, turn.committed ? turn.state : turn.quietly.state);
    },
    nicknameRefusal: (stored, visit, nickname) =>
      nicknameRefusal(state(stored), host.catalogue, host.budgets, visit, nickname),
    view: (stored, visit) => pollView(state(stored), host, visit),
    scene: (stored, visit) => pollScene(state(stored), host, visit),
    readings: (stored, visit, verb) => pollReadings(state(stored), host, visit, verb),
    occupiedPlaces: (stored) => occupiedPlaces(state(stored)),
    dueWakes: (stored, now) => dueWakes(state(stored), now),
    hearers: (stored, visit) => hearers(state(stored), visit),
    standing: (stored, visit) => standingIn(state(stored), visit),
    acted: (stored, reader, actor, typed) => {
      const world = state(stored);
      const acting = world.visitors.get(actor)?.instance;
      return acting === undefined ? null : renderActed(world, host, reader, acting, typed);
    },
  };
}

/** Where `visit` stands in `state` and what is there, named for them. */
function standingIn(state: WorldState, visit: VisitKey): Standing | null {
  const visitor = state.visitors.get(visit);
  const place =
    visitor === undefined ? null : (state.instances.get(visitor.instance)?.container ?? null);
  if (visitor === undefined || place === null || !state.instances.has(place)) return null;
  const reader = readerOf(state);
  const naming = { state: reader, nicknames: nicknamesIn(state) };
  const named = (id: InstanceId) => ({ id, name: objectWords(id, visitor.instance, naming) });
  return {
    place: named(place),
    here: reader
      .children(place)
      .filter((id) => id !== visitor.instance)
      .map(named),
  };
}
