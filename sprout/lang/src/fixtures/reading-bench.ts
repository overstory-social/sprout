// The world the reading goldens are written about, and the oracle's run of every case in it: the
// bench of `fixtures/bench.ts` with a yard and a vault, exits, a link and the parts the reading
// specs play (`reading-cases.ts`), each case a reading run through `runReading` over a state built
// here, and drained by `bus.ts`, with what it ends in: the state it commits or the fault it dies
// with, the effects recorded, the steps spent, the handlers that ran and the descriptions owed.
// The ways out of places, what an exit says as it is taken and the steps an intent plans are
// asked of their own modules over the same states. Spec support: the package build leaves it out.

import type { Bundle } from '../bundle/bundle.js';
import { emitCartridge } from '../bundle/cartridge.js';
import { DEFAULT_LIMITS, type RuntimeBudgets, type StaticCaps } from '../bundle/limits.js';
import { Budget, BudgetExhausted } from '../runtime/budget.js';
import { drain } from '../runtime/bus.js';
import { loadCartridge } from '../runtime/cartridge.js';
import { Draft } from '../runtime/draft.js';
import { Draws } from '../runtime/draws.js';
import { STOCK_LINES } from '../runtime/engine-lines.js';
import type { Evaluated } from '../runtime/evaluate.js';
import { sayingThrough, waysFrom } from '../runtime/exits.js';
import { declaredId, visitKey, type InstanceId } from '../runtime/ids.js';
import { planIntent, type IntentReading } from '../runtime/intents.js';
import { SproutList } from '../runtime/lists.js';
import { initialState, loadWorld, saveWorld } from '../runtime/load.js';
import { owedAfter, owedBy } from '../runtime/move.js';
import { passRules } from '../runtime/passes.js';
import {
  runReading,
  type Bound,
  type PermitRefusal,
  type Reading,
  type ReadingContext,
  type Said,
} from '../runtime/reading.js';
import { newInstance } from '../runtime/state.js';
import type { Speech } from '../runtime/body.js';
import { benchFiles } from './bench.js';
import { compiledWorld } from './bundle.js';
import {
  EXTRAS,
  INTENTS,
  READINGS,
  SAYINGS,
  STATES,
  WAYS,
  type Fill,
  type ReadingCase,
  type Who,
  type Write,
} from './reading-cases.js';

const CAPS = DEFAULT_LIMITS.caps;
const LIBRARY = 'bench';
/** The instant every turn runs at, in host seconds. */
const INSTANT = 1000;

const bundle: Bundle = compiledWorld(LIBRARY, benchFiles(EXTRAS));
const bytes = emitCartridge(bundle);
const catalogue = loadCartridge(bytes, { caps: CAPS });

const id = (...path: string[]): InstanceId => declaredId(LIBRARY, path);

/** A visitor with a record, standing at `place`. */
function arrive(draft: Draft, visit: string, nickname: string, place: InstanceId): InstanceId {
  const instance = draft.mint();
  draft.add(
    newInstance(
      instance,
      { from: 'visitor' },
      catalogue.visitorKind!,
      place,
      draft.nextSerial(),
      CAPS,
    ),
  );
  draft.putVisitor({
    visit: visitKey(visit),
    nickname,
    instance,
    lastPlace: place,
    referents: [],
    lastReading: null,
  });
  return instance;
}

/** What a case's states and names are resolved against: the visitors a state made. */
interface Scene {
  readonly draft: Draft;
  readonly named: Readonly<Record<'marta' | 'ines' | 'fuse', InstanceId | undefined>>;
}

function resolve(scene: Scene, who: Who): InstanceId {
  if (typeof who !== 'string') return id(...who);
  const found = scene.named[who];
  if (found === undefined) throw new Error(`no visitor ${who} in this state`);
  return found;
}

