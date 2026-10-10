// The goldens the C statements replay (`corpus/goldens/exec.json`, with the
// cartridge they read, `exec.sproutworld`): a bench world whose handlers and
// plays hold every body below, run here by `body.ts` and drained by `bus.ts`
// over states the spec builds, with what each case ends in: the state it
// commits or the fault it dies with, the effects recorded, the steps spent,
// the handlers that ran, the descriptions owed, and the readings an `act`
// left for the reading pass. A case names its body by its text; the block the
// cartridge holds for it is found by its structure, and must be unique.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { Bundle } from '../bundle/bundle.js';
import { readGraph, type Graph } from '../bundle/cartridge-graph.js';
import { emitCartridge, readCartridge } from '../bundle/cartridge.js';
import { DEFAULT_LIMITS, type RuntimeBudgets, type StaticCaps } from '../bundle/limits.js';
import type { NameTable } from '../check/names.js';
import { MEDIA } from '../fixtures/extensions.js';
import { compiledWorld } from '../fixtures/bundle.js';
import { read } from '../fixtures/parse.js';
import { Budget, BudgetExhausted } from './budget.js';
import { drain } from './bus.js';
import { loadCartridge } from './cartridge.js';
import { Draft } from './draft.js';
import { Draws } from './draws.js';
import { STOCK_LINES } from './engine-lines.js';
import { boundObject, type Evaluated, type Frame } from './evaluate.js';
import { declaredId, visitKey, type InstanceId } from './ids.js';
import { spawnInstance, type LifecycleContext } from './lifecycle.js';
import { SproutList } from './lists.js';
import { initialState, loadWorld, saveWorld } from './load.js';
import { owedAfter, owedBy, type Owed } from './move.js';
import { passRules } from './passes.js';
import { liveTree } from './live.js';
import { rangeOf } from './range.js';
import { actingSink, turnState, type Said } from './reading.js';
import { runBody, type Speech } from './body.js';
import { newInstance, type PendingWake } from './state.js';

const CAPS = DEFAULT_LIMITS.caps;
const LIBRARY = 'exec_bench';
const GOLDEN = fileURLToPath(new URL('../../../../corpus/goldens/exec.json', import.meta.url));
const CARTRIDGE = fileURLToPath(
  new URL('../../../../corpus/goldens/exec.sproutworld', import.meta.url),
);

/** The instant every turn runs at, in host seconds. */
const INSTANT = 1000;

/** The names a case gives an object a state builder made. */
type Named = 'visitor' | 'ines' | 'pat' | 'spark' | 'bubble' | 'crate' | 'lid';

/** Who an object a case names is: a path in the tree, or one the state builder made. */
type Who = readonly string[] | Named;

type StateName = 'fresh' | 'worn' | 'closed';

/** What one case asks: a body, run as `self` in a state, names bound, then the queue drained. */
interface Case {
  readonly name: string;
  readonly area: string;
  /** The body's statements, written as the handler's or the play's. */
  readonly body: string;
  /** The kind whose handler `:c<n>` holds the body; `Runner` unless given. */
  readonly kind?: string;
  /** Written as the `do` of a play of the kind, where `actor` and `here` are bound. */
  readonly play?: true;
  /** The object whose body this is; the runner unless given. */
  readonly self?: Who;
  /** Names bound in the frame: the handler's `who`, or a play's `actor`. */
  readonly bind?: Readonly<Record<string, Who>>;
  readonly state?: StateName;
  readonly seed?: number;
  readonly budgets?: Partial<RuntimeBudgets>;
  readonly caps?: Partial<StaticCaps>;
  /** Who reads what the body says, and from whom it is heard. */
  readonly heard?: readonly Who[];
  readonly speaker?: Who;
  readonly leftOut?: readonly Who[];
  readonly records?: 'as-said' | 'as-told';
  /** Rewrites the bundle's nodes before the cartridge is made, for a body the checker would refuse. */
  readonly patch?: (node: Record<string, unknown>) => void;
  /** The most instances the host will hold beyond those the state starts with; unbounded unless given. */
  readonly holds?: number;
  /** Compiled and located but not run: the C runtime's own specs run it where the oracle's pass is not yet built there. */
  readonly unrun?: true;
  /** A body run first in the same turn, so that what it destroyed is bound by the case's own. */
  readonly prior?: { readonly kind: string; readonly self: Who; readonly body: string };
}

const HALL = ['hall'];
const at = (...path: string[]): readonly string[] => ['hall', ...path];

/** Turns a call's receiver `self` into a name the frame binds, so a body writes through another object. */
function throughBystander(node: Record<string, unknown>): void {
  const args = node['arguments'];
  const receiver = node['receiver'] as Record<string, unknown> | undefined;
  if (
    node['kind'] === 'call' &&
    Array.isArray(args) &&
    (args[1] as Record<string, unknown> | undefined)?.['value'] === 7 &&
    receiver?.['kind'] === 'binding'
  ) {
    (receiver['name'] as { text: string }).text = 'bystander';
  }
}

/** Turns the `tell` of a given line into a `text`, which only a `describe` may hold. */
function intoText(node: Record<string, unknown>): void {
  const said = node['said'] as Record<string, unknown> | undefined;
  if (node['kind'] === 'tell' && said?.['value'] === 'Text stands in.') node['kind'] = 'text';
}

