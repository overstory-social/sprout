import { describe, expect, it } from 'vitest';

import { MEDIA } from './fixtures/media.js';

import {
  ItemDefinition,
  RoomDefinition,
  UNDERSTORY_CASCADE_DEPTH,
  UNDERSTORY_EVENT_BUDGET,
  UNDERSTORY_FAULT_CHAIN,
  UNDERSTORY_MAX_INSTANCES,
  UNDERSTORY_SPAWNS_PER_ACTION,
  type SproutState,
} from './definitions.js';
import { compileSprout, compileSproutKind } from './sprout-lang.js';
import {
  kindAsItem,
  resolveDefinition,
  type KindDefinition,
  type SproutDefinition2,
} from './sprout.js';

import {
  actorObject,
  definitionOf,
  describeWith,
  findMessage,
  fit,
  memoryOf,
  normalizeObjectState,
  normalizeState,
  openVerbs,
  renderProse,
  runMove,
  runVerb,
  takeableOf,
  verbLabel,
  visibleItems,
  type SpawnableKind,
  type SproutObject,
  type SproutWorld,
} from './engine.js';

// The one evaluator, exhaustively (#259, #339): v0 definitions upgraded
// (so the seeded studios' semantics are asserted, not assumed) and
// Sprout compiled straight from the language — expressions, hooks,
// envelopes, the depth cap and the event budget as faults, no cycle
// rule, delivery order — all without a database.

function sprout(source: string): SproutDefinition2 {
  const result = compileSprout(source, { ext: MEDIA });
  if (!result.definition) {
    throw new Error(result.problems.map((p) => `${p.line}:${p.column} ${p.message}`).join('\n'));
  }
  return result.definition;
}

const ACTOR = 'p-actor';

/** An object; an item sits in the room unless `carried` (the actor's hands) or `inside` (a container). */
function object(
  id: string,
  kind: 'room' | 'item',
  definition: SproutDefinition2,
  state: SproutState = {},
  visitor: SproutState = {},
  carried = false,
  inside?: string,
): SproutObject {
  return {
    id,
    kind,
    definition,
    state: normalizeObjectState(definition, state, MEDIA),
    visitor: normalizeState(definition.remembers, visitor, MEDIA),
    container: kind === 'room' ? null : (inside ?? (carried ? ACTOR : 'room')),
    home: kind === 'room' ? null : 'room',
    spawnedFrom: null,
    kinds: [],
  };
}

/** A world whose room is `room`; items default to sitting in it. */
function world(
  room: SproutObject,
  items: SproutObject[],
  elsewhere?: SproutObject[],
  kinds?: ReadonlyMap<string, SpawnableKind>,
): SproutWorld {
  const fixed = items.map((i) => ({
    ...i,
    container: i.container === 'room' ? room.id : i.container,
    home: i.home === 'room' ? room.id : i.home,
  }));
  let n = 0;
  return {
    room,
    actor: actorObject(ACTOR),
    items: fixed,
    ext: MEDIA,
    ...(elsewhere ? { elsewhere } : {}),
    ...(kinds ? { kinds, mint: () => `made-${++n}`, instanceCount: fixed.length + 1 } : {}),
  };
}

/** The zone's kinds, compiled from Sprout, as the world spawns them. */
function kindsOf(...sources: string[]): ReadonlyMap<string, SpawnableKind> {
  const defs: KindDefinition[] = sources.map((src) => {
    const r = compileSproutKind(src);
    if (!r.definition) throw new Error(r.problems.map((p) => p.message).join('\n'));
    return r.definition;
  });
  const byName = new Map(defs.map((d) => [d.kindName, d]));
  return new Map(
    defs.map((d) => [d.kindName, { kindId: `k-${d.kindName}`, ...kindAsItem(d, byName) }]),
  );
}

// --- v0, upgraded: the lantern and the conservatory from #259 ---------------------

const lanternDef = definitionOf(
  ItemDefinition.parse({
    format: 1,
    name: 'Brass lantern',
    prose: 'A brass lantern, dark.',
    fields: [
      { type: 'boolean', name: 'lit', default: false },
      { type: 'integer', name: 'fuel', default: 2, min: 0, max: 10 },
    ],
    visitorFields: [{ type: 'boolean', name: 'has_lit', default: false }],
    views: [
      {
        guard: { kind: 'field', on: 'self', field: 'lit', op: 'eq', value: true },
        prose: 'It burns.',
      },
    ],
    verbs: [
      {
        name: 'light',
        guard: {
          kind: 'all',
          guards: [
            { kind: 'field', on: 'self', field: 'lit', op: 'eq', value: false },
            { kind: 'field', on: 'self', field: 'fuel', op: 'gt', value: 0 },
          ],
        },
        effects: [
          { op: 'set', field: 'lit', value: true },
          { op: 'adjust', field: 'fuel', by: -1 },
          { op: 'set_visitor', field: 'has_lit', value: true },
          { op: 'say', text: 'The wick catches.' },
          { op: 'send_message', to: 'room', item: null, message: 'lantern_lit' },
        ],
      },
      {
        name: 'Snuff',
        guard: { kind: 'field', on: 'self', field: 'lit', op: 'eq', value: true },
        effects: [
          { op: 'set', field: 'lit', value: false },
          { op: 'send_message', to: 'room', item: null, message: 'lantern_out' },
        ],
      },
    ],
    handlers: [
      {
        message: 'gust',
        guard: { kind: 'field', on: 'self', field: 'lit', op: 'eq', value: true },
        effects: [
          { op: 'set', field: 'lit', value: false },
          { op: 'say', text: 'The lantern gutters out.' },
        ],
      },
    ],
  }),
);

