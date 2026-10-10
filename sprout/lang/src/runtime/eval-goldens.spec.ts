// The goldens the C evaluator replays (`corpus/goldens/eval.json`, with the
// cartridge it reads, `eval.sproutworld`): a bench world whose bodies hold
// every expression below, evaluated here by `evaluate.ts` over states the
// spec builds, with the value or the fault each case ends in and the steps
// it spent. A case names the expression by its text; the node the cartridge
// holds for it is found by its structure, and must be unique.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { readGraph, type Graph } from '../bundle/cartridge-graph.js';
import { emitCartridge, readCartridge } from '../bundle/cartridge.js';
import { DEFAULT_LIMITS } from '../bundle/limits.js';
import type { NameTable } from '../check/names.js';
import { compiledWorld } from '../fixtures/bundle.js';
import { expression } from '../fixtures/check.js';
import type { Expr } from '../syntax/ast.js';
import { Budget, BudgetExhausted } from './budget.js';
import { loadCartridge } from './cartridge.js';
import { Draft } from './draft.js';
import { Draws } from './draws.js';
import {
  boundObject,
  evaluate,
  IntegerOverflow,
  type Evaluated,
  type Frame,
} from './evaluate.js';
import { kindName } from '../declare/kinds.js';
import { declaredId, type InstanceId } from './ids.js';
import { LifecycleFault, spawnInstance } from './lifecycle.js';
import { SproutList } from './lists.js';
import { initialState, loadWorld, saveWorld } from './load.js';
import { NameOutOfRange } from './named.js';
import { passRules } from './passes.js';
import { newInstance } from './state.js';

const CAPS = DEFAULT_LIMITS.caps;
const LIBRARY = 'eval_bench';
const GOLDEN = fileURLToPath(new URL('../../../../corpus/goldens/eval.json', import.meta.url));
const CARTRIDGE = fileURLToPath(
  new URL('../../../../corpus/goldens/eval.sproutworld', import.meta.url),
);

/** What one case asks: an expression, evaluated as `self` in a state, with names bound. */
interface Case {
  readonly name: string;
  readonly text: string;
  /** Where the text is already written in the source, rather than as a `let` in the probe's handler. */
  readonly source?: true;
  /** Written as a `let` in the body of the probe's play of `tap`, where `actor` and `tool` are bound. */
  readonly play?: true;
  /** The path of the object whose body this is; the probe unless given. */
  readonly self?: readonly string[];
  /** Names bound in the frame, to the object each is: a path in the tree, or `visitor`. */
  readonly bind?: Readonly<Record<string, readonly string[] | 'visitor'>>;
  readonly state?: 'fresh' | 'worn';
  /** The turn's seed, where the case draws. */
  readonly seed?: number;
  /** The host's step budget, where the case runs it out. */
  readonly steps?: number;
}

const DEEP = Array.from({ length: 40 }, () => '1').join(' + ');