const CASES: readonly Case[] = [
  // Writes to `self`.
  {
    name: 'a let is bound for the rest of the block',
    area: 'write',
    body: 'let n = self.get(:count) + 2\n self.set(:count, n)',
  },
  { name: 'set a string', area: 'write', body: 'self.set(:label, "sugar")' },
  { name: 'set an option', area: 'write', body: 'self.set(:glaze, :tenmoku)' },
  {
    name: 'adjust clamps at the top',
    area: 'write',
    body: 'self.adjust(:count, 5 + 5)',
    state: 'worn',
  },
  {
    name: 'adjust clamps at the bottom',
    area: 'write',
    body: 'self.adjust(:count, 0 - 9)',
    state: 'worn',
  },
  { name: 'add an element to a list', area: 'write', body: 'self.add(:wards, :tenmoku)' },
  { name: 'add an element the list holds', area: 'write', body: 'self.add(:wards, :shino)' },
  { name: 'remove an element from a list', area: 'write', body: 'self.remove(:wards, :shino)' },
  {
    name: 'remove an element the list lacks',
    area: 'write',
    body: 'self.remove(:wards, :tenmoku)',
  },
  {
    name: 'a new element in a full list faults',
    area: 'write',
    body: 'self.add(:wards, :none)',
    caps: { listElements: 1 },
  },
  {
    name: 'remember writes what self remembers about an actor',
    area: 'write',
    body: 'if (who.is(sprout.Actor)) { who.remember(:visits, 3) }',
    bind: { who: 'visitor' },
  },
  {
    name: 'adjust on memory steps from the default',
    area: 'write',
    body: 'if (who.is(sprout.Actor)) { who.adjust(:visits, 2) }',
    bind: { who: 'visitor' },
  },
  {
    name: 'adjust on memory steps from what was written',
    area: 'write',
    body: 'if (who.is(sprout.Actor)) { who.adjust(:visits, 3) }',
    bind: { who: 'visitor' },
    state: 'worn',
  },
  {
    name: 'a write that changes a watched property queues its hook',
    area: 'write',
    body: 'self.set(:count, 6)',
    state: 'worn',
  },
  {
    name: 'a write that changes nothing queues no hook',
    area: 'write',
    body: 'self.set(:count, 4)',
    state: 'worn',
  },
  {
    name: 'two changes queue two hooks, each with the value it replaced',
    area: 'write',
    body: 'self.set(:count, 1)\n self.set(:count, 2)',
  },
  {
    name: 'a value the property cannot hold faults',
    area: 'write',
    body: 'self.set(:count, self.get(:count) + 12)',
    state: 'worn',
  },
  {
    name: 'only self writes self',
    area: 'write',
    body: 'self.set(:count, 7)',
    bind: { bystander: at('shelf', 'jar') },
    patch: throughBystander,
  },
  {
    name: 'text reaches a body that acts',
    area: 'write',
    body: 'tell "Text stands in."',
    patch: intoText,
  },
  // Conditions.
  {
    name: 'an if takes its then',
    area: 'if',
    body: 'if (self.get(:count) == 0) { self.set(:label, "zero") } else { self.set(:label, "more") }',
  },
  {
    name: 'an if takes its else',
    area: 'if',
    body: 'if (self.get(:count) == 0) { self.set(:label, "none") } else { self.set(:label, "some") }',
    state: 'worn',
  },
  {
    name: 'an else if is a step of its own',
    area: 'if',
    body: 'if (self.get(:count) > 5) { self.set(:label, "big") } else if (self.get(:count) > 2) { self.set(:label, "mid") } else { self.set(:label, "low") }',
    state: 'worn',
  },
  {
    name: 'a let lives to the end of its block',
    area: 'if',
    body: 'let a = 1\n if (a == 1) { let b = a + 1\n self.set(:count, b) }',
  },
  {
    name: 'a condition that narrows a name binds it in its branch',
    area: 'if',
    body: 'if (shelf.is(Shelf)) { self.set(:count, shelf.count) }',
  },
  // Walking contents.
  {
    name: 'each visits what a container holds that composes the kind',
    area: 'each',
    body: 'each pot: Jar in shelf { self.adjust(:count, 1) }',
  },
  {
    name: 'each visits every thing without a filter',
    area: 'each',
    body: 'each thing in shelf { self.adjust(:count, 1) }',
  },
  {
    name: 'each walks a shut chest as empty',
    area: 'each',
    body: 'each thing in chest { self.adjust(:count, 2) }',
  },
  {
    name: 'each walks an open chest',
    area: 'each',
    body: 'each thing in chest { self.adjust(:count, 2) }',
    state: 'worn',
  },
  {
    name: 'an each inside an each is charged by the step',
    area: 'each',
    body: 'each a in shelf { each b in shelf { self.adjust(:count, 1) } }',
  },
  {
    name: 'an each past the step budget faults',
    area: 'each',
    body: 'each a in shelf { each b in shelf { self.adjust(:count, 3) } }',
    budgets: { steps: 40 },
  },
  {
    name: 'what an each walks is fixed before its first visit',
    area: 'each',
    body: 'each thing in shelf { move thing to basket }',
  },
  {
    name: 'a refused move in an each ends the body',
    area: 'each',
    body: 'each thing in shelf { move thing to gate\n self.adjust(:count, 1) }',
    heard: ['visitor'],
  },
  // Moving things.
  { name: 'a move that every party allows', area: 'move', body: 'move shelf.jar to basket' },
  {
    name: 'a move into a full place is refused by its accept, in its passage',
    area: 'move',
    body: 'move lamp to shelf',
    heard: ['visitor'],
  },
  {
    name: 'depart is asked before accept',
    area: 'move',
    body: 'move stubborn to shelf',
    heard: ['visitor'],
  },
  {
    name: 'release is asked before accept',
    area: 'move',
    body: 'move keeper.kept to shelf',
    heard: ['visitor'],
  },
  {
    name: 'release refuses alone',
    area: 'move',
    body: 'move keeper.kept to basket',
    heard: ['visitor'],
  },
  {
    name: 'an allow ends the guard that wrote it',
    area: 'move',
    body: 'move shelf.jar to gate',
    heard: ['visitor'],
  },
  {
    name: 'a guard that reaches its refuse refuses',
    area: 'move',
    body: 'move lamp to gate',
    heard: ['visitor'],
  },
  {
    name: 'a refused move ends the body',
    area: 'move',
    body: 'move lamp to shelf\n self.set(:label, "after")',
    heard: ['visitor'],
  },
  {
    name: 'nothing goes inside itself',
    area: 'move',
    body: 'move box to box.inner',
    heard: ['visitor'],
  },
  {
    name: 'a move into what holds nothing faults',
    area: 'move',
    body: 'move lamp to who',
    bind: { who: at('shelf', 'cup') },
  },
  {
    name: 'a move of what is out of range faults',
    area: 'move',
    body: 'move who to shelf',
    bind: { who: at('chest', 'bin') },
  },
  {
    name: 'a move into what is out of range faults',
    area: 'move',
    body: 'move lamp to who',
    bind: { who: at('chest', 'bin') },
  },
  {
    name: 'an actor moved between places is told, and the places tell their people',
    area: 'move',
    kind: 'Dog',
    self: at('dog'),
    body: 'move self to tent',
  },
  {
    name: 'a place speaks to the people in its range when someone arrives',
    area: 'move',
    kind: 'Dog',
    self: at('dog'),
    body: 'move self to lodge',
    state: 'worn',
  },
  {
    name: 'an actor is not put in what holds no actors',
    area: 'move',
    kind: 'Dog',
    self: at('dog'),
    body: 'move self to chest',
    heard: ['visitor'],
  },
  {
    name: 'a move into a full place meets crowded before any guard',
    area: 'move',
    kind: 'Dog',
    self: at('dog'),
    body: 'move who to lodge',
    bind: { who: 'visitor' },
    state: 'closed',
    budgets: { peoplePerPlace: 1 },
    heard: ['visitor'],
  },
  {
    name: 'without a crowd the same move meets the guards',
    area: 'move',
    kind: 'Dog',
    self: at('dog'),
    body: 'move who to lodge',
    bind: { who: 'visitor' },
    state: 'closed',
    heard: ['visitor'],
  },
  // Making and unmaking.
  {
    name: 'a spawn within the host’s bound on instances',
    area: 'spawn',
    body: 'spawn Crate in hall',
    holds: 2,
  },
  {
    name: 'a spawn past the host’s bound on instances faults',
    area: 'spawn',
    body: 'spawn Crate in hall',
    holds: 1,
  },
  {
    name: 'a binding to a destroyed object stays readable for the rest of the turn',
    area: 'destroy',
    body: 'if (who.is(Spark)) { self.set(:count, who.get(:n) + 3) }',
    bind: { who: 'spark' },
    prior: { kind: 'Spark', self: 'spark', body: 'self.set(:n, 4)\n destroy self' },
    state: 'worn',
  },
  {
    name: 'a destroyed object is not destroyed again',
    area: 'destroy',
    kind: 'Spark',
    self: 'spark',
    body: 'destroy self',
    prior: { kind: 'Spark', self: 'spark', body: 'destroy self' },
    state: 'worn',
  },
  {
    name: 'a destroyed object is out of range of a move',
    area: 'destroy',
    body: 'move who to basket',
    bind: { who: 'spark' },
    prior: { kind: 'Spark', self: 'spark', body: 'destroy self' },
    state: 'worn',
  },
  {
    name: 'a spawn into a destroyed container is out of range',
    area: 'destroy',
    body: 'spawn Jar in who',
    bind: { who: 'crate' },
    prior: { kind: 'Crate', self: 'crate', body: 'destroy self' },
    state: 'worn',
  },
  { name: 'a spawn makes an instance in a container', area: 'spawn', body: 'spawn Jar in hall' },
  {
    name: 'a let names the spawned object',
    area: 'spawn',
    body: 'let j = spawn Jar in shelf\n send j :ping',
  },
  {
    name: 'a spawn is given what its kind holds',
    area: 'spawn',
    body: 'spawn Crate in hall',
  },
  {
    name: 'a spawn past the budget faults',
    area: 'spawn',
    body: 'spawn Crate in hall\n spawn Jar in hall',
    budgets: { spawnsPerTurn: 2 },
  },
  {
    name: 'a spawn out of range faults',
    area: 'spawn',
    body: 'spawn Jar in who',
    bind: { who: at('chest', 'bin') },
  },
  {
    name: 'a spawn into what holds nothing faults',
    area: 'spawn',
    body: 'spawn Jar in who',
    bind: { who: at('shelf', 'cup') },
  },
  {
    name: 'destroy takes effect where the body ends',
    area: 'destroy',
    kind: 'Spark',
    self: 'spark',
    body: 'destroy self\n self.set(:n, 2)',
    state: 'worn',
  },
  {
    name: 'finally destroy waits until the queue is empty',
    area: 'destroy',
    kind: 'Spark',
    self: 'spark',
    body: 'send bell :pong\n finally destroy self',
    state: 'worn',
  },
  {
    name: 'a destroyed object takes what it sent with it',
    area: 'destroy',
    kind: 'Bubble',
    self: 'bubble',
    body: 'send bell :pong\n destroy self',
    state: 'worn',
  },
  {
    name: 'a destroyed container takes what it held',
    area: 'destroy',
    kind: 'Crate',
    self: 'crate',
    body: 'self.set(:n, 5)\n destroy self',
    state: 'worn',
  },
  {
    name: 'connect leads a link to a place',
    area: 'connect',
    kind: 'Cell',
    self: at('cell'),
    body: 'let c = spawn Cell in hall\n connect onward to c',
  },
  {
    name: 'connecting a link again replaces where it leads',
    area: 'connect',
    kind: 'Cell',
    self: at('cell'),
    body: 'let c = spawn Cell in hall\n connect onward to c\n let d = spawn Cell in hall\n connect onward to d',
  },
  {
    name: 'a link cannot lead to what holds no actors',
    area: 'connect',
    kind: 'Cell',
    self: at('cell'),
    body: 'each t in hall.shelf { connect onward to t }',
  },
  // Messages.
  {
    name: 'a send is delivered once the body has ended, and answered',
    area: 'send',
    body: 'send bell :ping',
  },
  {
    name: 'sends are delivered in the order queued, breadth-first',
    area: 'send',
    body: 'send bell :ping\n send lamp :ping',
  },
  {
    name: 'a send to what is out of range goes nowhere',
    area: 'send',
    body: 'send chest.coin :ping',
  },
  {
    name: 'a send to what is in range of an open chest is delivered',
    area: 'send',
    body: 'send chest.coin :ping',
    state: 'worn',
  },
  {
    name: 'a broadcast walks the sender’s range, into a container that passes the message',
    area: 'send',
    body: 'broadcast :ping',
  },
  {
    name: 'a broadcast reaches into an open chest',
    area: 'send',
    body: 'broadcast :ping',
    state: 'worn',
  },
  {
    name: 'an each stops at a container that refuses the question',
    area: 'each',
    body: 'each thing in glass { self.adjust(:count, 2) }',
  },
  {
    name: 'a cascade past the depth budget faults',
    area: 'bus',
    body: 'send bell :chain with 1',
  },
  {
    name: 'a cascade within a smaller depth budget faults at it',
    area: 'bus',
    body: 'send bell :chain with 2',
    budgets: { cascadeDepth: 5 },
  },
  {
    name: 'events past the budget fault',
    area: 'bus',
    body: 'send bell :chain with 3',
    budgets: { events: 4 },
  },
  {
    name: 'a hook and a handler each run in the order queued',
    area: 'bus',
    body: 'self.set(:count, 3)\n send bell :ping',
    state: 'worn',
  },
  // Time.
  { name: 'a wake is raised to the host’s shortest', area: 'wake', body: 'wake in 5 seconds' },
  { name: 'a wake asked for longer is kept', area: 'wake', body: 'wake in 3 hours' },
  {
    name: 'a wake past the pending cap faults',
    area: 'wake',
    body: 'wake in 2 minutes\n wake in 3 minutes',
  },
  {
    name: 'wakes are kept oldest first',
    area: 'wake',
    body: 'wake in 3 hours\n wake in 2 minutes',
    budgets: { pendingWakesPerObject: 2 },
  },
  {
    name: 'a host’s longer floor raises a wake further',
    area: 'wake',
    body: 'wake in 90 seconds',
    budgets: { shortestWakeSeconds: 120 },
  },
  {
    name: 'cancel wakes takes back every pending wake',
    area: 'wake',
    body: 'cancel wakes',
    state: 'worn',
  },
  {
    name: 'cancel wakes then wake puts off what was coming',
    area: 'wake',
    body: 'cancel wakes\n wake in 3 minutes',
    state: 'worn',
  },
  {
    name: 'cancel wakes with none pending does nothing',
    area: 'wake',
    body: 'cancel wakes\n cancel wakes',
  },
  // What is said.
  {
    name: 'a tell reaches the people in the teller’s place',
    area: 'speech',
    body: 'tell "Hello there."',
  },
  {
    name: 'a tell to one reaches a person in range',
    area: 'speech',
    body: 'tell who "For you."',
    bind: { who: 'visitor' },
  },
  {
    name: 'a tell to one out of range reaches nobody',
    area: 'speech',
    body: 'tell who "Not for you."',
    bind: { who: 'pat' },
    state: 'worn',
  },
  { name: 'a tell may name a passage', area: 'speech', body: 'tell named' },
  {
    name: 'a tell inside reaches only the teller’s own occupants',
    area: 'speech',
    kind: 'Wardrobe',
    self: at('wardrobe'),
    body: 'tell inside "Welcome in."',
    state: 'worn',
  },
  {
    name: 'a tell outside reaches only the place around the teller',
    area: 'speech',
    kind: 'Wardrobe',
    self: at('wardrobe'),
    body: 'tell outside "Muffled."',
    state: 'worn',
  },
  {
    name: 'a plain tell from a place that holds actors reaches both audiences',
    area: 'speech',
    kind: 'Wardrobe',
    self: at('wardrobe'),
    body: 'tell "A voice."',
    state: 'worn',
  },
  {
    name: 'a tell carries every name in scope',
    area: 'speech',
    body: 'let n = self.get(:count)\n tell "Count is {n}."',
  },
  {
    name: 'a say is heard by whoever the body speaks to',
    area: 'speech',
    play: true,
    body: 'say "You tap the runner."',
    bind: { actor: 'visitor', here: HALL },
    heard: ['visitor'],
  },
  {
    name: 'a say may name a passage',
    area: 'speech',
    play: true,
    body: 'say named',
    bind: { actor: 'visitor', here: HALL },
    heard: ['visitor'],
  },
  {
    name: 'a tell leaves out the people the reading addresses',
    area: 'speech',
    play: true,
    body: 'say "Aside."\n tell "Overheard."',
    bind: { actor: 'visitor', here: HALL },
    heard: ['visitor'],
    leftOut: ['visitor'],
  },
  {
    name: 'an NPC’s line is heard from it',
    area: 'speech',
    kind: 'Dog',
    self: at('dog'),
    play: true,
    body: 'say "Woof."',
    bind: { actor: 'visitor', here: HALL },
    heard: ['visitor'],
    speaker: at('dog'),
  },
  // An `act` runs a reading on the spot, and the reading pass is C07's: these bodies are
  // located for the C specs of the statement, and C07 adds the cases that run them.
  {
    name: 'an act names its roles by what they are bound to',
    area: 'act',
    kind: 'Dog',
    self: at('dog'),
    body: 'act sniff (target: lamp)',
    unrun: true,
  },
  // Extensions.
  {
    name: 'an extension’s statement records an effect for the people in the place',
    area: 'extension',
    body: 'media.play("purr.ogg")',
    records: 'as-told',
  },
  {
    name: 'recording past the host’s cap faults',
    area: 'extension',
    body: 'media.play("purr.ogg")',
    budgets: { extensionEffects: 0 },
    records: 'as-told',
  },
];