function apply(scene: Scene, write: Write): void {
  const { draft } = scene;
  if ('place' in write) {
    const [thing, into] = write.place;
    draft.place(resolve(scene, thing), resolve(scene, into));
  } else if ('set' in write) {
    const [thing, values] = write.set;
    const held = draft.instance(resolve(scene, thing))!;
    draft.write({
      ...held,
      properties: new Map([...held.properties, ...Object.entries(values)]) as never,
    });
  } else if ('spawn' in write) {
    const [kind, into] = write.spawn;
    const made = draft.mint();
    draft.add(
      newInstance(
        made,
        { from: 'spawned', kind },
        catalogue.kinds.get(kind)!,
        resolve(scene, into),
        draft.nextSerial(),
        CAPS,
      ),
    );
    (scene.named as Record<string, InstanceId>)['fuse'] = made;
  } else if ('link' in write) {
    const [thing, name, to] = write.link;
    const held = draft.instance(resolve(scene, thing))!;
    draft.write({ ...held, links: new Map([...held.links, [name, resolve(scene, to)]]) });
  }
}

/** A draft over a new world, Marta in the shop, and the state `name` made of it. */
function sceneOf(name: string): Scene {
  const draft = new Draft(initialState(catalogue));
  const marta = arrive(draft, 'visit-1', 'Marta', id('shop'));
  const writes = STATES[name];
  if (writes === undefined) throw new Error(`no state ${name}`);
  const ines = writes.find(
    (write): write is Extract<Write, { visitor: unknown }> => 'visitor' in write,
  );
  const scene: Scene = {
    draft,
    named: {
      marta,
      ines:
        ines === undefined
          ? undefined
          : arrive(
              draft,
              ines.visitor[0],
              ines.visitor[1],
              resolve(
                { draft, named: { marta, ines: undefined, fuse: undefined } },
                ines.visitor[2],
              ),
            ),
      fuse: undefined,
    },
  };
  for (const write of writes) if (!('visitor' in write)) apply(scene, write);
  return scene;
}

/** Every state a case or a question names, stored as a store keeps it. */
function storedStates(): Record<string, string> {
  return Object.fromEntries(
    Object.keys(STATES).map((name) => [
      name,
      JSON.stringify(saveWorld(sceneOf(name).draft.commit().state)),
    ]),
  );
}

/** What a value is, in the form the C runtime prints. */
function plain(value: unknown): unknown {
  return value instanceof SproutList ? value.elements.map(plain) : value;
}

function evaluatedJson(evaluated: Evaluated): unknown {
  switch (evaluated.binds) {
    case 'object':
      return { object: evaluated.id };
    case 'set':
      return { set: evaluated.ids };
    case 'readings':
      return { readings: evaluated.typed };
    case 'value':
      return { value: plain(evaluated.value) };
  }
}

/** The engine's own words for a move into what holds no actors, which the C runtime names. */
const NOT_A_PLACE = '{item} cannot stand in {to}.';

/** Words as the C runtime records them: a passage by where it is written, the engine's line by name. */
function speechJson(speech: Speech): unknown {
  if ('passage' in speech)
    return { passage: { origin: speech.passage.origin, name: speech.passage.name } };
  if ('absent' in speech) return { absent: speech.absent };
  if ('recorded' in speech)
    return {
      recorded: { extension: speech.recorded.extension, statement: speech.recorded.statement },
    };
  if (speech.library === 'sprout') {
    if (speech.text === NOT_A_PLACE) return { engine: 'not_a_place' };
    const line = Object.entries(STOCK_LINES).find(([, words]) => words === speech.text);
    if (line !== undefined) return { engine: line[0] };
  }
  return { text: speech.text, library: speech.library };
}

function bindingsJson(bindings: ReadonlyMap<string, Evaluated>): Record<string, unknown> {
  return Object.fromEntries([...bindings].map(([name, one]) => [name, evaluatedJson(one)]));
}

function saidJson(line: Said): unknown {
  return {
    effect: line.effect,
    to: line.to,
    by: line.by,
    speaker: line.speaker,
    said: speechJson(line.said),
    bindings: bindingsJson(line.bindings),
  };
}

function refusalJson(refusal: PermitRefusal): unknown {
  return {
    by: refusal.by,
    role: refusal.role,
    origin: refusal.origin,
    said: speechJson(refusal.said),
    bindings: bindingsJson(refusal.bindings),
  };
}

/** The wire names the C runtime's host budgets are filled from. */
function limitsJson(budgets: RuntimeBudgets, caps: StaticCaps): Record<string, number | null> {
  return {
    steps: budgets.steps,
    events: budgets.events,
    cascadeDepth: budgets.cascadeDepth,
    spawnsPerTurn: budgets.spawnsPerTurn,
    shortestWakeSeconds: budgets.shortestWakeSeconds,
    pendingWakesPerObject: budgets.pendingWakesPerObject,
    peoplePerPlace: budgets.peoplePerPlace,
    extensionEffects: budgets.extensionEffects,
    listElements: caps.listElements,
    instances: null,
  };
}

