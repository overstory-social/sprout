// The bench world the statement goldens are written about, and the oracle's run of every
// case in it: a world whose handlers and plays hold every body of `exec-cases/`, run by
// `body.ts` and drained by `bus.ts` over states built here, with what each case ends in:
// the state it commits or the fault it dies with, the effects recorded, the steps spent,
// the handlers that ran and the descriptions owed. A case names its body by its text; the
// block the cartridge holds for it is found by its structure. Spec support: the package
// build leaves it out.

import type { Bundle } from '../bundle/bundle.js';
import { readGraph, type Graph } from '../bundle/cartridge-graph.js';
import { emitCartridge, readCartridge } from '../bundle/cartridge.js';
import { DEFAULT_LIMITS, type RuntimeBudgets, type StaticCaps } from '../bundle/limits.js';
import type { NameTable } from '../check/names.js';
import { Budget, BudgetExhausted } from '../runtime/budget.js';
import { drain } from '../runtime/bus.js';
import { loadCartridge } from '../runtime/cartridge.js';
import { Draft } from '../runtime/draft.js';
import { Draws } from '../runtime/draws.js';
import { STOCK_LINES } from '../runtime/engine-lines.js';
import { boundObject, type Evaluated, type Frame } from '../runtime/evaluate.js';
import { declaredId, visitKey, type InstanceId } from '../runtime/ids.js';
import { spawnInstance, type LifecycleContext } from '../runtime/lifecycle.js';
import { SproutList } from '../runtime/lists.js';
import { liveTree } from '../runtime/live.js';
import { initialState, loadWorld, saveWorld } from '../runtime/load.js';
import { owedAfter, owedBy, type Owed } from '../runtime/move.js';
import { passRules } from '../runtime/passes.js';
import { rangeOf } from '../runtime/range.js';
import { actingSink, turnState, type Said } from '../runtime/reading.js';
import { runBody, type Speech } from '../runtime/body.js';
import { newInstance, type PendingWake } from '../runtime/state.js';
import { compiledWorld } from './bundle.js';
import {
  at,
  type Case,
  type Named,
  type RangeCase,
  type StateName,
  type Who,
} from './exec-cases.js';
import { CASES } from './exec-cases/index.js';
import { RANGES } from './exec-cases/ranges.js';
import { MEDIA } from './extensions.js';
import { read } from './parse.js';

const CAPS = DEFAULT_LIMITS.caps;
const LIBRARY = 'exec_bench';
/** The instant every turn runs at, in host seconds. */
const INSTANT = 1000;

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
    'verb bark { role target  "bark at [target]" }',
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
    'kind Lamp {',
    '  :lit false',
    '  on :ping (from) { self.set(:lit, true) }',
    '  as target for bark { permit { refuse "The lamp is not listening." } }',
    '}',
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

/** The cartridge the cases are read from. */
export { bytes };

/** Everything the goldens hold, as data: the states, the cases the oracle ran, the bodies located but not run, and the walks. */
export function goldenOf(): {
  readonly states: Record<string, string>;
  readonly cases: readonly { readonly area: string }[];
  readonly unrun: readonly unknown[];
  readonly ranges: readonly unknown[];
} {
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
  return {
    ranges,
    unrun: cases.filter((_, i) => CASES[i]!.unrun === true),
    states: Object.fromEntries(
      Object.entries(built).map(([name, one]) => [name, JSON.stringify(one.stored)]),
    ),
    cases: cases.filter((_, i) => CASES[i]!.unrun !== true),
  };
}