/** The objects a body names, written from the world so that a walk over one is known. */
const OBJECTS =
  /(?<![.:\w"])(hall|shelf|chest|glass|lamp|bell|basket|gate|stubborn|keeper|box|tent|lodge|wardrobe|cell|dog)\b(?![^"]*"[^"]*$)/g;

const indent = (body: string): string =>
  body
    .split('\n')
    .map(
      (line) =>
        `    ${line.trim().replace(OBJECTS, `${LIBRARY}.hall.$1`).replace(`${LIBRARY}.hall.hall`, `${LIBRARY}.hall`)}`,
    )
    .join('\n');

/** The bench world, with each case's body in the handler or the play it names. */
function sourceOf(cases: readonly Case[]): string {
  const members = (kind: string): string[] =>
    cases.flatMap((one, i) => {
      const first =
        one.prior?.kind === kind
          ? [`  on :q${i} (who, value) {\n${indent(one.prior.body)}\n  }`]
          : [];
      if ((one.kind ?? 'Runner') !== kind) return first;
      return [
        ...first,
        one.play === true
          ? `  as target for p${i} {\n    do {\n${indent(one.body)}\n    }\n  }`
          : `  on :c${i} (who, value) {\n${indent(one.body)}\n  }`,
      ];
    });
  const held = (kind: string, head: string): string =>
    `kind ${kind}${head} {\n${members(kind).join('\n')}\n}`;
  return [
    'extension media 2',
    `world ${LIBRARY} is sprout.World {`,
    '  visitors are Person',
    '  visitors arrive at hall',
    '  object hall is Hall {',
    '    object runner is Runner',
    '    object shelf is Shelf {',
    '      object jar is Jar',
    '      object cup is Cup',
    '    }',
    '    object chest is Chest {',
    '      object coin is Jar',
    '      object bin is Box',
    '    }',
    '    object glass is Glass { object moth is Moth }',
    '    object lamp is Lamp',
    '    object bell is Bell',
    '    object stubborn is Stubborn',
    '    object keeper is Keeper { object kept is Jar }',
    '    object basket is Basket',
    '    object gate is Gate',
    '    object box is Box { object inner is Box }',
    '    object tent is Tent',
    '    object lodge is Lodge',
    '    object wardrobe is Wardrobe',
    '    object cell is Cell',
    '    object dog is Dog',
    '  }',
    '}',
    'kind Person is sprout.Visitor { }',
    'enum Glaze { none, shino, tenmoku }',
    'message :ping',
    'message :pong',
    'message :chain with integer',
    ...cases.flatMap((one, i) => [
      ...(one.play === true ? [] : [`message :c${i} with integer`]),
      ...(one.prior === undefined ? [] : [`message :q${i} with integer`]),
    ]),
    'verb sniff { role target  "sniff [target]" }',
    `kind Sender {\n  on :ping (who) {\n${cases.flatMap((one, i) => (one.play === true ? [] : [`    broadcast :c${i} with 1`]).concat(one.prior === undefined ? [] : [`    broadcast :q${i} with 1`])).join('\n')}\n  }\n}`,
    ...cases.flatMap((one, i) =>
      one.play === true ? [`verb p${i} { role target  "p${i} [target]" }`] : [],
    ),
    'kind Hall is sprout.Place {',
    '  :arrivals 0 min 0 max 99',
    '  on :entered (item, from) { self.adjust(:arrivals, 1) }',
    '}',
    'kind Tent is sprout.Place { }',
    'kind Lodge is sprout.Place {',
    '  :closed false',
    '  accept (item, from) { if (self.get(:closed)) { refuse "Not tonight." } }',
    '}',
    held('Wardrobe', ' is sprout.Place').replace(
      '{\n',
      '{\n  :open false\n  pass any (self.get(:open))\n',
    ),
    held('Cell', ' is sprout.Place').replace('{\n', '{\n  grammar { link onward "on" }\n'),
    held('Runner', '').replace(
      '{\n',
      [
        '{',
        '  contains',
        '  :count 0 min 0 max 9',
        '  :trail 0 min 0 max 99',
        '  :pongs 0 min 0 max 99',
        '  :label string default "salt"',
        '  :glaze Glaze default shino',
        '  :wards [Glaze] default [shino]',
        '  remembers { :visits 0 min 0 max 9 }',
        '  changed :count (was) { self.adjust(:trail, 1) }',
        '  on :pong (from) { self.adjust(:pongs, 1) }',
        '  on :woke (elapsed) { self.adjust(:count, 1) }',
        '  passage named { Salt. }',
        '',
      ].join('\n'),
    ),
    held('Spark', '').replace('{\n', '{\n  :n 0 min 0 max 9\n'),
    held('Bubble', ''),
    held('Crate', '').replace('{\n', '{\n  contains\n  :n 0 min 0 max 9\n  object lid is Jar\n'),
    held('Dog', ' is sprout.Actor').replace(
      '{\n',
      '{\n  :sniffed 0 min 0 max 99\n  as actor for sniff { do { self.adjust(:sniffed, 1) } }\n',
    ),
    'kind Shelf {',
    '  contains',
    '  :capacity 2 min 0 max 9',
    '  :filled false',
    '  accept (item, from) { if (self.count >= self.get(:capacity)) { refuse full } }',
    '  passage full { No room on {self}. }',
    '  on :entered (item, from) { self.set(:filled, true) }',
    '  on :left (item, to) { self.set(:filled, false) }',
    '}',
    'kind Chest { contains  :open false  pass any (self.get(:open)) }',
    'kind Box { contains }',
    'kind Glass { contains  pass :ping (true)  pass any (false) }',
    'kind Moth { :drawn false  on :ping (from) { self.set(:drawn, true) } }',
    'kind Basket { contains  accept (item, from) { allow } }',
    'kind Gate { contains  accept (item, from) { if (item.is(Jar)) { allow }\n refuse "Jars only." } }',
    'kind Keeper { contains  release (item, to) { refuse "The keeper holds on." } }',
    'kind Stubborn { depart (to) { refuse "It will not budge." } }',
    'kind Lamp { :lit false  on :ping (from) { self.set(:lit, true) } }',
    'kind Bell {',
    '  :answers 0 min 0 max 99',
    '  :depth 0 min 0 max 99',
    '  on :ping (from) { self.adjust(:answers, 1)\n send from :pong }',
    '  on :pong (from) { self.adjust(:answers, 5) }',
    '  on :chain (_, n) { self.set(:depth, n)\n send self :chain with n + 1 }',
    '}',
    'kind Jar {',
    '  :fill 3 min 0 max 9',
    '  on :ping (from) { self.adjust(:fill, 1) }',
    '  on :spawned (from) { self.set(:fill, 4) }',
    '  on :moved (from, to) { self.adjust(:fill, 1) }',
    '}',
    'kind Cup { :fill 3 min 0 max 9 }',
    '',
  ].join('\n');
}

