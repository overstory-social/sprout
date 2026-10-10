// The world the view goldens are written about, and the oracle's poll of it: the gatehouse of
// `fixtures/view.ts` with a cellar that is dark until a lit lamp is carried into it, a link whose
// label holds a character that is not ASCII, and two sacks one inside the other, so that stuffing
// one into the other is an offer the engine would refuse. Each case is a committed state and a
// visitor, polled by `pollView` under the figures the case names, and written down as the view
// the visitor reads, the tree a chip client walks over it, the steps the poll spent and the
// fault it raised. Every corpus world is polled the same way for a visitor arriving as the
// inspectors admit one. Spec support: the package build leaves it out.

import type { Bundle } from '../bundle/bundle.js';
import { emitCartridge } from '../bundle/cartridge.js';
import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { MEDIA } from '../declare/media.js';
import type { Catalogue } from '../runtime/catalogue.js';
import { loadCartridge } from '../runtime/cartridge.js';
import { arrivalTurn } from '../runtime/arrival.js';
import { Draft } from '../runtime/draft.js';
import { declaredId, visitKey, type InstanceId, type VisitKey } from '../runtime/ids.js';
import { initialState, saveWorld } from '../runtime/load.js';
import { standsInPlace } from '../runtime/live.js';
import { nicknameRefusal } from '../runtime/nickname.js';
import { newInstance, nicknamesIn, type WorldState } from '../runtime/state.js';
import { pollTurn, type TurnHost } from '../runtime/turn.js';
import { emptyViewParts, viewOf } from '../runtime/view.js';
import { SproutList } from '../runtime/lists.js';
import type { Value } from '../runtime/values.js';
import { renderEffects } from '../prose/effects.js';
import { chipTree, type ChipNode, type ChipTree } from '../prose/chips.js';
import {
  pollView,
  renderView,
  type SeenFiller,
  type SeenOptions,
  type SeenReading,
  type SeenThing,
  type SeenView,
} from '../prose/view.js';
import { compiledWorld } from './bundle.js';

const LIBRARY = 'viewbench';