const CASES: readonly Case[] = [
  // Literals and operators.
  { name: 'a boolean literal', text: 'true' },
  { name: 'an integer literal', text: '7' },
  { name: 'a string literal', text: '"salt"' },
  { name: 'adds and subtracts', text: 'self.get(:fill) + 4 - 2' },
  { name: 'negates a property', text: '-self.get(:fill)' },
  { name: 'subtracts left to right', text: '1 - 2 - 3' },
  { name: 'negating zero reads as zero', text: '-(1 - 1)' },
  { name: 'compares below', text: '2 < 3' },
  { name: 'compares at most', text: '3 <= 3' },
  { name: 'compares above', text: '3 > 3' },
  { name: 'compares at least', text: '2 >= 3' },
  { name: 'binds ! over < over && over ||', text: '1 + 2 < 4 && !false || 1 < 0' },
  { name: 'compares an option with a property', text: 'self.get(:glaze) == :shino' },
  { name: 'compares an option on the left', text: ':shino != self.get(:glaze)' },
  {
    name: 'compares an option property with another option',
    text: 'self.get(:glaze) == :tenmoku',
    state: 'worn',
  },
  { name: 'compares strings', text: 'self.get(:label) == "salt"' },
  { name: 'compares unequal strings', text: 'self.get(:label) != "sugar"' },
  { name: 'compares booleans', text: 'self.get(:lid) == true' },
  {
    name: 'compares two objects by identity',
    text: 'eval_bench.hall.shelf.jar == eval_bench.hall.shelf.jar',
  },
  {
    name: 'compares two different objects',
    text: 'eval_bench.hall.shelf.jar != eval_bench.hall.shelf.cup',
  },
  { name: '|| leaves its right unevaluated', text: 'true || self.get(:fill) > 5' },
  { name: '&& leaves its right unevaluated', text: 'false && self.get(:fill) > 5' },
  { name: 'the largest integer', text: '2147483647 - 1 + 1' },
  { name: '+ past the largest integer', text: '2147483647 + 1' },
  { name: '- past the smallest integer', text: '-2147483647 - 2' },
  // Members and calls.
  { name: 'get reads the property', text: 'self.get(:fill)' },
  { name: 'get reads the state as the turn stands', text: 'self.get(:fill) + 1', state: 'worn' },
  { name: 'get reads an option property', text: 'self.get(:glaze) != :none', state: 'worn' },
  { name: 'get reads a list', text: 'self.get(:wards)' },
  { name: 'get reads a string', text: 'self.get(:label)' },
  { name: 'a list counts its elements', text: 'self.get(:wards).count' },
  { name: 'a list includes an element', text: 'self.get(:wards).includes(:tenmoku)' },
  { name: 'a list does not include another', text: 'self.get(:wards).includes(:none)' },
  { name: 'count is what a container holds in range', text: 'eval_bench.hall.shelf.count' },
  { name: 'count(K) is those of a kind', text: 'eval_bench.hall.shelf.count(Lidded)' },
  { name: 'count(K) takes those composing the kind', text: 'eval_bench.hall.shelf.count(Jar)' },
  { name: 'count of a place counts what is in range', text: 'eval_bench.hall.count' },
  {
    name: 'is asks whether an instance composes a kind',
    text: 'eval_bench.hall.shelf.cup.is(Jar)',
  },
  { name: 'is asks a kind it does not compose', text: 'eval_bench.hall.shelf.jar.is(Lidded)' },
  {
    name: 'holds asks whether a container holds a thing',
    text: 'eval_bench.hall.shelf.holds(eval_bench.hall.shelf.jar)',
  },
  {
    name: 'holds asks of a thing held elsewhere',
    text: 'eval_bench.hall.holds(eval_bench.hall.shelf.jar)',
  },
  // Names.
  { name: 'self names the object', text: 'self == self' },
  { name: 'a name reached from the world', text: 'eval_bench.hall == eval_bench.hall' },
  { name: 'the world by its name', text: 'eval_bench == eval_bench' },
  // Bindings and the play's names.
  {
    name: 'recall reads the default',
    text: 'actor.recall(:visits)',
    play: true,
    bind: { actor: 'visitor' },
  },
  {
    name: 'recall reads what was written',
    text: 'actor.recall(:visits) + 1',
    play: true,
    bind: { actor: 'visitor' },
    state: 'worn',
  },
  {
    name: 'recall reads a boolean default',
    text: 'actor.recall(:seen)',
    play: true,
    bind: { actor: 'visitor' },
  },
  { name: 'is reads a visitor', text: 'actor.is(Person)', play: true, bind: { actor: 'visitor' } },
  {
    name: 'a bound name is the object',
    text: 'actor == actor',
    play: true,
    bind: { actor: 'visitor' },
  },
  {
    name: 'bound asks of a name given',
    text: 'bound tool',
    play: true,
    bind: { actor: 'visitor', tool: ['hall', 'shelf', 'jar'] },
  },
  {
    name: 'bound asks of a name not given',
    text: 'bound tool',
    play: true,
    bind: { actor: 'visitor' },
  },
  {
    name: 'bound lets the body read the tool',
    text: 'bound tool && tool.get(:fill) > 1',
    play: true,
    bind: { actor: 'visitor', tool: ['hall', 'shelf', 'jar'] },
  },
  // Names a body writes as a kind's, and narrowing.
  { name: 'a name placed nearest', text: 'shelf.is(Shelf) && shelf.count > 1' },
  { name: '&& narrows the name on its right', text: 'shelf.is(Shelf) && shelf.count(Jar) == 2' },
  { name: '&& narrows a dotted path', text: 'shelf.cup.is(Lidded) && shelf.cup.get(:lid)' },
  { name: 'a name behind a closed container', text: 'vault.coin.is(Jar)' },
  {
    name: 'a name reached through a container that passes',
    text: 'vault.coin.is(Jar)',
    state: 'worn',
  },
  // Sight.
  {
    name: 'sees finds no lit light',
    text: 'self.sees(sprout.LightSource, :lit)',
    source: true,
    self: ['dim'],
  },
  {
    name: 'sees finds a lit light',
    text: 'self.sees(sprout.LightSource, :lit)',
    source: true,
    self: ['dim'],
    state: 'worn',
  },
  // Draws.
  { name: 'chance draws true from the seed', text: 'chance(3)', seed: 5 },
  { name: 'chance draws false from another seed', text: 'chance(3)', seed: 1 },
  { name: 'random draws from the seed', text: 'random(6)', seed: 2 },
  { name: 'random draws below one', text: 'random(1)', seed: 7 },
  { name: 'two draws in order', text: 'random(9) + random(9)', seed: 99 },
  // The budget.
  { name: 'a deep expression within the step budget', text: DEEP, steps: 200 },
  { name: 'a deep expression past the step budget', text: DEEP, steps: 25 },
  { name: 'a name behind a rule is charged to the turn', text: 'vault.coin.is(Jar)', steps: 6 },
];

