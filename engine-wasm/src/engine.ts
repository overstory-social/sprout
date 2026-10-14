import {
  closedByBundle,
  type Catalogue,
  type Command,
  type InstanceId,
  type RuntimeBudgets,
} from '@overstory/sprout/lang';
import type {
  CommandLine,
  CommandNotes,
  Engine,
  GivenArrival,
  GivenCommand,
  GivenCommitted,
  GivenDeparture,
  GivenTick,
  GivenWake,
  Step,
  StoredState,
} from '@overstory/sprout/core';

import { WasmInstance, type At } from './instance.js';
import type { LineCommand, Told } from './shapes.js';
import { shippedModule } from './wasm.js';

// The runtime's WebAssembly engine as one world's `Engine` (core's
// engine.ts; the spec's The runtime, The host contract): every turn,
// poll and question runs in one instance of runtime-c's engine, which
// keeps the world's state live. The engine notes which stored state its
// live state is: the one it opened, or the one core read back once a
// commit landed (`landed`). A turn or a poll over that stored state runs
// on the live state as it is; any other stored state, another value or
// one whose serial differs, is opened afresh from its records first, so
// nothing ever runs on a live state the store has moved past. Every entry
// is made at debug depth, and core keeps it at the host's.

/** What the WebAssembly engine runs one world with: its cartridge, and the host's catalogue and budgets for it. */
export interface WasmEngineHost {
  /** The world's cartridge, as `emitCartridge` writes it. */
  readonly cartridge: Uint8Array;
  /** The same world as the host reads it: its id, its caps, and whether its bundle admits anyone. */
  readonly catalogue: Catalogue;
  readonly budgets: RuntimeBudgets;
  /** The engine's module; the one this package ships where none is given. */
  readonly module?: WebAssembly.Module;
}

/** `told`, a turn that committed, as what a host reads of it. */
function committed(told: Told): GivenCommitted {
  if (told.stale === null)
    throw new Error('The WebAssembly engine committed a turn and named no one stale.');
  return { committed: true, effects: told.effects, stale: told.stale, cutShort: told.cutShort };
}

/** `told`'s fault, which a turn that did not commit always has. */
function faultOf(told: Told) {
  if (told.fault === null)
    throw new Error(`The WebAssembly engine's turn came to \`${told.result}\` with no fault.`);
  return told.fault;
}

/** Where `told` came to something no turn of its kind does. */
function unexpected(told: Told, kind: string): Error {
  return new Error(`The WebAssembly engine's ${kind} turn came to \`${told.result}\`.`);
}

/** What a command turn that committed says of its line, as a host logs it. */
function notesOf(told: Told): CommandNotes {
  if (told.answered === true) return { answered: {} };
  if (told.displaced === true) return { displaced: {} };
  const step = told.step ?? null;
  const at = step === null ? -1 : step.verb.lastIndexOf('.');
  return {
    step:
      step === null
        ? null
        : { verb: { library: step.verb.slice(0, at), name: step.verb.slice(at + 1) } },
    drawn: told.drawn === null || told.drawn === undefined ? null : { among: told.drawn },
  };
}

/** `turn`, with what `told` says the store writes, the log keeps and the turn ran. */
function stepOf<T>(told: Told, turn: T): Step<T> {
  return { turn, changes: told.changes, entry: told.entry, account: told.account };
}

/** A turn that ran nothing, an idle tick or wake or an arrival to a world that admits no one, which has no account. */
function idleStep<T>(told: Told, turn: T): Step<T> {
  return { turn, changes: told.changes, entry: told.entry, account: null };
}