export const VIEW_BENCH: Bundle = compiledWorld(LIBRARY, {
  'viewbench.sprout': `world viewbench is sprout.World {
  visitors are Person
  visitors arrive at yard
  passage unseen { Too much {if true}happens{/if} here to take in. }

  object yard is Yard {
    grammar {
      exit north "through the gate" -> tower when (self.get(:gate_open))
      exit up    "up the ladder"    -> tower
      exit down  "down the cellar steps" -> cellar
      exit east  "into the gallery" -> gallery
      exit west  "into the cloakroom" -> cloakroom
      exit south "into the store" -> store
    }
    object guard is Guard
    object pebble is Pebble
    object purse is Purse { object coin is Pebble }
    object lamp is Lamp
  }
  object gallery is sprout.Place {
    object sentry is Guard
    object usher is Guard
    object keypad is Keypad
    object dial is Dial
  }
  object cloakroom is sprout.Place {
    object wardrobe is Wardrobe { :open true  object hare is Rabbit }
    object trunk is Wardrobe { object mole is Rabbit }
  }
  object store is sprout.Place {
    object big is Sack { object small is Sack }
    object tin is Pebble
    object tin_too is Pebble { grammar { name "tin" } }
  }
  object vault is sprout.Place {
    object warden is Stern
  }
  object tower is sprout.Place {
    grammar { link stair "down the Caf\u00e9\u00a0Stair" }
    describe { text "Wind, and a long view." }
  }
  object cellar is sprout.Place {
    grammar {
      lit (self.sees(sprout.LightSource, :lit))
      exit up "up to the yard" -> yard
    }
    describe { text "Damp stone." }
    object coal is sprout.Fixture
  }
}

verb vouch { role target: Guard  role witness: Guard  role topic: symbol  "vouch to [target] before [witness] for [topic]" }
verb punch { role pad: Keypad  role code: integer  "punch [code] on [pad]" }
verb turn  { role knob: Dial  role notch: integer  "turn [knob] to [notch]" }
verb juggle { role things many  "juggle [things]" }
verb daub { role target  role paint: Pebble  "daub [target] with [paint]"  "daub [target]" }
verb stuff { role item: Sack  role box: Sack  "stuff [item] into [box]" }
enum Topic { bridge, toll, weather, old_road }
`,
  'yard.sprout': `kind Yard is sprout.Place {
  :gate_open false
  describe {
    text "A cobbled yard."
    if (self.get(:gate_open)) { text "The gate stands open." }
  }
}
`,
  'guard.sprout': `kind Guard is sprout.Actor {
  :knows [Topic] default [bridge, toll]
  as target for ask {
    topic from :knows
    do { say "The guard nods." }
  }
  as target for vouch {
    topic from :knows
    do { say "Heard." }
  }
  as witness for vouch {
    topic from :knows
    permit { refuse "Not before me." }
  }
}
`,
  'keypad.sprout': `kind Keypad {
  as pad for punch {
    code from 1 to 12
    do { say "Beep." }
  }
}
`,
  'dial.sprout': `kind Dial {
  :notch 0 min 0 max 9
  as knob for turn {
    notch from :notch
    do { say "Click." }
  }
}
`,
  'stern.sprout': `kind Stern is sprout.Actor {
  passage long { {if true}.{/if}{if true}.{/if}{if true}.{/if}{if true}.{/if}{if true}.{/if}{if true}.{/if}{if true}.{/if}{if true}.{/if}{if true}.{/if}{if true}.{/if}{if true}.{/if}{if true}.{/if}{if true}.{/if}{if true}.{/if}{if true}.{/if}{if true}.{/if}{if true}.{/if}{if true}.{/if}{if true}.{/if}{if true}.{/if}{if true}.{/if}{if true}.{/if}{if true}.{/if}{if true}.{/if}{if true}.{/if}{if true}.{/if}{if true}.{/if}{if true}.{/if}{if true}.{/if}{if true}.{/if}{if true}.{/if}{if true}.{/if}{if true}.{/if}{if true}.{/if}{if true}.{/if}{if true}.{/if}{if true}.{/if}{if true}.{/if}{if true}.{/if}{if true}.{/if} }
  passage longer { {self.long}{self.long}{self.long}{self.long} }
  passage heavy { {self.longer}{self.longer}{self.longer}{self.longer} }
  as target for ask {
    permit { refuse heavy }
  }
}
`,
  'pebble.sprout': 'kind Pebble { }\n',
  'purse.sprout': 'kind Purse { contains }\n',
  'sack.sprout': `kind Sack {
  contains
  as box for stuff { do { move item to self } }
}
`,
  'wardrobe.sprout': `kind Wardrobe {
  contains actors
  :open false
  pass any (self.get(:open))
}
`,
  'rabbit.sprout': 'kind Rabbit is sprout.Actor { }\n',
  'lamp.sprout': 'kind Lamp is sprout.LightSource { grammar { nouns "lamp" } }\n',
  'person.sprout': 'kind Person is sprout.Visitor { }\n',
});

/** The bench packed as a cartridge, which the C tests load. */
export const VIEW_CARTRIDGE: Uint8Array = emitCartridge(VIEW_BENCH);

const CAPS = DEFAULT_LIMITS.caps;
export const BENCH: Catalogue = loadCartridge(VIEW_CARTRIDGE, { caps: CAPS });

const at = (...path: string[]): InstanceId => declaredId(LIBRARY, path);
export const YARD = at('yard');
export const GALLERY = at('gallery');
export const CLOAKROOM = at('cloakroom');
export const STORE = at('store');
export const TOWER = at('tower');
export const CELLAR = at('cellar');
export const VAULT = at('vault');
export const GUARD = at('yard', 'guard');
export const SENTRY = at('gallery', 'sentry');
export const PEBBLE = at('yard', 'pebble');
export const PURSE = at('yard', 'purse');
export const LAMP = at('yard', 'lamp');

export const MARTA: VisitKey = visitKey('v-marta');
export const INES: VisitKey = visitKey('v-ines');