/** The bench world: the cases' expressions are the handler's lets, so the checker accepts each. */
function sourceOf(cases: readonly Case[]): string {
  const lets = (where: 'handler' | 'play'): string[] =>
    [
      ...new Set(
        cases
          .filter((one) => one.source !== true && (one.play === true) === (where === 'play'))
          .map((one) => one.text),
      ),
    ].map((text, i) => `    let ${where === 'play' ? 'p' : 'c'}${i} = ${text}`);
  return [
    'world eval_bench is sprout.World { contains visitors are Person visitors arrive at hall',
    '  object hall is Room {',
    '    object probe is Probe',
    '    object shelf is Shelf {',
    '      object jar is Jar',
    '      object cup is Lidded',
    '    }',
    '    object vault is Vault { object coin is Jar  object box is Shelf }',
    '  }',
    '  object nook is Place',
    '  object dim is Dim { object lamp is sprout.LightSource }',
    '}',
    'enum Glaze { none, shino, tenmoku }',
    'kind Place { contains actors }',
    'kind Room is sprout.Place { :lit true }',
    'kind Dim is sprout.Place { grammar { lit (self.sees(sprout.LightSource, :lit)) } }',
    'kind Shelf { contains :capacity 3 min 0 max 9 }',
    'kind Vault { contains :open false  pass any (self.get(:open)) }',
    'kind Jar {',
    '  :glaze Glaze default shino',
    '  :fill 3 min 0 max 9',
    '  :wards [Glaze] default [shino, tenmoku]',
    '  :label string default "salt"',
    '  remembers { :seen false :visits 2 min 0 max 9 }',
    '}',
    'kind Lidded is Jar { :lid true }',
    'kind Crate { contains object lid is Jar object tray is Shelf { object seed is Jar } }',
    'kind Person is sprout.Visitor { :score 0 }',
    'verb tap { role target: Probe  role tool: Jar  "tap [target] with [tool]"  "tap [target]" }',
    'kind Probe is Lidded {',
    '  on :spawned (from) {',
    ...lets('handler'),
    '  }',
    '  as target for tap {',
    '    do {',
    ...lets('play'),
    '    }',
    '  }',
    '}',
    '',
  ].join('\n');
}