const SOURCE = sourceOf(CASES);
const bundle: Bundle = compiledWorld(
  LIBRARY,
  { [`${LIBRARY}.sprout`]: SOURCE },
  { pins: [{ name: 'media', major: 2 }], installed: [MEDIA] },
);

/** Every object a bundle's graph reaches, once, so a case may rewrite a node the checker would not have let through. */
function eachObject(root: unknown, visit: (node: Record<string, unknown>) => void): void {
  const seen = new Set<unknown>();
  const pending: unknown[] = [root];
  while (pending.length > 0) {
    const next = pending.pop();
    if (typeof next !== 'object' || next === null || seen.has(next)) continue;
    seen.add(next);
    if (next instanceof Map) {
      for (const [key, value] of next) pending.push(key, value);
    } else if (next instanceof Set || Array.isArray(next)) {
      for (const one of next) pending.push(one);
    } else {
      visit(next as Record<string, unknown>);
      for (const value of Object.values(next)) pending.push(value);
    }
  }
}

for (const one of CASES) if (one.patch !== undefined) eachObject(bundle, one.patch);

const bytes = emitCartridge(bundle);
const extensions = [MEDIA];
const catalogue = loadCartridge(bytes, { caps: CAPS, installed: extensions });

const cartridge = readCartridge(bytes);
const graph: Graph = readGraph({
  files: cartridge.table.files,
  prose: cartridge.prose.entries,
  bodies: cartridge.bodies.entries,
  rest: cartridge.table.entries,
});
const names = graph.read(cartridge.bodies.names) as NameTable;
const BODIES = { from: cartridge.prose.entries.length, count: cartridge.bodies.entries.length };

