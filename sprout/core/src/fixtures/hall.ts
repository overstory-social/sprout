import {
  DEFAULT_LIMITS,
  visitKey,
  type Catalogue,
  type Command,
  type Effect,
  type Fault,
  type InstanceId,
  type SeenView,
  type StoredChanges,
  type StoredInstance,
  type VisitKey,
  type WriteInputs,
} from '@overstory/sprout/lang';

import type { Engine, GivenCommand, Step } from '../engine.js';
import type { CommandEntry } from '../log/command.js';
import { loggedEffects, loggedFault } from '../log/parts.js';
import { memoryStore } from '../memory-store.js';
import type { StoredState } from '../records.js';
import type { SproutStore } from '../store.js';
import type { LogHost } from '../turns.js';

// A stand-in engine for core's own specs: one hall that visitors arrive
// in and leave, read straight off the stored records, so what core does
// around an engine (the lock, the log and its depth, the caches, the
// ticker, conversation) is checked without running a world. A command
// says its words back to whoever typed them, and one typed `fault` faults;
// `a then b` is a line of two. It is held to nothing: the engine
// conformance suite holds a real engine to the spec. Spec support: the
// package build leaves it out.

export const WORLD = 'hall';
export const HALL = 'hall.hall' as InstanceId;
export const MARTA = visitKey('v-marta');
export const INES = visitKey('v-ines');

/** What a stand-in poll gives a visitor standing in the hall. */
export const HALL_VIEW: SeenView = {
  description: ['A bare hall.'],
  effects: [],
  exits: [],
  occupants: [],
  carried: [],
  readings: [],
};

/** The fault a command typed `fault` gives. */
export const FAULT: Fault = {
  name: 'IntegerOverflow',
  detail: '2147483648 is outside the integer range, -2147483648 to 2147483647.',
  object: HALL,
  engine: false,
  extension: null,
};

/** The stand-in's catalogue: only what core reads of one, the world and whether it admits anyone. */
export const CATALOGUE = {
  world: WORLD,
  arrival: HALL,
  visitorKind: 'hall.Person',
} as unknown as Catalogue;

/** How the stand-in is set up: whether its polls fault, and what it calls each method with, in order. */
export interface Standing {
  /** Each engine method asked, by name, in order. */
  readonly asked: string[];
  /** Whether every poll faults, as a describe that runs out of steps would. */
  pollsFault: boolean;
}

const nothing = (serial: number): StoredChanges => ({
  serial,
  upsert: [],
  remove: [],
  tombstones: [],
  visitors: [],
});

/** The instance `visit` is in `stored`, where they ever came. */
function instanceOf(stored: StoredState, visit: VisitKey): StoredInstance | undefined {
  const visitor = stored.visitors.find((one) => one.visit === visit);
  return stored.instances.find((one) => one.id === visitor?.instance);
}

/** Every visit standing in the hall, in the order their instances are stored. */
function present(stored: StoredState): VisitKey[] {
  return stored.instances
    .filter((one) => one.container === HALL)
    .flatMap((one) =>
      stored.visitors.filter((v) => v.instance === one.id).map((v) => visitKey(v.visit)),
    );
}

const said = (visit: VisitKey, words: string): Effect => ({
  kind: 'said',
  from: HALL,
  actor: null,
  to: HALL,
  visit,
  paragraphs: [words],
  written: [],
});

/** What every turn's entry keeps of its inputs and what it said. */
function inputs(given: WriteInputs, effects: readonly Effect[]) {
  return {
    level: 'info' as const,
    seed: given.seed,
    mayHold: given.mayHold,
    now: given.now,
    budgets: DEFAULT_LIMITS.budgets,
    effects: loggedEffects(effects),
    cutShort: [],
  };
}

/** The log's entry for a command the stand-in ran. */
function commandEntry(
  command: Command,
  effects: readonly Effect[],
  fault: Fault | null,
): CommandEntry {
  return {
    kind: 'command',
    ...inputs(command, effects),
    visit: command.visit,
    text: command.text,
    planned: null,
    reread: null,
    fault: fault === null ? null : loggedFault(fault),
    drawn: null,
  };
}