const bundle = compiledWorld(LIBRARY, { [`${LIBRARY}.sprout`]: sourceOf(CASES) });
const bytes = emitCartridge(bundle);
const catalogue = loadCartridge(bytes, { caps: CAPS });

/** The cartridge's own graph, read again here so the nodes and the name table are one set of objects. */
const cartridge = readCartridge(bytes);
const graph: Graph = readGraph({
  files: cartridge.table.files,
  prose: cartridge.prose.entries,
  bodies: cartridge.bodies.entries,
  rest: cartridge.table.entries,
});
const names = graph.read(cartridge.bodies.names) as NameTable;
const EXPRESSION_KINDS = new Set([
  'boolean',
  'integer',
  'string',
  'binding',
  'symbol-expr',
  'kind-expr',
  'unary',
  'binary',
  'member',
  'call',
  'free-call',
  'bound',
]);
const BODIES = { from: cartridge.prose.entries.length, count: cartridge.bodies.entries.length };

/** An expression without its places, as a structure comparable across graphs. */
function shapeOf(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(shapeOf);
  if ('source' in value && 'start' in value) return undefined;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'span')
      .map(([key, one]) => [key, shapeOf(one)]),
  );
}

/** Every expression of the cartridge's bodies, and which of them stand inside another. */
const EXPRESSIONS: { index: number; expr: Expr }[] = [];
const INSIDE = new Set<unknown>();
for (let at = BODIES.from; at < BODIES.from + BODIES.count; at++) {
  const entry = graph.read([at]) as Record<string, unknown>;
  if (!EXPRESSION_KINDS.has(String(entry['kind']))) continue;
  EXPRESSIONS.push({ index: at, expr: entry as unknown as Expr });
  for (const [key, one] of Object.entries(entry)) {
    if (key === 'span') continue;
    for (const child of Array.isArray(one) ? one : [one]) INSIDE.add(child);
  }
}

/** The entry of the cartridge's bodies that is `text` written out whole, which must be written once. */
function nodeOf(text: string): { index: number; expr: Expr } {
  const wanted = JSON.stringify(shapeOf(expression(text)));
  const found = EXPRESSIONS.filter(
    ({ expr }) => !INSIDE.has(expr) && JSON.stringify(shapeOf(expr)) === wanted,
  );
  // A literal written alone is the same wherever it stands; anything else must be one place.
  if (
    found.length !== 1 &&
    !(found.length > 1 && ['boolean', 'integer', 'string'].includes(found[0]!.expr.kind))
  )
    throw new Error(`\`${text}\` is written ${found.length} times, not once`);
  return found[0]!;
}

const id = (...path: string[]): InstanceId => declaredId(LIBRARY, path);
const VISIT = 'visit-1';

/** A draft over a new world with a visitor in the hall, the visitor's id with it. */
function turn(): { draft: Draft; visitor: InstanceId } {
  const draft = new Draft(initialState(catalogue));
  const visitor = draft.mint();
  draft.add(
    newInstance(
      visitor,
      { from: 'visitor' },
      catalogue.visitorKind!,
      id('hall'),
      draft.nextSerial(),
      CAPS,
    ),
  );
  draft.putVisitor({
    visit: VISIT,
    nickname: 'Pat',
    instance: visitor,
    lastPlace: id('hall'),
    referents: [],
    lastReading: null,
  });
  return { draft, visitor };
}