/** What a case's fills are as the reading holds them, and as the parser's file holds them. */
function boundOf(scene: Scene, fill: Fill): Bound {
  if ('object' in fill) return { object: resolve(scene, fill.object) };
  if ('set' in fill) return { set: fill.set.map((one) => resolve(scene, one)) };
  if ('value' in fill) return { value: fill.value };
  const { direction, label, to } = fill.exit;
  return { exit: { direction: direction as never, label, to: resolve(scene, to) } };
}

function readingOf(one: ReadingCase, scene: Scene): Reading {
  const [library, name] = one.verb.split('.') as [string, string];
  const verb = catalogue.verbs.qualified(library, name);
  if (verb === null) throw new Error(`no verb ${one.verb}`);
  return {
    verb,
    actor: resolve(scene, one.actor),
    bindings: new Map(
      Object.entries(one.fills ?? {}).map(([role, fill]) => [role, boundOf(scene, fill)]),
    ),
  };
}

/** A reading as the parser's file holds it: the verb, the actor, and a filler for each of the verb's roles. */
function readingJson(reading: Reading): unknown {
  return {
    verb: `${reading.verb.library}.${reading.verb.name}`,
    actor: reading.actor,
    fillers: reading.verb.roles.map((role) => {
      const bound = reading.bindings.get(role.name);
      if (bound === undefined) return { role: role.name, binds: 'unbound' };
      if ('object' in bound) return { role: role.name, binds: 'object', id: bound.object };
      if ('set' in bound) return { role: role.name, binds: 'set', ids: bound.set };
      if ('exit' in bound) {
        const { direction, label, to } = bound.exit;
        return { role: role.name, binds: 'exit', direction, label, to };
      }
      return { role: role.name, binds: 'value', value: plain(bound.value) };
    }),
  };
}

/** A budget and the passes over a draft: what every question about a state asks with. */
function askingOf(draft: Draft, budget: Budget) {
  const passes = passRules({
    state: draft,
    kinds: catalogue.lookup,
    caps: catalogue.caps,
    budget,
    names: catalogue.names,
  });
  return { state: draft, catalogue, budget, passes };
}

/** Run one case against the oracle: what it ends in, and everything it recorded. */
function run(one: ReadingCase, stored: string): Record<string, unknown> {
  const scene = sceneOf(one.state ?? 'fresh');
  const draft = new Draft(loadWorld(JSON.parse(stored), catalogue).state);
  const budget = new Budget(DEFAULT_LIMITS.budgets);
  const { passes } = askingOf(draft, budget);
  const context: ReadingContext = {
    draft,
    catalogue,
    passes,
    budget,
    draws: new Draws(one.seed ?? 1),
    mayHold: null,
    now: INSTANT,
  };
  const reading = readingOf(one, scene);
  try {
    const outcome = runReading(reading, context);
    if ('refused' in outcome) {
      return {
        how: 'refused',
        steps: budget.spentSteps,
        refused: refusalJson(outcome.refused),
        after: null,
      };
    }
    const gone = draft.instance(reading.actor) === undefined;
    const owed = owedBy(outcome.notices, outcome.said.length);
    const drained = drain(
      { sends: outcome.sends, destroyed: outcome.destroyed, marked: outcome.marked },
      context,
    );
    const after = JSON.stringify(saveWorld(draft.commit().state));
    return {
      how: gone ? 'gone' : 'acted',
      steps: budget.spentSteps,
      spawns: budget.spentSpawns,
      events: drained.events,
      effects: [...outcome.said, ...drained.said].map(saidJson),
      ran: drained.ran.map((r) => ({ origin: r.origin, on: r.on })),
      owed: [...owed, ...owedAfter(drained.described, outcome.said.length)].map((o) => ({
        mover: o.mover,
        place: o.place,
        after: o.after,
      })),
      destroyed: drained.destroyed,
      after: after === stored ? null : after,
    };
  } catch (thrown) {
    if (thrown instanceof BudgetExhausted) {
      return {
        how: 'fault',
        fault: 'BudgetExhausted',
        budget: thrown.limit,
        limit: thrown.allowed,
        steps: budget.spentSteps,
      };
    }
    if (thrown instanceof Error) {
      return {
        how: 'fault',
        fault: thrown.constructor.name,
        detail: thrown.message,
        steps: budget.spentSteps,
      };
    }
    throw thrown;
  }
}