/** An AST node without its places, as a structure comparable across graphs. */
function shapeOf(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(shapeOf);
  if ('source' in value && 'start' in value) return undefined;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'span' && key !== 'at')
      .map(([key, one]) => [key, shapeOf(one)]),
  );
}

/** Every block of the cartridge's bodies that stands inside no other body entry. */
const BLOCKS: { index: number; block: Record<string, unknown> }[] = [];
const INSIDE = new Set<unknown>();
for (let index = BODIES.from; index < BODIES.from + BODIES.count; index++) {
  const entry = graph.read([index]) as Record<string, unknown>;
  for (const [key, one] of Object.entries(entry)) {
    if (key === 'span' || key === 'at') continue;
    for (const child of Array.isArray(one) ? one : [one]) INSIDE.add(child);
  }
  if (entry['kind'] === 'block') BLOCKS.push({ index, block: entry });
}

/** The blocks the source writes for the cases, in case order, read by the parser as the author wrote them. */
function writtenBlocks(): Map<string, unknown> {
  const parsed = read(SOURCE, `${LIBRARY}.sprout`);
  const found = new Map<string, unknown>();
  eachObject(parsed.declarations, (node) => {
    const message = node['message'] as { text?: string } | undefined;
    if (node['kind'] === 'handler' && /^[cq]\d+$/.test(message?.text ?? '')) {
      found.set(message!.text!.replace(/^c/, ''), node['body']);
    }
    const head = node['head'] as { verb?: { text?: string } } | undefined;
    const verb = head?.verb;
    if (node['kind'] === 'play' && /^p\d+$/.test(verb?.text ?? '') && node['do'] !== null) {
      found.set(verb!.text!.slice(1), node['do']);
    }
  });
  return found;
}