/** The two states the cases run in, as a store keeps them. */
function states(): Record<'fresh' | 'worn', ReturnType<typeof saveWorld>> {
  const fresh = turn();
  const freshState = fresh.draft.commit().state;
  const worn = turn();
  const probe = worn.draft.instance(id('hall', 'probe'))!;
  worn.draft.write({
    ...probe,
    properties: new Map([...probe.properties, ['fill', 7], ['glaze', 'tenmoku']]),
    memory: new Map([[worn.visitor, new Map([['visits', 5]])]]),
  });
  for (const [path, property, value] of [
    [['hall', 'vault'], 'open', true],
    [['dim', 'lamp'], 'lit', true],
  ] as const) {
    const held = worn.draft.instance(id(...path))!;
    worn.draft.write({ ...held, properties: new Map([...held.properties, [property, value]]) });
  }
  return { fresh: saveWorld(freshState), worn: saveWorld(worn.draft.commit().state) };
}

/** What a value or an object is, in the form `sproutc eval` prints. */
function canonical(evaluated: Evaluated): unknown {
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

function plain(value: unknown): unknown {
  return value instanceof SproutList ? value.elements.map(plain) : value;
}

/** Run one case against the oracle: its value or its fault, and the steps spent. */
function run(one: Case, stored: ReturnType<typeof saveWorld>): Record<string, unknown> {
  const { expr } = nodeOf(one.text);
  const loaded = loadWorld(stored, catalogue).state;
  const draft = new Draft(loaded);
  const visitor = [...loaded.instances.values()].find((i) => i.made.from === 'visitor')!.id;
  const resolve = (to: readonly string[] | 'visitor'): InstanceId =>
    to === 'visitor' ? visitor : id(...to);
  const budget = new Budget({
    ...DEFAULT_LIMITS.budgets,
    ...(one.steps === undefined ? {} : { steps: one.steps }),
  });
  const frame: Frame = {
    state: draft,
    kinds: catalogue.lookup,
    library: LIBRARY,
    self: id(...(one.self ?? ['hall', 'probe'])),
    bindings: new Map(
      Object.entries(one.bind ?? {}).map(([name, to]) => [name, boundObject(resolve(to))]),
    ),
    budget,
    caps: CAPS,
    names,
    passes: passRules({
      state: draft,
      kinds: catalogue.lookup,
      caps: CAPS,
      budget,
      names: catalogue.names,
    }),
    ...(one.seed === undefined ? {} : { draws: new Draws(one.seed) }),
  };
  try {
    return { expect: canonical(evaluate(expr, frame)), steps: budget.spentSteps };
  } catch (thrown) {
    if (thrown instanceof BudgetExhausted) {
      return {
        expect: { fault: 'BudgetExhausted', budget: thrown.limit, limit: thrown.allowed },
        steps: budget.spentSteps,
      };
    }
    if (thrown instanceof IntegerOverflow || thrown instanceof NameOutOfRange) {
      return { expect: { fault: thrown.name, detail: thrown.message }, steps: budget.spentSteps };
    }
    throw thrown;
  }
}

/** What a spawn asks: a kind made in a container by the object whose body ran the `spawn`. */
interface SpawnCase {
  readonly name: string;
  readonly kind: string;
  readonly container: readonly string[];
  readonly spawner?: readonly string[];
  readonly state?: 'fresh' | 'worn';
  /** The host's cap on spawns per turn, where the case runs it out. */
  readonly spawns?: number;
}

const SPAWNS: readonly SpawnCase[] = [
  { name: 'a spawn makes one instance', kind: `${LIBRARY}.Jar`, container: ['hall'] },
  { name: 'a spawn is given what its kind holds', kind: `${LIBRARY}.Crate`, container: ['hall'] },
  {
    name: 'a spawn into a container that holds nothing',
    kind: `${LIBRARY}.Jar`,
    container: ['hall', 'shelf', 'jar'],
  },
  { name: 'a spawn out of range', kind: `${LIBRARY}.Jar`, container: ['hall', 'vault', 'box'] },
  {
    name: 'a spawn within range of an open container',
    kind: `${LIBRARY}.Jar`,
    container: ['hall', 'vault', 'box'],
    state: 'worn',
  },
  {
    name: 'a spawn charges the instance and each content',
    kind: `${LIBRARY}.Crate`,
    container: ['hall'],
    spawns: 3,
  },
  {
    name: 'a spawn of a kind that is not declared',
    kind: `${LIBRARY}.Missing`,
    container: ['hall'],
  },
];

/** Run one spawn against the oracle: the instances made and where, or the fault. */
function runSpawn(one: SpawnCase, stored: ReturnType<typeof saveWorld>): Record<string, unknown> {
  const loaded = loadWorld(stored, catalogue).state;
  const draft = new Draft(loaded);
  const budget = new Budget({
    ...DEFAULT_LIMITS.budgets,
    ...(one.spawns === undefined ? {} : { spawnsPerTurn: one.spawns }),
  });
  const passes = passRules({
    state: draft,
    kinds: catalogue.lookup,
    caps: CAPS,
    budget,
    names: catalogue.names,
  });
  const context = { draft, catalogue, passes, budget, draws: new Draws(1), mayHold: null, now: 0 };
  try {
    const made = spawnInstance(
      context,
      id(...(one.spawner ?? ['hall', 'probe'])),
      one.kind,
      id(...one.container),
    );
    const placed = [made.id, ...made.contents].map((one) => {
      const instance = draft.instance(one)!;
      return { id: one, kind: kindName(instance.kind), container: instance.container };
    });
    return {
      expect: { id: made.id, contents: made.contents, placed },
      spawned: budget.spentSpawns,
    };
  } catch (thrown) {
    if (thrown instanceof BudgetExhausted) {
      return { expect: { fault: thrown.name, budget: thrown.limit, limit: thrown.allowed } };
    }
    if (thrown instanceof LifecycleFault) {
      return { expect: { fault: thrown.name, detail: thrown.message } };
    }
    throw thrown;
  }
}

describe('the evaluator goldens', () => {
  it('writes what the oracle says for every case', () => {
    const stored = states();
    const visitor = `${LIBRARY}#1`;
    const resolve = (to: readonly string[] | 'visitor'): string =>
      to === 'visitor' ? visitor : id(...to);
    const cases = CASES.map((one) => ({
      name: one.name,
      text: one.text,
      node: nodeOf(one.text).index,
      self: id(...(one.self ?? ['hall', 'probe'])),
      library: LIBRARY,
      state: one.state ?? 'fresh',
      bind: Object.fromEntries(
        Object.entries(one.bind ?? {}).map(([name, to]) => [name, resolve(to)]),
      ),
      seed: one.seed ?? null,
      budget: one.steps ?? null,
      ...run(one, stored[one.state ?? 'fresh']),
    }));
    const spawns = SPAWNS.map((one) => ({
      name: one.name,
      kind: one.kind,
      container: id(...one.container),
      spawner: id(...(one.spawner ?? ['hall', 'probe'])),
      library: LIBRARY,
      state: one.state ?? 'fresh',
      spawns: one.spawns ?? null,
      ...runSpawn(one, stored[one.state ?? 'fresh']),
    }));
    const text = `${JSON.stringify(
      {
        states: Object.fromEntries(
          Object.entries(stored).map(([name, one]) => [name, JSON.stringify(one)]),
        ),
        cases,
        spawns,
      },
      null,
      1,
    )}\n`;
    if (process.env['SPROUT_WRITE_GOLDENS'] === '1') {
      writeFileSync(GOLDEN, text);
      writeFileSync(CARTRIDGE, bytes);
    }
    expect(text).toBe(readFileSync(GOLDEN, 'utf8'));
    expect(Buffer.from(bytes).equals(readFileSync(CARTRIDGE))).toBe(true);
  }, 60_000);
});