/** The ways out that apply on a place, as the C runtime lists them. */
function waysJson(state: string, place: Who) {
  const scene = sceneOf(state);
  const budget = new Budget(DEFAULT_LIMITS.budgets);
  const ways = waysFrom(resolve(scene, place), askingOf(scene.draft, budget));
  return {
    ways: ways.map((way) =>
      'to' in way
        ? { direction: way.direction, label: way.label, to: way.to }
        : {
            direction: way.direction,
            label: way.label,
            refuses: { by: way.refuses.by, said: speechJson(way.refuses.said) },
          },
    ),
    steps: budget.spentSteps,
  };
}

/** What taking the way a label names says to whoever takes it. */
function sayingJson(state: string, place: Who, label: string) {
  const scene = sceneOf(state);
  const budget = new Budget(DEFAULT_LIMITS.budgets);
  const asking = askingOf(scene.draft, budget);
  const at = resolve(scene, place);
  const way = waysFrom(at, asking).find((one) => 'to' in one && one.label === label);
  if (way === undefined || !('to' in way)) throw new Error(`no way ${label}`);
  const spent = budget.spentSteps;
  const said = sayingThrough(at, way, asking);
  return {
    way: { direction: way.direction, label: way.label, to: way.to },
    says: said === null ? null : { by: said.by, said: speechJson(said.said) },
    steps: budget.spentSteps - spent,
  };
}

/** The steps an intent plans in a state. */
function plannedJson(one: (typeof INTENTS)[number]) {
  const scene = sceneOf(one.state);
  const budget = new Budget(DEFAULT_LIMITS.budgets);
  const [library, name] = one.intent.split('.') as [string, string];
  const found = catalogue.intentPhrases.find(
    ({ intent }) => intent.library === library && intent.name === name,
  );
  if (found === undefined) throw new Error(`no intent ${one.intent}`);
  const { intent } = found;
  const bindings = new Map<string, Bound>(
    Object.entries(one.slots).map(([slot, who]) => [slot, { object: resolve(scene, who) }]),
  );
  const intended: IntentReading = { intent, actor: resolve(scene, one.actor), bindings };
  const planned = planIntent(intended, askingOf(scene.draft, budget));
  return {
    planned: planned.map((reading) => ({
      verb: `${reading.verb.library}.${reading.verb.name}`,
      fillers: [...reading.bindings].map(([role, bound]) => ({
        role,
        id: 'object' in bound ? bound.object : null,
      })),
    })),
    steps: budget.spentSteps,
  };
}

/** The cartridge the cases are read from. */
export { bytes };

/** Everything the goldens hold, as data. */
export function goldenOf() {
  const states = storedStates();
  return {
    states,
    cases: READINGS.map((one) => {
      const stateName = one.state ?? 'fresh';
      const scene = sceneOf(stateName);
      return {
        name: one.name,
        area: one.area,
        state: stateName,
        seed: one.seed ?? null,
        instant: INSTANT,
        limits: limitsJson(DEFAULT_LIMITS.budgets, CAPS),
        reading: readingJson(readingOf(one, scene)),
        expect: run(one, states[stateName]!),
      };
    }),
    ways: WAYS.map((one) => ({
      name: one.name,
      state: one.state,
      place: resolve(sceneOf(one.state), one.place),
      expect: waysJson(one.state, one.place),
    })),
    sayings: SAYINGS.map((one) => ({
      name: one.name,
      state: one.state,
      place: resolve(sceneOf(one.state), one.place),
      expect: sayingJson(one.state, one.place, one.label),
    })),
    intents: INTENTS.map((one) => {
      const scene = sceneOf(one.state);
      return {
        name: one.name,
        state: one.state,
        intent: one.intent,
        actor: resolve(scene, one.actor),
        slots: Object.fromEntries(
          Object.entries(one.slots).map(([slot, who]) => [slot, resolve(scene, who)]),
        ),
        expect: plannedJson(one),
      };
    }),
  };
}