const WRITTEN = writtenBlocks();
// A rewritten body is found as it was rewritten.
CASES.forEach((one, i) => {
  if (one.patch !== undefined) eachObject(WRITTEN.get(String(i)), one.patch);
});

/** The entry of the cartridge's bodies that is case `i`'s body,  */
function blockOf(i: number | string): { index: number; block: Record<string, unknown> } {
  const written = WRITTEN.get(String(i));
  if (written === undefined) throw new Error(`case ${i} wrote no body`);
  const wanted = JSON.stringify(shapeOf(written));
  const found = BLOCKS.filter(
    ({ block }) => !INSIDE.has(block) && JSON.stringify(shapeOf(block)) === wanted,
  );
  // Cases written alike in different states share the first block that reads as they do.
  if (found.length === 0) throw new Error(`case ${i} is written nowhere`);
  return found[0]!;
}

const id = (...path: string[]): InstanceId => declaredId(LIBRARY, path);
const planned = (path: readonly string[]): InstanceId => id(...path);

/** What every state is built from: a hall with a visitor in it. */
interface Built {
  readonly stored: ReturnType<typeof saveWorld>;
  readonly named: Readonly<Record<Named, string>>;
}

/** A draft over a new world, a visitor in the hall, with budgets and passes that never run out. */
function opened(): { draft: Draft; context: LifecycleContext; visitor: InstanceId } {
  const draft = new Draft(initialState(catalogue));
  const budget = new Budget(DEFAULT_LIMITS.budgets);
  const passes = passRules({
    state: draft,
    kinds: catalogue.lookup,
    caps: CAPS,
    budget,
    names: catalogue.names,
  });
  const context: LifecycleContext = {
    draft,
    catalogue,
    passes,
    budget,
    draws: new Draws(1),
    mayHold: null,
    now: INSTANT,
  };
  const visitor = arrive(draft, 'visit-1', 'Marta', ['hall']);
  return { draft, context, visitor };
}