const conservatoryDef = definitionOf(
  RoomDefinition.parse({
    format: 1,
    name: 'The Conservatory',
    prose: 'Gloaming light. Shadows pool in the corners.',
    exits: [],
    fields: [{ type: 'enum', name: 'light', options: ['dim', 'bright'], default: 'dim' }],
    visitorFields: [{ type: 'integer', name: 'visits', default: 0, min: 0, max: 99 }],
    views: [
      {
        guard: { kind: 'field', on: 'self', field: 'light', op: 'eq', value: 'bright' },
        prose: 'Warm light everywhere. A fresco shows on the north wall.',
      },
    ],
    verbs: [
      {
        name: 'open the window',
        guard: null,
        effects: [
          { op: 'set_visitor', field: 'visits', value: 1 },
          { op: 'send_message', to: 'items', item: null, message: 'gust' },
          { op: 'say', text: 'A cold draught.' },
        ],
      },
      {
        name: 'study the fresco',
        guard: { kind: 'field', on: 'self', field: 'light', op: 'eq', value: 'bright' },
        effects: [{ op: 'say', text: 'Saints, mostly.' }],
      },
      {
        name: 'clap',
        guard: null,
        effects: [{ op: 'send_message', to: 'item', item: 'Brass lantern', message: 'gust' }],
      },
    ],
    handlers: [
      {
        message: 'lantern_lit',
        guard: null,
        effects: [{ op: 'set', field: 'light', value: 'bright' }],
      },
      {
        message: 'lantern_out',
        guard: null,
        effects: [{ op: 'set', field: 'light', value: 'dim' }],
      },
    ],
  }),
);

function conservatory(lanternState: SproutState = {}): SproutWorld {
  return world(object('r-cons', 'room', conservatoryDef), [
    object('i-lantern', 'item', lanternDef, lanternState),
  ]);
}

// --- Sprout: the torch, the key and the cellar (sprout.md §2.1) --------------------

const TORCH = sprout(`object torch {
  :names ["torch", "brand"]
  :on_fire false
  :illuminating false
  :takeable true
  describe {
    if (self.get(:on_fire)) { text "A pitch torch, burning steadily." }
    else { text "A pitch torch, cold." }
  }
  use (with: object) {
    grammar "light [self] with [with]"
    if (with.get(:on_fire)) {
      self.set(:on_fire, true)
      self.set(:illuminating, true)
      say "The pitch catches with a soft whump."
    } else {
      say "Nothing about that will light a torch."
    }
  }
  changed :illuminating (value, was) { broadcast :illuminating(value) }
}`);

const FLINT = sprout(`object flint {
  :names ["flint", "flint and steel"]
  :on_fire true
}`);

const KEY = sprout(`object brass_key {
  :names ["key"]
  :glinting false
  on :illuminating (from, value) {
    if (value && !self.get(:glinting)) {
      self.set(:glinting, true)
      say "Something glints in the new light."
    }
  }
  describe {
    if (self.get(:glinting)) { text "A brass key, catching the light." } else { text "A brass key." }
  }
}`);

const CELLAR = sprout(`room cellar {
  :illuminated false
  describe {
    if (self.get(:illuminated)) { text "A vaulted cellar." } else { text "Pitch dark." }
  }
  on :illuminating (from, value) { self.set(:illuminated, value) }
}`);

function cellar(): SproutWorld {
  return world(object('r-cellar', 'room', CELLAR), [
    object('i-torch', 'item', TORCH),
    object('i-flint', 'item', FLINT, {}, {}, true),
    object('i-key', 'item', KEY),
  ]);
}

// --- state --------------------------------------------------------------------------

describe('state normalization (the §5 migration seam)', () => {
  it('fills defaults, drops undeclared keys, clamps integers, refuses misfits', () => {
    expect(normalizeObjectState(lanternDef, { lit: 'yes', fuel: 40, extra: 1 })).toEqual({
      lit: false,
      fuel: 10,
      takeable: false,
    });
    expect(normalizeObjectState(conservatoryDef, { light: 'blinding' })).toEqual({ light: 'dim' });
  });

  it('keeps a well-known property only when the state already holds one that fits', () => {
    expect(normalizeObjectState(KEY, { glinting: true, hidden: true, open: true })).toEqual({
      glinting: true,
      hidden: true,
    });
    expect(normalizeObjectState(KEY, { hidden: 'yes' })).toEqual({ glinting: false });
  });

  it('fit is typed by the field', () => {
    const [lit, fuel] = lanternDef.properties;
    expect(fit(lit!, 1)).toBeUndefined();
    expect(fit(fuel!, 2.5)).toBeUndefined();
    expect(fit(fuel!, -3)).toBe(0);
    expect(fit(conservatoryDef.properties[0]!, 'bright')).toBe('bright');
  });

  it('takeable: v0 portable declared it; else the well-known default; a verb may set it', () => {
    expect(takeableOf(object('i', 'item', lanternDef))).toBe(false);
    expect(takeableOf(object('i', 'item', TORCH))).toBe(true);
    expect(takeableOf(object('i', 'item', KEY))).toBe(false);
    expect(takeableOf(object('i', 'item', KEY, { takeable: true }))).toBe(true);
  });
});

// --- projections ---------------------------------------------------------------------

describe('projections', () => {
  it('describe from upgraded views: the first applicable, else the plain prose', () => {
    expect(renderProse(object('i', 'item', lanternDef))).toBe('A brass lantern, dark.');
    expect(renderProse(object('i', 'item', lanternDef, { lit: true }))).toBe('It burns.');
  });

  it('describe may read other objects in range, and falls back to the prose when it says nothing', () => {
    const shelf = sprout(`object shelf {
      prose "A shelf."
      describe { if (room.get(:illuminated)) { text "A shelf, and on it a key." } }
    }`);
    const world = cellar();
    const obj = object('i-shelf', 'item', shelf);
    expect(renderProse(obj, world)).toBe('A shelf.');
    world.room.state['illuminated'] = true;
    expect(renderProse(obj, world)).toBe('A shelf, and on it a key.');
  });

  it('open verbs are those offered `when` it holds, labelled as written', () => {
    expect(openVerbs(object('i', 'item', lanternDef))).toEqual(['light']);
    expect(openVerbs(object('i', 'item', lanternDef, { lit: true }))).toEqual(['Snuff']);
    expect(openVerbs(object('i', 'item', lanternDef, { fuel: 0 }))).toEqual([]);
    expect(openVerbs(object('r', 'room', conservatoryDef))).toEqual(['open the window', 'clap']);
  });

  it('labels: the first grammar line without [self] and with a slot as an ellipsis; else the name humanised', () => {
    expect(verbLabel(TORCH.messages[0]!)).toBe('light with …');
    expect(verbLabel({ ...TORCH.messages[0]!, grammar: [] })).toBe('Use');
    expect(verbLabel({ ...TORCH.messages[0]!, grammar: ['strike [with] against [self]'] })).toBe(
      'strike … against',
    );
  });

  it('reserved and abstract messages are never verbs', () => {
    const door = sprout(`room door {
      on :entered (item) { say "hello" }
      knock { say "tap" }
    }`);
    expect(openVerbs(object('r', 'room', door))).toEqual(['Knock']);
    expect(findMessage(object('r', 'room', door), 'entered')).toBeUndefined();
  });

  it('finds a message by name, humanised name, or any grammar line, case-insensitively', () => {
    const torch = object('i', 'item', TORCH);
    expect(findMessage(torch, 'USE')?.name).toBe('use');
    expect(findMessage(torch, 'Light [self] with [with]')?.name).toBe('use');
    const lantern = object('i', 'item', lanternDef);
    expect(findMessage(lantern, 'snuff')?.name).toBe('snuff');
    expect(findMessage(lantern, 'juggle')).toBeUndefined();
  });

  it('memory lists only what differs from the defaults, room first then items by id', () => {
    const world = conservatory();
    expect(memoryOf(world)).toEqual([]);
    world.items[0]!.visitor['has_lit'] = true;
    world.room.visitor['visits'] = 2;
    expect(memoryOf(world)).toEqual([
      { object: 'The Conservatory', fields: [{ name: 'visits', value: 2 }] },
      { object: 'Brass lantern', fields: [{ name: 'has_lit', value: true }] },
    ]);
  });
});