/** The stand-in engine, and what it was asked. */
export function hallEngine(words = (text: string) => `You ${text}.`): {
  engine: Engine;
  standing: Standing;
} {
  const standing: Standing = { asked: [], pollsFault: false };
  const ask = (name: string) => standing.asked.push(name);
  const unasked = (name: string) => (): never => {
    throw new Error(`The stand-in engine is not asked for \`${name}\`.`);
  };
  const committed = <T extends object>(stored: StoredState, effects: Effect[], value: T) => ({
    committed: true as const,
    effects,
    stale: present(stored),
    cutShort: [],
    ...value,
  });
  const poll = (visit: VisitKey) => {
    const fault = standing.pollsFault ? FAULT : null;
    return { visit, fault };
  };
  const engine: Engine = {
    command: (stored, command): Step<GivenCommand> => {
      ask('command');
      if (command.text === 'fault') {
        const effects = [
          { ...said(command.visit, 'Something went wrong.'), kind: 'notice' as const },
        ];
        return {
          turn: { committed: false, fault: FAULT, effects },
          changes: null,
          entry: commandEntry(command, effects, FAULT),
          account: null,
        };
      }
      const effects = [said(command.visit, words(command.text))];
      return {
        turn: committed(stored, effects, { value: { step: null, drawn: null, passes: 0 } }),
        changes: nothing(stored.serial + 1),
        entry: commandEntry(command, effects, null),
        account: { ran: [], answered: null, refused: false },
      };
    },
    line: (command, seed) => {
      ask('line');
      const parts = command.text.split(' then ');
      let at = 0;
      return {
        next: (previous) => {
          if (previous !== null && !previous.committed) return null;
          const text = parts[at];
          if (text === undefined) return null;
          at += 1;
          return { ...command, text, seed: at === 1 ? command.seed : seed() };
        },
      };
    },
    tick: (stored, tick) => {
      ask('tick');
      if (tick.place !== HALL || present(stored).length === 0) {
        return {
          turn: { committed: false, unoccupied: true },
          changes: null,
          entry: null,
          account: null,
        };
      }
      return {
        turn: committed(stored, [], {}),
        changes: null,
        entry: null,
        account: { ran: [], answered: null, refused: false },
      };
    },
    wake: () => {
      ask('wake');
      return {
        turn: { committed: false, unwoken: true },
        changes: null,
        entry: null,
        account: null,
      };
    },
    maintenance: (stored) => {
      ask('maintenance');
      return {
        turn: committed(stored, [], {}),
        changes: null,
        entry: null,
        account: { ran: [], answered: null, refused: false },
      };
    },
    arrival: (stored, arrival) => {
      ask('arrival');
      const returning = instanceOf(stored, arrival.visit);
      const serial = stored.serial + 1;
      const instance: StoredInstance = {
        id: returning?.id ?? `${WORLD}#${serial}`,
        made: { from: 'visitor' },
        container: HALL,
        arrival: serial,
      };
      const visitor = {
        visit: arrival.visit,
        nickname: arrival.nickname,
        instance: instance.id,
        lastPlace: HALL,
        referents: [],
        lastReading: null,
      };
      const after = {
        ...stored,
        instances: [...stored.instances.filter((one) => one.id !== instance.id), instance],
        visitors: [...stored.visitors.filter((one) => one.visit !== arrival.visit), visitor],
      };
      const effects = [said(arrival.visit, 'A bare hall.')];
      return {
        turn: committed(after, effects, { value: { returning: returning !== undefined } }),
        changes: { ...nothing(serial), upsert: [instance], visitors: [visitor] },
        entry: {
          kind: 'arrival',
          ...inputs(arrival, effects),
          visit: arrival.visit,
          nickname: arrival.nickname,
          outcome: 'admitted',
          fault: null,
        },
        account: { ran: [], answered: null, refused: false },
      };
    },
    departure: (stored, departure) => {
      ask('departure');
      const instance = instanceOf(stored, departure.visit)!;
      const { container: _stood, ...left } = instance;
      const after = {
        ...stored,
        instances: stored.instances.map((one) => (one.id === instance.id ? left : one)),
      };
      return {
        turn: committed(after, [], {}),
        changes: { ...nothing(stored.serial + 1), upsert: [left] },
        entry: { kind: 'departure', ...inputs(departure, []), visit: departure.visit, fault: null },
        account: { ran: [], answered: null, refused: false },
      };
    },
    nicknameRefusal: () => {
      ask('nicknameRefusal');
      return null;
    },
    view: (_stored, visit) => {
      ask('view');
      return { ...poll(visit), view: HALL_VIEW };
    },
    scene: (_stored, visit) => {
      ask('scene');
      const { readings: _readings, ...place } = HALL_VIEW;
      return {
        ...poll(visit),
        scene: { ...place, verbs: [{ verb: 'hall.wave', phrases: ['wave'] }] },
      };
    },
    readings: (_stored, visit, verb) => {
      ask('readings');
      return { ...poll(visit), verb, readings: [] };
    },
    occupiedPlaces: (stored) => {
      ask('occupiedPlaces');
      return present(stored).length > 0 ? [HALL] : [];
    },
    dueWakes: () => {
      ask('dueWakes');
      return [];
    },
    hearers: (stored, visit) => {
      ask('hearers');
      return instanceOf(stored, visit)?.container === HALL
        ? { place: HALL, to: present(stored) }
        : null;
    },
    standing: (stored, visit) => {
      ask('standing');
      return instanceOf(stored, visit)?.container === HALL
        ? { place: { id: HALL, name: 'a hall' }, here: [] }
        : null;
    },
    parse: unasked('parse'),
    acted: unasked('acted'),
    landed: () => {
      ask('landed');
    },
  };
  return { engine, standing };
}

/** A host running the stand-in, at `logDepth` where one is given. */
export function hallHost(
  logDepth?: 'play' | 'debug',
  words?: (text: string) => string,
): LogHost & { standing: Standing } {
  const { engine, standing } = hallEngine(words);
  return {
    catalogue: CATALOGUE,
    budgets: DEFAULT_LIMITS.budgets,
    engine,
    standing,
    ...(logDepth === undefined ? {} : { logDepth }),
  };
}

/** A store holding the hall as `w`, each of `visits` standing in it by nickname, written with no turn and no log. */
export async function hallWith(...visits: (readonly [VisitKey, string])[]): Promise<SproutStore> {
  const store = memoryStore();
  const instances: StoredInstance[] = visits.map((_, i) => ({
    id: `${WORLD}#${i + 1}`,
    made: { from: 'visitor' },
    container: HALL,
    arrival: i + 1,
  }));
  await store.transaction('w', (tx) =>
    tx.putState({
      serial: visits.length,
      upsert: instances,
      remove: [],
      tombstones: [],
      visitors: visits.map(([visit, nickname], i) => ({
        visit,
        nickname,
        instance: instances[i]!.id,
        lastPlace: HALL,
        referents: [],
        lastReading: null,
      })),
    }),
  );
  return store;
}