/** The WebAssembly engine as one world's engine, under `host`'s budgets. */
export function wasmEngine(host: WasmEngineHost): Engine {
  const instance = new WasmInstance(host.module ?? shippedModule());
  instance.load(host.cartridge);
  instance.budgets(host.budgets, host.catalogue.caps.listElements);
  instance.logDepth('debug');
  const world: InstanceId = host.catalogue.world;
  instance.openEmpty(world);

  /** The stored state the live state is, and its serial; null once a turn has run past it. */
  let live: StoredState | null = null;
  let liveSerial = 0;
  /** The commands lines handed out, each as the engine wrote it. */
  const handedOut = new WeakMap<Command, LineCommand>();

  /** Makes the live state `stored`, opening it afresh where it is not that state already. */
  function onto(stored: StoredState): void {
    if (stored === live && stored.serial === liveSerial) return;
    instance.open(JSON.stringify({ world, ...stored }));
    live = stored;
    liveSerial = stored.serial;
  }

  /** Runs a write turn over `stored`: the live state is then past it until core reads back what landed. */
  function turn(stored: StoredState, mayHold: number | null, run: () => Told): Told {
    onto(stored);
    instance.mayHold(mayHold);
    live = null;
    const told = run();
    if (told.changes !== null) liveSerial = told.changes.serial;
    return told;
  }

  const at = (inputs: At): At => ({ seed: inputs.seed, now: inputs.now });

  return {
    landed: (stored) => {
      if (live === null && stored.serial === liveSerial) live = stored;
    },

    command: (stored, command) => {
      const handed = handedOut.get(command);
      if (handed === undefined && (command.planned !== undefined || command.reread !== undefined)) {
        throw new Error(
          'A step a line planned is run by the engine whose line planned it, and this one did not.',
        );
      }
      const told = turn(stored, command.mayHold, () => {
        try {
          return instance.command(
            handed ?? { visit: command.visit, text: command.text },
            at(command),
          );
        } catch (err) {
          // A line whose command could not run is over, and core asks it for nothing more.
          if (handed !== undefined) instance.lineEnd(handed.line);
          throw err;
        }
      });
      if (told.result === 'done') return stepOf(told, { ...committed(told), value: notesOf(told) });
      if (told.result === 'faulted')
        return stepOf<GivenCommand>(told, {
          committed: false,
          fault: faultOf(told),
          effects: told.effects,
        });
      throw unexpected(told, 'command');
    },

    line: (command, seed): CommandLine => {
      let number: number | null = null;
      let first = true;
      const made = (handed: LineCommand | null, nextSeed: number): Command | null => {
        number = handed === null ? null : handed.line;
        if (handed === null) return null;
        const one: Command = {
          visit: handed.visit,
          text: handed.text,
          seed: nextSeed,
          mayHold: command.mayHold,
          now: command.now,
        };
        handedOut.set(one, handed);
        return one;
      };
      return {
        next: () => {
          if (first) {
            first = false;
            return made(instance.line(command.visit, command.text), command.seed);
          }
          return number === null ? null : made(instance.lineNext(number), seed());
        },
      };
    },

    tick: (stored, tick) => {
      const told = turn(stored, tick.mayHold, () => instance.tick(tick.place, at(tick)));
      if (told.result === 'idle')
        return idleStep<GivenTick>(told, { committed: false, unoccupied: true });
      if (told.result === 'done') return stepOf<GivenTick>(told, committed(told));
      if (told.result === 'faulted')
        return stepOf<GivenTick>(told, { committed: false, fault: faultOf(told) });
      throw unexpected(told, 'tick');
    },

    wake: (stored, wake) => {
      const told = turn(stored, wake.mayHold, () =>
        instance.wake(wake.object, wake.serial, at(wake)),
      );
      if (told.result === 'idle')
        return idleStep<GivenWake>(told, { committed: false, unwoken: true });
      if (told.result === 'done') return stepOf<GivenWake>(told, committed(told));
      if (told.result === 'faulted')
        return stepOf<GivenWake>(told, { committed: false, fault: faultOf(told) });
      throw unexpected(told, 'wake');
    },

    maintenance: (stored, inputs) => {
      const told = turn(stored, inputs.mayHold, () => instance.maintenance(at(inputs)));
      if (told.result === 'done') return stepOf(told, committed(told));
      throw unexpected(told, 'maintenance');
    },

    arrival: (stored, arrival) => {
      const returning = stored.visitors.some((one) => one.visit === arrival.visit);
      const told = turn(stored, arrival.mayHold, () =>
        instance.arrive(arrival.visit, arrival.nickname, at(arrival)),
      );
      const words = told.words ?? '';
      switch (told.result) {
        case 'done':
          return stepOf<GivenArrival>(told, { ...committed(told), value: { returning } });
        case 'refused':
          return stepOf<GivenArrival>(told, {
            committed: false,
            refused: {},
            effects: told.effects,
          });
        case 'closed':
          return idleStep<GivenArrival>(told, {
            committed: false,
            closed: { reason: closedByBundle(host.catalogue) ?? 'arrival-place-gone', words },
          });
        case 'faulted':
          return stepOf<GivenArrival>(told, { committed: false, fault: faultOf(told), words });
        default:
          throw unexpected(told, 'arrival');
      }
    },

    departure: (stored, departure) => {
      const told = turn(stored, departure.mayHold, () =>
        instance.depart(departure.visit, at(departure)),
      );
      if (told.result === 'done') return stepOf<GivenDeparture>(told, committed(told));
      if (told.result === 'faulted')
        return stepOf<GivenDeparture>(told, {
          committed: false,
          fault: faultOf(told),
          quietly: { effects: told.effects, cutShort: told.cutShort },
        });
      throw unexpected(told, 'departure');
    },

    nicknameRefusal: (stored, visit, nickname) => {
      onto(stored);
      return instance.nickname(visit, nickname);
    },
    view: (stored, visit) => {
      onto(stored);
      return { visit, ...instance.view(visit) };
    },
    scene: (stored, visit) => {
      onto(stored);
      return { visit, ...instance.scene(visit) };
    },
    readings: (stored, visit, verb) => {
      onto(stored);
      return { visit, verb, ...instance.readings(visit, verb) };
    },
    occupiedPlaces: (stored) => {
      onto(stored);
      return instance.occupied();
    },
    dueWakes: (stored, now) => {
      onto(stored);
      return instance.dueWakes(now);
    },
    hearers: (stored, visit) => {
      onto(stored);
      return instance.hearers(visit);
    },
    standing: (stored, visit) => {
      onto(stored);
      return instance.standing(visit);
    },
  };
}