// --- runVerb: the v0 semantics, unchanged ----------------------------------------------

describe('runVerb on upgraded v0 definitions', () => {
  it('a verb on an item changes its state, remembers the visitor, speaks, and messages the room', () => {
    const world = conservatory();
    const out = runVerb(world, 'i-lantern', 'light');
    expect(out.ok).toBe(true);
    expect(out.fault).toBeNull();
    expect(out.narration).toEqual(['The wick catches.']);
    expect(world.items[0]!.state).toEqual({ lit: true, fuel: 1, takeable: false });
    expect(world.items[0]!.visitor).toEqual({ has_lit: true });
    expect(world.room.state).toEqual({ light: 'bright' });
    expect(out.changed).toEqual(new Set(['i-lantern', 'r-cons']));
    expect(out.remembered).toEqual(new Set(['i-lantern']));
    expect(out.events).toBe(1);
    expect(out.maxDepth).toBe(1);
    expect(renderProse(world.room)).toContain('A fresco shows');
    expect(openVerbs(world.room)).toEqual(['open the window', 'study the fresco', 'clap']);
  });

  it('verb names match case-insensitively; a closed or unknown verb is not ok and changes nothing', () => {
    const world = conservatory();
    expect(runVerb(world, 'i-lantern', 'LIGHT').ok).toBe(true);
    const closed = runVerb(world, 'i-lantern', 'light');
    expect(closed.ok).toBe(false);
    expect(closed.narration).toEqual([]);
    expect(runVerb(world, 'i-lantern', 'juggle').ok).toBe(false);
    expect(runVerb(world, 'i-nobody', 'light').ok).toBe(false);
    expect(runVerb(world, 'r-cons', 'study the fresco').ok).toBe(true);
  });

  it('adjust clamps to the declared bounds', () => {
    const world = conservatory({ fuel: 1 });
    runVerb(world, 'i-lantern', 'light');
    expect(world.items[0]!.state['fuel']).toBe(0);
    runVerb(world, 'i-lantern', 'snuff');
    expect(runVerb(world, 'i-lantern', 'light').ok).toBe(false); // fuel gt 0 fails
  });

  it('"every item" became a broadcast: the room hears it too, then items in id order', () => {
    const log: string[] = [];
    const listener = (name: string) => sprout(`object ${name} { on :gust { say "${name}" } }`);
    const w = world(object('r-cons', 'room', conservatoryDef), [
      object('i-zed', 'item', listener('zed')),
      object('i-lantern', 'item', lanternDef, { lit: true }),
      object('i-alpha', 'item', listener('alpha')),
    ]);
    const out = runVerb(w, 'r-cons', 'open the window');
    log.push(...out.narration);
    expect(log).toEqual(['A cold draught.', 'alpha', 'The lantern gutters out.', 'zed']);
    expect(w.items[1]!.state['lit']).toBe(false);
    expect(w.room.visitor).toEqual({ visits: 1 });
    expect(out.events).toBe(3);
  });

  it('a message to one item goes by the identifier of its name', () => {
    const world = conservatory({ lit: true });
    expect(runVerb(world, 'r-cons', 'clap').narration).toEqual(['The lantern gutters out.']);
    expect(world.items[0]!.state['lit']).toBe(false);
  });

  it('a handler whose guard fails receives nothing; an empty say is not narration', () => {
    const quiet = sprout(`object quiet { on :gust { say "" } }`);
    const w = world(object('r-cons', 'room', conservatoryDef), [
      object('i-lantern', 'item', lanternDef),
      object('i-q', 'item', quiet),
    ]);
    expect(runVerb(w, 'r-cons', 'open the window').narration).toEqual(['A cold draught.']);
    expect(w.items[0]!.state['lit']).toBe(false);
  });
});

// --- runVerb: the language ---------------------------------------------------------------