/** Who stands where in a case's state, what they hold, and what is written over the declared world. */
export interface Scene {
  /** Each visitor, by visit, nickname and place. */
  readonly standing?: readonly (readonly [VisitKey, string, InstanceId])[];
  /** Each thing (or visitor) put into a place or hands, in order. */
  readonly moves?: readonly (readonly [InstanceId | VisitKey, InstanceId | VisitKey])[];
  /** Properties written, by thing. */
  readonly set?: readonly (readonly [InstanceId, string, Value | readonly string[]])[];
  /** Links connected, by thing and name. */
  readonly connected?: readonly (readonly [InstanceId, string, InstanceId])[];
}

/** The bench as committed under `scene`. */
export function benchState(scene: Scene): WorldState {
  const draft = new Draft(initialState(BENCH));
  const standing = scene.standing ?? [[MARTA, 'Marta', YARD]];
  for (const [visit, nickname, where] of standing) {
    const id = draft.mint();
    draft.add(
      newInstance(id, { from: 'visitor' }, BENCH.visitorKind!, where, draft.nextSerial(), CAPS),
    );
    draft.putVisitor({
      visit,
      nickname,
      instance: id,
      lastPlace: where,
      referents: [],
      lastReading: null,
    });
  }
  const resolve = (one: InstanceId | VisitKey): InstanceId =>
    draft.visitor(one as VisitKey)?.instance ?? (one as InstanceId);
  for (const [thing, into] of scene.moves ?? []) draft.place(resolve(thing), resolve(into));
  for (const [id, name, value] of scene.set ?? []) {
    const instance = draft.instance(id)!;
    const held = instance.properties.get(name);
    const next =
      Array.isArray(value) && held instanceof SproutList
        ? SproutList.of(held.holds, value as readonly string[], CAPS)
        : (value as Value);
    draft.write({ ...instance, properties: new Map(instance.properties).set(name, next) });
  }
  for (const [id, name, to] of scene.connected ?? []) {
    const instance = draft.instance(id)!;
    draft.write({ ...instance, links: new Map(instance.links).set(name, to) });
  }
  return draft.commit().state;
}

/** The host a catalogue is polled under, with `pollSteps` as given. */
export function hostOf(
  catalogue: Catalogue,
  pollSteps = DEFAULT_LIMITS.budgets.pollSteps,
): TurnHost {
  return {
    catalogue,
    budgets: { ...DEFAULT_LIMITS.budgets, pollSteps },
    render: renderEffects,
  };
}

/** The wire names the C runtime's host budgets are filled from. */
function limitsJson(pollSteps: number): Record<string, number | null> {
  const budgets = DEFAULT_LIMITS.budgets;
  return {
    steps: budgets.steps,
    pollSteps,
    events: budgets.events,
    cascadeDepth: budgets.cascadeDepth,
    passageDepth: budgets.passageDepth,
    setRoleObjects: budgets.setRoleObjects,
    spawnsPerTurn: budgets.spawnsPerTurn,
    shortestWakeSeconds: budgets.shortestWakeSeconds,
    pendingWakesPerObject: budgets.pendingWakesPerObject,
    peoplePerPlace: budgets.peoplePerPlace,
    extensionEffects: budgets.extensionEffects,
    listElements: CAPS.listElements,
    instances: null,
  };
}

// ---- a view, written down ----

const thingJson = (thing: SeenThing) => ({ id: thing.id, name: thing.name });

function fillerJson(filler: SeenFiller): unknown {
  switch (filler.binds) {
    case 'object':
      return { role: filler.role, binds: 'object', id: filler.id, name: filler.name };
    case 'set':
      return { role: filler.role, binds: 'set', ids: filler.ids, names: filler.names };
    case 'exit':
      return {
        role: filler.role,
        binds: 'exit',
        direction: filler.direction,
        label: filler.label,
        to: filler.to,
      };
    case 'unbound':
      return { role: filler.role, binds: 'unbound' };
  }
}

function optionsJson(options: SeenOptions): unknown {
  if (options.takes === 'integer') {
    return {
      role: options.role,
      takes: 'integer',
      ranges: options.ranges.map(({ min, max }) => ({ min, max })),
    };
  }
  return {
    role: options.role,
    takes: 'symbol',
    options: options.options.map(({ value, words }) => ({ value, words })),
  };
}