/** A visitor with a record, standing at `place`. */
function arrive(
  draft: Draft,
  visit: string,
  nickname: string,
  place: readonly string[],
): InstanceId {
  const instance = draft.mint();
  draft.add(
    newInstance(
      instance,
      { from: 'visitor' },
      catalogue.visitorKind!,
      planned(place),
      draft.nextSerial(),
      CAPS,
    ),
  );
  draft.putVisitor({
    visit: visitKey(visit),
    nickname,
    instance,
    lastPlace: planned(place),
    referents: [],
    lastReading: null,
  });
  return instance;
}

/** The three states the cases run in, as a store keeps them. */
function states(): Record<StateName, Built> {
  const none = {} as Record<Named, string>;
  const fresh = opened();
  const freshState = fresh.draft.commit().state;
  const built = (closed: boolean): Built => {
    const { draft, context, visitor } = opened();
    const write = (path: readonly string[], values: Record<string, unknown>): void => {
      const held = draft.instance(planned(path))!;
      draft.write({
        ...held,
        properties: new Map([...held.properties, ...Object.entries(values)]) as never,
      });
    };
    write(['hall', 'chest'], { open: true });
    write(['hall', 'lodge'], { closed });
    const runner = draft.instance(id('hall', 'runner'))!;
    const wake: PendingWake = { serial: draft.nextSerial(), askedAt: 500, dueAt: 800 };
    draft.write({
      ...runner,
      properties: new Map([...runner.properties, ['count', 4]]),
      memory: new Map([[visitor, new Map([['visits', 5]])]]),
      wakes: [wake],
    });
    const ines = arrive(draft, 'visit-2', 'Ines', ['hall', 'lodge']);
    const pat = arrive(draft, 'visit-3', 'Pat', ['hall', 'wardrobe']);
    const hall = id('hall');
    const spark = spawnInstance(context, id('hall', 'runner'), `${LIBRARY}.Spark`, hall);
    const bubble = spawnInstance(context, id('hall', 'runner'), `${LIBRARY}.Bubble`, hall);
    const crate = spawnInstance(context, id('hall', 'runner'), `${LIBRARY}.Crate`, hall);
    return {
      stored: saveWorld(draft.commit().state),
      named: {
        visitor,
        ines,
        pat,
        spark: spark.id,
        bubble: bubble.id,
        crate: crate.id,
        lid: crate.contents[0]!,
      },
    };
  };
  return {
    fresh: { stored: saveWorld(freshState), named: { ...none, visitor: fresh.visitor } as never },
    worn: built(false),
    closed: built(true),
  };
}

/** The tables of a case's catalogue: the host's caps are the case's own. */
function catalogueFor(one: Case): typeof catalogue {
  return one.caps === undefined
    ? catalogue
    : loadCartridge(bytes, { caps: { ...CAPS, ...one.caps }, installed: extensions });
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

function saidJson(line: Said): unknown {
  return {
    effect: line.effect,
    to: line.to,
    by: line.by,
    speaker: line.speaker,
    said: speechJson(line.said),
    bindings: Object.fromEntries(
      [...line.bindings].map(([name, one]) => [name, evaluatedJson(one)]),
    ),
  };
}

/** The wire names the C runtime's host budgets are filled from. */
function limitsJson(
  budgets: RuntimeBudgets,
  caps: StaticCaps,
  mayHold: number | null,
): Record<string, number | null> {
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
    instances: mayHold,
  };
}

/** Run one case against the oracle: what it ends in, and everything it recorded. */
function run(
  one: Case,
  i: number,
  built: Built,
  resolve: (to: Who) => InstanceId,
): Record<string, unknown> {
  const cat = catalogueFor(one);
  const loaded = loadWorld(built.stored, cat).state;
  const draft = new Draft(loaded);
  const budgets: RuntimeBudgets = { ...DEFAULT_LIMITS.budgets, ...one.budgets };
  const budget = new Budget(budgets);
  const passes = passRules({
    state: draft,
    kinds: cat.lookup,
    caps: cat.caps,
    budget,
    names: cat.names,
  });
  const context: LifecycleContext = {
    draft,
    catalogue: cat,
    passes,
    budget,
    draws: new Draws(one.seed ?? 1),
    mayHold: one.holds === undefined ? null : draft.held + one.holds,
    now: INSTANT,
  };
  const hearing = {
    heardBy: () => (one.heard ?? []).map(resolve),
    speaker: one.speaker === undefined ? null : resolve(one.speaker),
    leftOut: (one.leftOut ?? []).map(resolve),
    records: one.records ?? 'as-said',
  };
  const { sink, acted } = actingSink(context, 0, hearing);
  const self = resolve(one.self ?? at('runner'));
  const bindings = new Map<string, Evaluated>(
    Object.entries(one.bind ?? {}).map(([name, to]) => [name, boundObject(resolve(to))]),
  );
  const { block } = blockOf(i);
  const frame: Frame = {
    state: turnState(draft),
    kinds: cat.lookup,
    library: LIBRARY,
    self,
    bindings,
    budget,
    caps: cat.caps,
    names,
    passes,
    draws: context.draws,
  };
  const limits = limitsJson(budgets, cat.caps, context.mayHold);
  try {
    if (one.prior !== undefined) {
      runBody(
        blockOf(`q${i}`).block as never,
        { ...frame, self: resolve(one.prior.self), bindings: new Map() },
        'act',
        sink,
      );
    }
    runBody(block as never, frame, 'act', sink);
    const owed: Owed[] = owedBy(acted.notices, acted.said.length);
    const drained = drain(
      { sends: acted.sends, destroyed: acted.destroyed, marked: acted.marked },
      context,
    );
    const effects = [...acted.said, ...drained.said];
    const after = JSON.stringify(saveWorld(draft.commit().state));
    return {
      limits,
      expect: {
        steps: budget.spentSteps,
        spawns: budget.spentSpawns,
        events: drained.events,
        effects: effects.map(saidJson),
        ran: drained.ran.map((r) => ({ origin: r.origin, on: r.on })),
        owed: [...owed, ...owedAfter(drained.described, acted.said.length)].map((o) => ({
          mover: o.mover,
          place: o.place,
          after: o.after,
        })),
        destroyed: drained.destroyed,
        after: after === JSON.stringify(built.stored) ? null : after,
      },
    };
  } catch (thrown) {
    if (thrown instanceof BudgetExhausted) {
      return {
        limits,
        expect: {
          fault: 'BudgetExhausted',
          budget: thrown.limit,
          limit: thrown.allowed,
          steps: budget.spentSteps,
        },
      };
    }
    if (thrown instanceof Error) {
      return {
        limits,
        expect: {
          fault: thrown.constructor.name === 'Error' ? 'Error' : thrown.constructor.name,
          detail: thrown.message.replace(', which `describe.ts` runs', ''),
          steps: budget.spentSteps,
        },
      };
    }
    throw thrown;
  }
}