describe('runVerb on Sprout', () => {
  it('binds an argument, reads its property, and the change cascades through a hook and a broadcast', () => {
    const world = cellar();
    const out = runVerb(world, 'i-torch', 'use', { with: 'i-flint' });
    expect(out.ok).toBe(true);
    expect(out.fault).toBeNull();
    expect(out.narration).toEqual([
      'The pitch catches with a soft whump.',
      'Something glints in the new light.',
    ]);
    expect(world.items[0]!.state).toMatchObject({ on_fire: true, illuminating: true });
    expect(world.room.state['illuminated']).toBe(true);
    expect(world.items[2]!.state['glinting']).toBe(true);
    expect(renderProse(world.room, world)).toBe('A vaulted cellar.');
    expect(renderProse(world.items[2]!, world)).toBe('A brass key, catching the light.');
    // the hook (depth 1) then its broadcast to the room, the flint and the key (depth 2)
    expect(out.events).toBe(4);
    expect(out.maxDepth).toBe(2);
    expect(out.changed).toEqual(new Set(['i-torch', 'r-cellar', 'i-key']));
  });

  it('an argument that is missing, or not in range, is not ok', () => {
    expect(runVerb(cellar(), 'i-torch', 'use').ok).toBe(false);
    expect(runVerb(cellar(), 'i-torch', 'use', { with: 'i-nobody' }).ok).toBe(false);
  });

  it('a hook fires only on a real change, with the old value bound', () => {
    const counter = sprout(`object counter {
      :n 0
      :log 0
      bump { self.set(:n, 1) }
      same { self.set(:n, self.get(:n)) }
      changed :n (value, was) { self.set(:log, self.get(:log) + 1) say "was" }
    }`);
    const w = world(object('r', 'room', CELLAR), [object('i', 'item', counter)]);
    runVerb(w, 'i', 'bump');
    expect(w.items[0]!.state).toEqual({ n: 1, log: 1 });
    const again = runVerb(w, 'i', 'bump');
    expect(again.events).toBe(0);
    expect(w.items[0]!.state['log']).toBe(1);
    expect(runVerb(w, 'i', 'same').events).toBe(0);
  });

  it('a well-known property may be set undeclared and lands in the state', () => {
    const world = cellar();
    const hider = sprout(`object hider { vanish { self.set(:hidden, true) } }`);
    world.items.push(object('i-h', 'item', hider));
    runVerb(world, 'i-h', 'vanish');
    expect(world.items[3]!.state).toEqual({ hidden: true });
  });

  it('expressions: arithmetic, comparison, symbols, recall, if / else if', () => {
    const wheel = sprout(`object wheel {
      :stage one_of [bare, centred, cup] default bare
      :spins 0
      :remembers [thrown: 0 min 0 max 99]
      kick {
        self.set(:spins, self.get(:spins) + 2 - 1)
        if (self.get(:stage) == :bare && self.get(:spins) >= 1) { self.set(:stage, :centred) say "centred" }
        else if (self.get(:stage) == :centred) { self.set(:stage, :cup) actor.remember(:thrown, actor.recall(:thrown) + 1) say "a cup" }
        else { say "nothing" }
      }
    }`);
    const w = world(object('r', 'room', CELLAR), [object('i', 'item', wheel)]);
    expect(runVerb(w, 'i', 'kick').narration).toEqual(['centred']);
    expect(runVerb(w, 'i', 'kick').narration).toEqual(['a cup']);
    expect(w.items[0]!.visitor).toEqual({ thrown: 1 });
    expect(w.items[0]!.state).toEqual({ stage: 'cup', spins: 2 });
    expect(runVerb(w, 'i', 'kick').narration).toEqual(['nothing']);
  });

  it('each walks the room (not carried) or the actor (carried); count agrees; send by :names', () => {
    const sweeper = sprout(`object sweeper {
      sweep {
        each thing in room { send thing :nudge }
        each held in actor { send held :nudge }
        if (room.count == 4 && actor.count == 1) { say "counted" }
        send key :nudge
      }
    }`);
    const nudged = (name: string) =>
      sprout(`object ${name} { on :nudge (from) { say "${name}" } }`);
    const w = world(object('r', 'room', CELLAR), [
      object('i-s', 'item', sweeper),
      object('i-b', 'item', nudged('b')),
      object('i-a', 'item', nudged('a')),
      object('i-held', 'item', nudged('held'), {}, {}, true),
      object('i-k', 'item', { ...KEY, handlers: nudged('key').handlers }),
    ]);
    const out = runVerb(w, 'i-s', 'sweep');
    expect(out.narration).toEqual(['counted', 'a', 'b', 'key', 'held', 'key']);
  });

  it('a handler may run twice by two routes — there is no cycle rule', () => {
    const echo = sprout(`object echo {
      shout { broadcast :ping }
      on :ping { say "echo hears ping" }
      on :pong { say "echo hears pong" }
    }`);
    const wall = sprout(`object wall { on :ping (from) { send from :pong  broadcast :pong } }`);
    const w = world(object('r', 'room', CELLAR), [
      object('i-echo', 'item', echo),
      object('i-wall', 'item', wall),
    ]);
    const out = runVerb(w, 'i-echo', 'shout');
    expect(out.fault).toBeNull();
    expect(out.narration).toEqual(['echo hears pong', 'echo hears pong']);
  });

  it('two objects answering each other run past the depth cap and fault, with the chain kept', () => {
    const ping = sprout(`object ping { start { send pong :ping } on :pong { send pong :ping } }`);
    const pong = sprout(`object pong { on :ping { send ping :pong } }`);
    const w = world(object('r', 'room', CELLAR), [
      object('i-ping', 'item', ping),
      object('i-pong', 'item', pong),
    ]);
    const out = runVerb(w, 'i-ping', 'start');
    expect(out.ok).toBe(true);
    expect(out.fault?.message).toContain(`deeper than ${UNDERSTORY_CASCADE_DEPTH}`);
    expect(out.maxDepth).toBe(UNDERSTORY_CASCADE_DEPTH + 1);
    expect(out.fault?.chain).toHaveLength(UNDERSTORY_FAULT_CHAIN);
    expect(out.fault?.chain.at(-1)).toMatchObject({ depth: UNDERSTORY_CASCADE_DEPTH + 1 });
    expect(out.fault?.chain.every((e) => e.instigator === 1)).toBe(true);
    expect(['i-ping', 'i-pong']).toContain(out.fault?.objectId);
  });

  it('a fan-out runs past the event budget and faults before it runs deep', () => {
    const tree = sprout(`object tree {
      start { send self :grow }
      on :grow { send self :grow send self :grow send self :grow }
    }`);
    const w = world(object('r', 'room', CELLAR), [object('i', 'item', tree)]);
    const out = runVerb(w, 'i', 'start');
    expect(out.fault?.message).toContain(`More than ${UNDERSTORY_EVENT_BUDGET} events`);
    expect(out.events).toBe(UNDERSTORY_EVENT_BUDGET + 1);
    expect(out.maxDepth).toBeLessThan(UNDERSTORY_CASCADE_DEPTH);
  });

  it('an extension statement records an effect (§3.5): show — self’s :image, a named media property, the room’s — or nothing when none', () => {
    const lamp = sprout(`use media
    object lamp {
      :image media "m-lamp"
      :blueprint media
      peek { show }
      plan { show self :blueprint }
      around { show room }
      hang { self.set(:blueprint, "m-plan")  show self :blueprint  show self :blueprint }
      describe { show  text "A lamp." }
    }`);
    const room = sprout(`use media\nroom r { :image media "m-room" }`);
    const w = world(object('r', 'room', room), [object('i', 'item', lamp)]);
    const shown = (ids: string[]) =>
      ids.map((mediaId) => ({ extension: 'media', kind: 'show', mediaId }));
    expect(runVerb(w, 'i', 'peek').effects).toEqual(shown(['m-lamp']));
    expect(runVerb(w, 'i', 'plan').effects).toEqual([]);
    expect(runVerb(w, 'i', 'around').effects).toEqual(shown(['m-room']));
    // Recorded twice, in order — the host decides whether one lightbox opens once; the state took the id.
    expect(runVerb(w, 'i', 'hang').effects).toEqual(shown(['m-plan', 'm-plan']));
    expect(w.items[0]!.state['blueprint']).toBe('m-plan');
    expect(describeWith(w.items[0]!, w)).toEqual({ prose: 'A lamp.', effects: shown(['m-lamp']) });
    expect(runVerb(w, 'i', 'peek').fault).toBeNull();
  });

  it('an extension’s run sees a frozen frame, and a throw in it is a fault naming the extension', () => {
    const lamp = sprout(`use media\nobject lamp { :image media "m-lamp" peek { show } }`);
    const w = world(object('r', 'room', CELLAR), [object('i', 'item', lamp)]);
    const original = MEDIA.statement('show')!.spec.run;
    MEDIA.statement('show')!.spec.run = (frame) => {
      (frame.self as { name: string }).name = 'x'; // frozen: throws in strict mode
      return undefined;
    };
    try {
      const out = runVerb(w, 'i', 'peek');
      expect(out.fault?.message).toContain('The "media" extension failed on "show"');
    } finally {
      MEDIA.statement('show')!.spec.run = original;
    }
  });

  it('a send to the actor is delivered to nothing that answers; a name nothing has is ignored', () => {
    const def = sprout(`object o { poke { send actor :hi send nobody :hi say "fine" } }`);
    const w = world(object('r', 'room', CELLAR), [object('i', 'item', def)]);
    const out = runVerb(w, 'i', 'poke');
    expect(out.narration).toEqual(['fine']);
    expect(out.events).toBe(1);
    expect(out.fault).toBeNull();
  });
});