function readingJson(reading: SeenReading): unknown {
  return {
    verb: reading.verb,
    typed: reading.typed,
    refused: reading.refused,
    fillers: reading.fillers.map(fillerJson),
    options: reading.options.map(optionsJson),
  };
}

/** A view as the C runtime writes it (`runtime-c/src/view_json.c`). */
export function viewJson(view: SeenView): unknown {
  return {
    description: view.description,
    effects: view.effects.map(({ extension, statement, payload, transcript }) => ({
      extension,
      statement,
      payload,
      transcript,
    })),
    exits: view.exits.map(({ direction, label, to }) => ({ direction, label, to })),
    occupants: view.occupants.map(thingJson),
    carried: view.carried.map(thingJson),
    readings: view.readings.map(readingJson),
  };
}

function nodeJson(node: ChipNode): unknown {
  return {
    choices: node.choices.map(({ filler, next }) => ({
      filler: fillerJson(filler),
      next: nodeJson(next),
    })),
    leaf:
      node.leaf === null
        ? null
        : {
            typed: node.leaf.typed,
            refused: node.leaf.refused,
            options: node.leaf.options.map(optionsJson),
          },
  };
}

/** A chip tree as the C runtime writes it (`runtime-c/src/chips.c`). */
export function chipsJson(tree: ChipTree): unknown {
  return tree.map(({ verb, next }) => ({ verb, next: nodeJson(next) }));
}

/** What a visit's poll came to, written down. */
export interface ViewCase {
  readonly view: unknown;
  readonly chips: unknown;
  readonly steps: number | null;
  readonly fault: { readonly name: string; readonly object: string | null } | null;
}

/** `visit`'s view over `state`, as `pollView` gives it, with the steps the poll spent when it did not fault. */
export function viewCase(state: WorldState, host: TurnHost, visit: VisitKey): ViewCase {
  const polled = pollView(state, host, visit);
  const actor = state.visitors.get(visit)!.instance;
  const nicknames = nicknamesIn(state);
  const measured = pollTurn(state, host, (turn) => {
    const context = { ...turn, nicknames, draws: null, actor };
    if (standsInPlace(turn.state, actor))
      renderView(viewOf(actor, context, emptyViewParts()), context);
    return turn.budget.spentSteps;
  });
  const { fault } = polled;
  return {
    view: viewJson(polled.view),
    chips: chipsJson(chipTree(polled.view)),
    steps: measured.faulted ? null : measured.view,
    fault: fault === null ? null : { name: fault.name, object: fault.object },
  };
}

// ---- the cases ----

interface Bench {
  readonly name: string;
  readonly scene: Scene;
  readonly visit: VisitKey;
  readonly pollSteps?: number;
}

const bench = (name: string, scene: Scene, visit: VisitKey = MARTA, pollSteps?: number): Bench => ({
  name,
  scene,
  visit,
  ...(pollSteps === undefined ? {} : { pollSteps }),
});

const lit: Value = true;