/** What one walk asks: the objects in range of `asker` for a message, or for any. */
interface RangeCase {
  readonly name: string;
  readonly asker: Who;
  /** A message of the bench, or any question when null. */
  readonly asking: string | null;
  readonly state: StateName;
}

const RANGES: readonly RangeCase[] = [
  {
    name: 'a runner reaches its place and what the place holds',
    asker: at('runner'),
    asking: null,
    state: 'fresh',
  },
  {
    name: 'a shut chest is reached as a thing, and holds its own',
    asker: at('runner'),
    asking: null,
    state: 'fresh',
  },
  { name: 'an open chest passes what it holds', asker: at('runner'), asking: null, state: 'worn' },
  {
    name: 'a glass case passes only the message it names',
    asker: at('runner'),
    asking: 'ping',
    state: 'fresh',
  },
  {
    name: 'a container asked about itself reaches its own contents',
    asker: at('chest'),
    asking: null,
    state: 'fresh',
  },
  {
    name: 'what is inside a shut chest reaches the chest as a surface',
    asker: at('chest', 'coin'),
    asking: null,
    state: 'fresh',
  },
  {
    name: 'what is inside an open chest reaches the place outside',
    asker: at('chest', 'coin'),
    asking: null,
    state: 'worn',
  },
  { name: 'a person reaches what is in the place', asker: 'visitor', asking: null, state: 'worn' },
];

/** Run one walk against the oracle: who it reaches, nearest first, and the steps it cost. */
function walk(
  one: RangeCase,
  built: Built,
  resolve: (to: Who) => InstanceId,
): Record<string, unknown> {
  const draft = new Draft(loadWorld(built.stored, catalogue).state);
  const budget = new Budget(DEFAULT_LIMITS.budgets);
  const passes = passRules({
    state: draft,
    kinds: catalogue.lookup,
    caps: CAPS,
    budget,
    names: catalogue.names,
  });
  const asking = one.asking === null ? 'any' : catalogue.messages.qualified(LIBRARY, one.asking)!;
  const walked = rangeOf(
    { tree: liveTree(turnState(draft)), passes, budget },
    resolve(one.asker),
    asking,
  );
  return {
    reached: walked.reached.map(({ node, via }) => ({ node, via })),
    steps: budget.spentSteps,
  };
}

describe('the statement goldens', () => {
  it('writes what the oracle says for every case', () => {
    const built = states();
    const cases = CASES.map((one, i) => {
      const state = one.state ?? 'fresh';
      const named = built[state].named;
      const resolve = (to: Who): InstanceId =>
        typeof to === 'string' ? (named[to] as InstanceId) : planned(to);
      const { index } = blockOf(i);
      return {
        name: one.name,
        area: one.area,
        node: index,
        mode: 'act',
        self: resolve(one.self ?? at('runner')),
        library: LIBRARY,
        state,
        bind: Object.fromEntries(
          Object.entries(one.bind ?? {}).map(([name, to]) => [name, resolve(to)]),
        ),
        heard: (one.heard ?? []).map(resolve),
        prior:
          one.prior === undefined
            ? null
            : { node: blockOf(`q${i}`).index, self: resolve(one.prior.self) },
        speaker: one.speaker === undefined ? null : resolve(one.speaker),
        leftOut: (one.leftOut ?? []).map(resolve),
        records: one.records ?? 'as-said',
        seed: one.seed ?? null,
        instant: INSTANT,
        ...(one.unrun === true
          ? { limits: limitsJson({ ...DEFAULT_LIMITS.budgets, ...one.budgets }, CAPS, null) }
          : run(one, i, built[state], resolve)),
      };
    });
    const ranges = RANGES.map((one) => {
      const named = built[one.state].named;
      const resolve = (to: Who): InstanceId =>
        typeof to === 'string' ? (named[to] as InstanceId) : planned(to);
      return {
        name: one.name,
        asker: resolve(one.asker),
        asking: one.asking === null ? null : `${LIBRARY}.${one.asking}`,
        state: one.state,
        ...walk(one, built[one.state], resolve),
      };
    });
    const text = `${JSON.stringify(
      {
        ranges,
        unrun: cases.filter((one, i) => CASES[i]!.unrun === true),
        states: Object.fromEntries(
          Object.entries(built).map(([name, one]) => [name, JSON.stringify(one.stored)]),
        ),
        cases: cases.filter((one, i) => CASES[i]!.unrun !== true),
      },
      null,
      1,
    )}\n`;
    if (process.env['SPROUT_WRITE_GOLDENS'] === '1') {
      writeFileSync(GOLDEN, text);
      writeFileSync(CARTRIDGE, bytes);
    }
    // The file is formatted by prettier after it is written, so it is compared as data.
    expect(JSON.parse(text)).toEqual(JSON.parse(readFileSync(GOLDEN, 'utf8')));
    expect(Buffer.from(bytes).equals(readFileSync(CARTRIDGE))).toBe(true);
  }, 120_000);
});