// --- containers and the containment protocol (#340) -----------------------------------

const CHEST = sprout(`object chest: Container {
  :open false
  on :noisy (from) {
    if (!self.get(:open)) { self.set(:open, true) say "Something inside the chest thumps, and the lid jumps its catch." }
  }
  on :illuminating { say "chest hears light" }
}`);

const GLASS_CASE = sprout(`object glass_case: Container {
  :open false
  pass :illuminating (true)
  pass any (self.get(:open))
}`);

const LISTENER = (name: string) =>
  sprout(`object ${name} {
    on :illuminating (from, value) { say "${name} sees light" }
    on :noisy { say "${name} hears noise" }
  }`);

const BELL = sprout(`object bell { ring { broadcast :noisy } }`);
const LAMP = sprout(`object lamp {
  :lit false
  light { self.set(:lit, true) }
  changed :lit (value) { broadcast :illuminating(value) }
}`);

describe('containers as the bus (§2.5)', () => {
  it('a broadcast reaches the room, the items in it, the hands, and into open containers — not into shut ones', () => {
    const w = world(object('r', 'room', CELLAR), [
      object('i-lamp', 'item', LAMP),
      object('i-chest', 'item', CHEST),
      object('i-in-chest', 'item', LISTENER('coin'), {}, {}, false, 'i-chest'),
      object('i-case', 'item', GLASS_CASE),
      object('i-in-case', 'item', LISTENER('jewel'), {}, {}, false, 'i-case'),
      object('i-held', 'item', LISTENER('held'), {}, {}, true),
      object('i-floor', 'item', LISTENER('floor')),
    ]);
    const out = runVerb(w, 'i-lamp', 'light');
    expect(out.fault).toBeNull();
    // the room hears it (sets :illuminated), then what it holds in id order, depth first: glass
    // passes light to the jewel; the chest is shut and hears it itself but keeps it from the coin;
    // the floor; then the hands, which pass everything, so the held thing sees it too
    expect(w.room.state['illuminated']).toBe(true);
    expect(out.narration).toEqual([
      'jewel sees light',
      'chest hears light',
      'floor sees light',
      'held sees light',
    ]);
  });

  it('a container relays outward only while it passes: a noise inside a shut chest stays inside — unless the chest opens', () => {
    const w = world(object('r', 'room', CELLAR), [
      object('i-chest', 'item', CHEST),
      object('i-bell', 'item', BELL, {}, {}, false, 'i-chest'),
      object('i-floor', 'item', LISTENER('floor')),
    ]);
    const out = runVerb(w, 'i-bell', 'ring');
    // the chest hears the noise (it is the bell's container), opens, and says so; the room did not hear it
    expect(out.narration).toEqual([
      'Something inside the chest thumps, and the lid jumps its catch.',
    ]);
    expect(w.items[0]!.state['open']).toBe(true);
    // rung again, the open chest passes it on to the room and the floor
    const again = runVerb(w, 'i-bell', 'ring');
    expect(again.narration).toEqual(['floor hears noise']);
  });

  it('a room broadcast reaches the hands; the hands pass what they hold back out', () => {
    const w = world(object('r', 'room', CELLAR), [
      object('i-lamp', 'item', LAMP, {}, {}, true),
      object('i-floor', 'item', LISTENER('floor')),
    ]);
    runVerb(w, 'i-lamp', 'light');
    expect(w.room.state['illuminated']).toBe(true);
    expect(runVerb(w, 'i-lamp', 'light').events).toBe(0);
  });

  it('`room` resolves through nesting; `container` is what holds self; `each`/`count` walk direct contents', () => {
    const probe = sprout(`object probe {
      poke {
        if (room.get(:illuminated)) { say "room lit" }
        if (container.is(Container)) { say "in a container" }
        if (container.count == 2) { say "two here" }
        each thing in room { send thing :hi }
      }
    }`);
    const w = world(object('r', 'room', CELLAR, { illuminated: true }), [
      object('i-chest', 'item', CHEST, { open: true }),
      object('i-probe', 'item', probe, {}, {}, false, 'i-chest'),
      object('i-other', 'item', LISTENER('other'), {}, {}, false, 'i-chest'),
      object('i-floor', 'item', sprout(`object floor { on :hi { say "floor hi" } }`)),
    ]);
    const out = runVerb(w, 'i-probe', 'poke');
    expect(out.narration).toEqual(['room lit', 'in a container', 'two here', 'floor hi']);
  });

  it('visible items: the room’s, and what open containers hold, not what shut ones hold', () => {
    const w = world(object('r', 'room', CELLAR), [
      object('i-chest', 'item', CHEST),
      object('i-coin', 'item', LISTENER('coin'), {}, {}, false, 'i-chest'),
      object('i-case', 'item', GLASS_CASE, { open: true }),
      object('i-jewel', 'item', LISTENER('jewel'), {}, {}, false, 'i-case'),
      object('i-held', 'item', LISTENER('held'), {}, {}, true),
    ]);
    expect(visibleItems(w, w.room).map((i) => i.id)).toEqual(['i-case', 'i-jewel', 'i-chest']);
    expect(visibleItems(w, w.actor).map((i) => i.id)).toEqual(['i-held']);
  });
});