/** The bench's cases: one for each thing a view is for. */
export const BENCH_CASES: readonly Bench[] = [
  bench('a visitor in the yard is offered the verbs once for each way their roles fill', {}),
  bench('a gate that stands open is a way north beside the ladder', {
    set: [[YARD, 'gate_open', true]],
  }),
  bench('a link set is a way out typed by its label', {
    standing: [[MARTA, 'Marta', TOWER]],
    connected: [[TOWER, 'stair', YARD]],
  }),
  bench('a link not set is no way out', { standing: [[MARTA, 'Marta', TOWER]] }),
  bench('a set role is offered one member at a time, and a value role what its role-players hear', {
    standing: [[MARTA, 'Marta', GALLERY]],
  }),
  bench('a role-player that changes what it hears changes the options', {
    standing: [[MARTA, 'Marta', GALLERY]],
    set: [[SENTRY, 'knows', ['old_road', 'weather']]],
  }),
  bench('what a visitor carries is offered to carried roles and named in the view', {
    moves: [
      [PEBBLE, MARTA],
      [PURSE, MARTA],
    ],
  }),
  bench('two visitors see each other, and an open wardrobe lists who is in it', {
    standing: [
      [MARTA, 'Marta', CLOAKROOM],
      [INES, 'Ines', CLOAKROOM],
    ],
  }),
  bench('a witness that refuses greys the readings it is asked in', {
    standing: [[MARTA, 'Marta', GALLERY]],
  }),
  bench(
    'stuffing a sack into the one inside it is greyed with inside_itself, and two tins written alike are two offers',
    {
      standing: [[MARTA, 'Marta', STORE]],
    },
  ),
  bench('the cellar is dark: only what is carried is offered, and the way out', {
    standing: [[MARTA, 'Marta', CELLAR]],
  }),
  bench('a lit lamp carried into the cellar lights it', {
    standing: [[MARTA, 'Marta', CELLAR]],
    moves: [[LAMP, MARTA]],
    set: [[LAMP, 'lit', lit]],
  }),
  bench('in the dark what is carried is still offered, and nobody else is seen', {
    standing: [
      [MARTA, 'Marta', CELLAR],
      [INES, 'Ines', CELLAR],
    ],
    moves: [[PEBBLE, MARTA]],
  }),
  bench('a visitor whose place is not a place any more is told so and offered nothing', {
    moves: [[MARTA, PURSE]],
  }),
  bench(
    'a poll that spends its budget shows unseen and keeps the parts it had derived',
    {},
    MARTA,
    130,
  ),
  bench('a poll that spends its budget before the exits shows unseen alone', {}, MARTA, 8),
  bench('a poll that spends its budget while rendering keeps every part', {}, MARTA, 244),
  bench('a poll that cannot afford unseen says the engine’s own words', {}, MARTA, 1),
  bench(
    'a poll whose kept parts cannot be rendered either keeps nothing',
    { standing: [[MARTA, 'Marta', VAULT]] },
    MARTA,
    500,
  ),
];

/** A visitor arriving in `catalogue`'s world as the inspectors admit one, and the state they arrive in. */
function arrived(catalogue: Catalogue): { state: WorldState; host: TurnHost; visit: VisitKey } {
  const host = hostOf(catalogue);
  const visit = visitKey('inspector');
  const loaded = initialState(catalogue);
  if (nicknameRefusal(loaded, catalogue, host.budgets, visit, 'Inspector') !== null) {
    throw new Error('the inspector is not admitted.');
  }
  const done = arrivalTurn(loaded, host, {
    visit,
    nickname: 'Inspector',
    seed: 0,
    mayHold: null,
    now: 0,
  });
  if (!done.committed) throw new Error('the inspector did not arrive.');
  return { state: done.state, host, visit };
}

/** The goldens: the states the bench cases start from, every case, and the view of a visitor arriving in each corpus world. */
export function viewGoldens(worlds: readonly (readonly [string, Bundle])[]) {
  const cases = BENCH_CASES.map((one) => {
    const state = benchState(one.scene);
    const pollSteps = one.pollSteps ?? DEFAULT_LIMITS.budgets.pollSteps;
    return {
      name: one.name,
      state: JSON.stringify(saveWorld(state)),
      visit: one.visit,
      limits: limitsJson(pollSteps),
      expect: viewCase(state, hostOf(BENCH, pollSteps), one.visit),
    };
  });
  const corpus = worlds.map(([name, bundle]) => {
    const catalogue = loadCartridge(emitCartridge(bundle), { caps: CAPS, installed: [MEDIA] });
    const { state, host, visit } = arrived(catalogue);
    return {
      world: name,
      state: JSON.stringify(saveWorld(state)),
      visit,
      limits: limitsJson(host.budgets.pollSteps),
      expect: viewCase(state, host, visit),
    };
  });
  return { cases, corpus };
}

/** The goldens as the file holds them: one line for each case and each corpus world, so a change to one is one changed line. */
export function goldenText(goldens: ReturnType<typeof viewGoldens>): string {
  const lines = (list: readonly unknown[]): string =>
    `[\n${list.map((one) => JSON.stringify(one)).join(',\n')}\n]`;
  return `{"cases":${lines(goldens.cases)},"corpus":${lines(goldens.corpus)}}\n`;
}