describe('the containment protocol (§2.6)', () => {
  const key = () => object('i-key', 'item', sprout(`object key { :takeable true }`));
  const rock = () => object('i-rock', 'item', sprout(`object rock { :names ["rock"] }`));

  it('take: the thing must be takeable; the hands accept up to their capacity', () => {
    const w = world(object('r', 'room', CELLAR), [key(), rock()]);
    const taken = runMove(w, 'i-key', ACTOR);
    expect(taken.ok).toBe(true);
    expect(taken.refused).toBeNull();
    expect(taken.moved).toEqual(new Map([['i-key', ACTOR]]));
    expect(w.items[0]!.container).toBe(ACTOR);
    const notTakeable = runMove(w, 'i-rock', ACTOR);
    expect(notTakeable.refused).toBe('That is not something you can carry.');
    expect(notTakeable.narration).toEqual(['That is not something you can carry.']);
    expect(w.items[1]!.container).toBe('r');
    // eight in hand already: the ninth is refused
    const full = world(object('r', 'room', CELLAR), [
      key(),
      ...Array.from({ length: 8 }, (_, n) => object(`i-h${n}`, 'item', KEY, {}, {}, true)),
    ]);
    expect(runMove(full, 'i-key', ACTOR).refused).toBe('There is no room in you.');
  });

  it('a shut container neither releases nor accepts; open, it does both, and the notices are sent', () => {
    const chest = sprout(`object chest: Container {
      :open false
      on :entered (item, from) { say "in goes something" }
      on :left (item, to) { say "out comes something" }
    }`);
    const w = world(object('r', 'room', CELLAR), [
      object('i-chest', 'item', chest),
      key(),
      object('i-coin', 'item', key().definition, {}, {}, false, 'i-chest'),
    ]);
    expect(runMove(w, 'i-key', 'i-chest').refused).toBe('Chest is shut.');
    expect(runMove(w, 'i-coin', ACTOR).refused).toBe('Chest is shut.');
    w.items[0]!.state['open'] = true;
    const put = runMove(w, 'i-key', 'i-chest');
    expect(put.refused).toBeNull();
    expect(put.narration).toEqual(['in goes something']);
    const took = runMove(w, 'i-coin', ACTOR);
    expect(took.narration).toEqual(['out comes something']);
    expect(w.items[2]!.container).toBe(ACTOR);
  });

  it('the guards are the builder’s: a locked cupboard refuses the actor with its own words, a lump refuses dry hands', () => {
    const cupboard = sprout(`room cupboard {
      :locked true
      accept (item, from) {
        if (item.is(Actor) && self.get(:locked)) { refuse "The cupboard door is locked. There is a keyhole." }
        else { allow }
      }
      on :entered (item, from) { if (item.is(Actor)) { say "The smell of raw glaze." } }
    }`);
    const lump = sprout(`object lump {
      :takeable true
      :remembers [hands_wet: false]
      depart (to) {
        if (to.is(Actor) && actor.recall(:hands_wet) == false) { refuse "It would stick to dry hands. Wet them first." }
        else { allow }
      }
    }`);
    const shed = object('r-shed', 'room', CELLAR);
    const w = world(
      shed,
      [object('i-lump', 'item', lump)],
      [object('r-cupboard', 'room', cupboard)],
    );
    const locked = runMove(w, ACTOR, 'r-cupboard');
    expect(locked.refused).toBe('The cupboard door is locked. There is a keyhole.');
    w.elsewhere![0]!.state['locked'] = false;
    const went = runMove(w, ACTOR, 'r-cupboard');
    expect(went.refused).toBeNull();
    expect(went.narration).toEqual(['The smell of raw glaze.']);
    expect(went.moved).toEqual(new Map([[ACTOR, 'r-cupboard']]));
    const dry = runMove(w, 'i-lump', ACTOR);
    expect(dry.refused).toBe('It would stick to dry hands. Wet them first.');
    w.items[0]!.visitor['hands_wet'] = true;
    expect(runMove(w, 'i-lump', ACTOR).refused).toBeNull();
  });

  it('a guard that writes is refused by the compiler; the engine never reaches one — and a refused move leaves the world as it was', () => {
    const w = world(object('r', 'room', CELLAR), [rock()]);
    const before = JSON.stringify(w.items);
    runMove(w, 'i-rock', ACTOR);
    expect(JSON.stringify(w.items)).toBe(before);
  });

  it('nothing goes into itself, into a non-container, or into what it holds; a room is not moved', () => {
    const w = world(object('r', 'room', CELLAR), [
      object('i-chest', 'item', CHEST, { open: true }),
      object('i-box', 'item', GLASS_CASE, { open: true }, {}, false, 'i-chest'),
      key(),
    ]);
    expect(runMove(w, 'i-chest', 'i-chest').refused).toBe('It cannot go inside itself.');
    expect(runMove(w, 'i-chest', 'i-box').refused).toBe('It cannot go inside itself.');
    expect(runMove(w, 'i-chest', 'i-key').refused).toBe('Nothing goes in there.');
    expect(runMove(w, 'r', 'i-chest').refused).toBe('It cannot go inside itself.');
    expect(runMove(w, 'i-nobody', 'i-chest').ok).toBe(false);
  });

  it('`move` in a verb body is the same proposal, and a refusal is spoken there too', () => {
    const magnet = sprout(`object magnet {
      pull (what: object) { move what to self  say "click" }
    }`);
    const tray = sprout(`object tray: Container { :open true }`);
    const w = world(object('r', 'room', CELLAR), [
      object('i-magnet', 'item', magnet),
      object('i-tray', 'item', tray),
      key(),
    ]);
    const notContainer = runVerb(w, 'i-magnet', 'pull', { what: 'i-key' });
    expect(notContainer.narration).toEqual(['Nothing goes in there.', 'click']);
    const trayPull = sprout(
      `object tray: Container { :open true  pull (what: object) { move what to self } }`,
    );
    const w2 = world(object('r', 'room', CELLAR), [object('i-tray', 'item', trayPull), key()]);
    const out = runVerb(w2, 'i-tray', 'pull', { what: 'i-key' });
    expect(out.moved).toEqual(new Map([['i-key', 'i-tray']]));
    expect(w2.items[1]!.container).toBe('i-tray');
  });
});

// --- kinds, spawn and destroy (#341) -------------------------------------------------

describe('kinds and instances (§2.8)', () => {
  const KINDS = kindsOf(
    `kind Usable { :takeable true  use (with: object) abstract }`,
    `kind Lump: Usable {
      :names ["lump", "clay"]
      :wet true
      use (with: object) { say "squish" }
      on :spawned (from) { say "A lump, cold and heavy." }
      describe { text "A grapefruit of clay." }
    }`,
    `kind Crate: Container { :open true }`,
  );
  const BAG = sprout(`object bag {
    :lumps 2
    cut when (self.get(:lumps) > 0) { self.adjust(:lumps, -1)  spawn Lump in actor }
    fill { spawn Crate in room  spawn Lump in crate }
    ghost { spawn Ghost in room }
    tool { spawn Usable in room }
    stuff { spawn Lump in self }
  }`);

  it('spawn makes an instance of a published kind at its defaults, in the target, and tells it so', () => {
    const w = world(object('r', 'room', CELLAR), [object('i-bag', 'item', BAG)], undefined, KINDS);
    const out = runVerb(w, 'i-bag', 'cut');
    expect(out.fault).toBeNull();
    expect(out.narration).toEqual(['A lump, cold and heavy.']);
    expect(out.spawned).toHaveLength(1);
    const lump = out.spawned[0]!;
    expect(lump).toMatchObject({
      id: 'made-1',
      kind: 'item',
      container: ACTOR,
      home: 'r',
      spawnedFrom: 'Lump',
      kinds: ['Lump', 'Usable'],
    });
    expect(lump.state).toEqual({ takeable: true, wet: true });
    expect(w.items).toContain(lump);
    expect(renderProse(lump, w)).toBe('A grapefruit of clay.');
    expect(openVerbs(lump, w)).toEqual(['Use']);
    // the new thing is in the world: it can be moved, and `is` knows it
    expect(runMove(w, 'made-1', 'r').refused).toBeNull();
  });

  it('spawns into a spawned container by name, and refuses what cannot hold', () => {
    const w = world(object('r', 'room', CELLAR), [object('i-bag', 'item', BAG)], undefined, KINDS);
    const out = runVerb(w, 'i-bag', 'fill');
    expect(out.fault).toBeNull();
    expect(out.spawned.map((o) => [o.spawnedFrom, o.container])).toEqual([
      ['Crate', 'r'],
      ['Lump', 'made-1'],
    ]);
    const bad = world(
      object('r', 'room', CELLAR),
      [object('i-bag', 'item', BAG)],
      undefined,
      KINDS,
    );
    expect(runVerb(bad, 'i-bag', 'stuff').fault?.message).toBe('Bag cannot hold a new Lump.');
  });

  it('an unknown or abstract kind is a fault', () => {
    const w = world(object('r', 'room', CELLAR), [object('i-bag', 'item', BAG)], undefined, KINDS);
    expect(runVerb(w, 'i-bag', 'ghost').fault?.message).toBe(
      'No kind called "Ghost" is published here.',
    );
    expect(runVerb(w, 'i-bag', 'tool').fault?.message).toContain('"Usable" is abstract (use)');
  });

  it('the caps: spawns per action, and live instances per zone', () => {
    const greedy = sprout(`object greedy { grab { ${'spawn Lump in room  '.repeat(9)} } }`);
    const w = world(object('r', 'room', CELLAR), [object('i-g', 'item', greedy)], undefined, KINDS);
    expect(runVerb(w, 'i-g', 'grab').fault?.message).toContain(
      `More than ${UNDERSTORY_SPAWNS_PER_ACTION} things made`,
    );
    const full = world(
      object('r', 'room', CELLAR),
      [object('i-bag', 'item', BAG)],
      undefined,
      KINDS,
    );
    full.instanceCount = UNDERSTORY_MAX_INSTANCES;
    expect(runVerb(full, 'i-bag', 'cut').fault?.message).toContain('sweep it before making more');
  });

  // A describe the compiler would refuse today (§2.12, #441), built as
  // an AST the way a definition saved before the rule would sit in a row.
  const lookingSpawns = (): SproutDefinition2 => ({
    ...sprout(`object shelf { :dusty false prose "A shelf." }`),
    describe: [
      { kind: 'text', text: 'A shelf.' },
      { kind: 'spawn', kindName: 'Lump', in: { kind: 'room' } },
      { kind: 'set', property: 'dusty', value: { kind: 'literal', value: true } },
      { kind: 'broadcast', message: 'looked', value: null },
      { kind: 'move', what: { kind: 'self' }, to: { kind: 'actor' } },
      { kind: 'if', cond: { kind: 'literal', value: true }, then: [{ kind: 'destroy' }], else: [] },
      { kind: 'text', text: 'Nothing on it.' },
    ],
  });

  it('§2.12 (#441): a describe that writes or sends is neutralised at runtime — the text prints, the world and the budget do not move', () => {
    const w = world(
      object('r', 'room', CELLAR),
      [object('i-shelf', 'item', lookingSpawns())],
      undefined,
      KINDS,
    );
    const shelf = w.items[0]!;
    expect(describeWith(shelf, w)).toEqual({ prose: 'A shelf.\n\nNothing on it.', effects: [] });
    expect(w.items.map((i) => i.id)).toEqual(['i-shelf']); // no spawn, no destroy
    expect(shelf.state).toEqual({ dusty: false }); // no set
    expect(shelf.container).toBe('r'); // no move
    expect(w.budget).toMatchObject({ events: 0, spawns: 0, made: 0 }); // no broadcast, nothing queued
  });

  it('#441: the budget is the request’s — describing forty items draws nothing from it, and two actions in one request share it', () => {
    const shelves = Array.from({ length: 40 }, (_, i) =>
      object(`i-shelf-${String(i).padStart(2, '0')}`, 'item', lookingSpawns()),
    );
    const w = world(
      object('r', 'room', CELLAR),
      [...shelves, object('i-bag', 'item', BAG)],
      undefined,
      KINDS,
    );
    for (const shelf of w.items.slice(0, 40)) {
      expect(describeWith(shelf, w).prose).toBe('A shelf.\n\nNothing on it.');
      expect(openVerbs(shelf, w)).toEqual([]);
    }
    expect(w.items).toHaveLength(41);
    expect(w.budget).toMatchObject({ events: 0, spawns: 0, made: 0 });
    // One budget across the runners of a request: five births, then five more, is nine past eight.
    const five = sprout(`object five { pour { ${'spawn Lump in room  '.repeat(5)} } }`);
    const shared = world(
      object('r', 'room', CELLAR),
      [object('i-5', 'item', five)],
      undefined,
      KINDS,
    );
    const first = runVerb(shared, 'i-5', 'pour');
    expect(first.fault).toBeNull();
    expect(first.spawned).toHaveLength(5);
    expect(first.events).toBe(5); // this action's own count, for its record
    const second = runVerb(shared, 'i-5', 'pour');
    expect(second.fault?.message).toContain(
      `More than ${UNDERSTORY_SPAWNS_PER_ACTION} things made`,
    );
    expect(second.events).toBe(3); // the three it managed before the ninth birth, not the request's eight
    expect(shared.budget?.spawns).toBe(9);
    // The zone cap counts what earlier runners of the request made and still holds.
    const nearly = world(
      object('r', 'room', CELLAR),
      [object('i-bag', 'item', BAG)],
      undefined,
      KINDS,
    );
    nearly.instanceCount = UNDERSTORY_MAX_INSTANCES - 1;
    expect(runVerb(nearly, 'i-bag', 'cut').fault).toBeNull();
    expect(runVerb(nearly, 'i-bag', 'cut').fault?.message).toContain('sweep it before making more');
  });

  it('destroy takes an item out; what it held falls to its container; later events to it are nothing', () => {
    const crumb = sprout(`object crumb: Container {
      eat { say "gone"  destroy self  say "never said" }
      on :poke { say "still here?" }
    }`);
    const w = world(object('r', 'room', CELLAR), [
      object('i-crumb', 'item', crumb),
      object('i-inside', 'item', KEY, {}, {}, false, 'i-crumb'),
      object('i-poker', 'item', sprout(`object poker { poke { send crumb :poke } }`)),
    ]);
    const out = runVerb(w, 'i-crumb', 'eat');
    expect(out.narration).toEqual(['gone']);
    expect(out.destroyed).toEqual(new Set(['i-crumb']));
    expect(w.items.map((i) => i.id)).toEqual(['i-inside', 'i-poker']);
    expect(w.items[0]!.container).toBe('r');
    expect(out.moved).toEqual(new Map([['i-inside', 'r']]));
    expect(runVerb(w, 'i-poker', 'poke').narration).toEqual([]);
  });

  it('a thing spawned and destroyed in one action leaves no trace; a room cannot be destroyed', () => {
    const KINDS2 = kindsOf(`kind Spark { on :spawned { destroy self } }`);
    const striker = sprout(`object striker { strike { spawn Spark in room } }`);
    const w = world(
      object('r', 'room', CELLAR),
      [object('i-s', 'item', striker)],
      undefined,
      KINDS2,
    );
    const out = runVerb(w, 'i-s', 'strike');
    expect(out.spawned).toEqual([]);
    expect(out.destroyed.size).toBe(0);
    expect(w.items.map((i) => i.id)).toEqual(['i-s']);
    const room = sprout(`room r { collapse { destroy self } }`);
    const w2 = world(object('r', 'room', room), []);
    expect(runVerb(w2, 'r', 'collapse').fault?.message).toBe('R cannot be destroyed.');
  });

  it('a placed item of a kind runs the kind, folded: is(Kind) walks the chain', () => {
    const byName = new Map(
      [...KINDS].map(([name, k]) => [
        name,
        compileSproutKind(k.definition.source ?? '').definition!,
      ]),
    );
    void byName;
    const lumpKind = compileSproutKind(
      `kind Lump: Usable { :wet true  use (with: object) { say "squish" } }`,
    ).definition!;
    const usable = compileSproutKind(
      `kind Usable { :takeable true  use (with: object) abstract }`,
    ).definition!;
    const kinds = new Map([
      ['Usable', usable],
      ['Lump', lumpKind],
    ]);
    const placed = sprout(`object my_lump: Lump { :wet false }`);
    const resolved = resolveDefinition(placed, kinds);
    const obj: SproutObject = {
      ...object('i-lump', 'item', resolved.definition),
      kinds: resolved.kinds,
    };
    const probe = sprout(
      `object probe { check (what: object) { if (what.is(Lump) && what.is(Usable) && !what.is(Container)) { say "a lump" } } }`,
    );
    const w = world(object('r', 'room', CELLAR), [obj, object('i-probe', 'item', probe)]);
    expect(obj.state).toEqual({ wet: false, takeable: true });
    expect(runVerb(w, 'i-probe', 'check', { what: 'i-lump' }).narration).toEqual(['a lump']);
    expect(runVerb(w, 'i-lump', 'use', { with: 'i-probe' }).narration).toEqual(['squish']);
  });
});
