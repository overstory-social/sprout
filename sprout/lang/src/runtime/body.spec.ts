import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS, type StaticCaps } from '../bundle/limits.js';
import { playsOf } from '../declare/roles.js';
import { WORLD_PASSES_ANYTHING } from '../declare/world.js';
import { compiledWorld } from '../fixtures/bundle.js';
import type { Block } from '../syntax/ast.js';
import { parseStatement } from '../syntax/parse.js';
import { Diagnostics } from '../source/diagnostics.js';
import { SourceFile } from '../source/source.js';
import type { Performed } from './act.js';
import {
  runBody,
  ValueOutOfRange,
  type ActSink,
  type Proposed,
  type Spoken,
  type Told,
} from './body.js';
import { Budget } from './budget.js';
import { catalogueOf, type Catalogue } from './catalogue.js';
import { Draft } from './draft.js';
import { boundObject, type Frame } from './evaluate.js';
import { declaredId, type InstanceId } from './ids.js';
import { destroyInstance, type Destroyed } from './lifecycle.js';
import type { Sent } from './sends.js';
import { ListFull, SproutList } from './lists.js';
import { initialState } from './load.js';
import { newInstance } from './state.js';
import { WakeFault } from './wakes.js';

const CAPS = DEFAULT_LIMITS.caps;

const VERBS = [
  'fill',
  'bump',
  'grow',
  'shrink',
  'greet',
  'stare',
  'speak',
  'craft',
  'vanish',
  'spill',
  'weigh',
  'haul',
  'poke',
  'shove',
  'lug',
  'sink',
  'ring',
  'dig',
  'rest',
  'announce',
];

/**
 * A shop whose counter plays the target of one verb per thing a `do` may
 * do, and one `permit`. `Loud` composes it and writes its own `done`.
 */
const bundle = compiledWorld('shop', {
  'world.sprout': [
    'world shop is sprout.World {',
    '  contains visitors are Person visitors arrive at hall',
    '  object hall is Room {',
    '    object counter is Counter { object pin is Cup }',
    '    object near is Heeds',
    '    object loud is Loud',
    '    object cat is Pet',
    '    object pit is Pit',
    '  }',
    '  object yard is Room { object far is Heeds }',
    '}',
    'enum Ward { oak, silver, iron }',
    'kind Creature is sprout.Actor { }',
    'kind Person is Creature, sprout.Visitor { }',
    'kind Room { contains actors }',
    'kind Cup { }',
    ...VERBS.map((verb) => `verb ${verb} { role target "${verb} [target]" }`),
    'kind Counter {',
    '  contains',
    '  :n 1 min 0 max 9',
    '  :wards [Ward] default [oak]',
    '  remembers { :seen 0 min 0 max 3 :met false }',
    '  passage done default { Done. }',
    '  as target for fill   { do { let a = 2  self.set(:n, self.get(:n) + a) } }',
    '  as target for bump   { do { self.adjust(:n, 20)  let top = self.get(:n)  self.adjust(:n, -30)  self.adjust(:n, top) } }',
    '  as target for grow   { do { self.add(:wards, :silver)  self.add(:wards, :oak) } }',
    '  as target for shrink { do { self.remove(:wards, :oak)  self.remove(:wards, :iron) } }',
    '  as target for greet  { do { actor.remember(:met, true)  actor.adjust(:seen, 5) } }',
    '  as target for stare  { do { actor.remember(:seen, self.get(:n) + 5) } }',
    '  as target for speak  { do { say "Plain words."  let a = 1  say done } }',
    '  as target for craft  { do { let cup = spawn Cup in self  spawn Cup in actor  say "Made {cup}." } }',
    '  as target for vanish { do { destroy self  self.set(:n, 5)  say "Gone." } }',
    '  as target for spill  { do { self.set(:n, 7)  self.set(:n, self.get(:n) + 20) } }',
    '  as target for weigh  { permit { if (self.get(:n) > 5) { refuse "Too full." } allow } }',
    '  as target for haul   { do { move actor to self  move self to here  say "Hauled." } }',
    '  as target for lug    { do { self.set(:n, 4)  if (self.get(:n) > 0) { move actor to self  say "Inside." }  say "After." } }',
    '  as target for sink   { do { destroy self  move actor to self  say "Sunk." } }',
    '  as target for rest   { do { wake in 2 minutes  say "Resting." } }',
    '  as target for announce { do { tell "{actor} rings {self}."  let a = 1  tell actor done  tell self "Rung." } }',
    '  as target for ring   { do { send hall.counter.pin :knock  send hall.cat :tally with self.get(:n)  send hall.near :knock  send yard.far :knock  broadcast :knock } }',
    '}',
    'message :knock',
    'message :tally with integer',
    'kind Heeds { on :knock { } on :tally (_, n) { } }',
    'kind Loud is Counter { passage done { Done, loudly. } }',
    'kind Pit {',
    '  contains actors',
    '  grammar { link down "down into the dark" }',
    '  as target for dig { do { let hole = spawn Pit in self  connect down to hole  connect down to hole  say "Dug." } }',
    '}',
    'verb nuzzle { role target  role toys many  "nuzzle [target] with [toys]" }',
    'kind Pet is Creature {',
    '  as target for poke  { do { act nuzzle (target: actor, toys: here)  say "After." } }',
    '  as target for shove { do { act nuzzle (target: actor)  say "After." } }',
    '}',
    '',
  ].join('\n'),
});

const id = (...path: string[]): InstanceId => declaredId('shop', path);
const WORLD_ID = id();
const HALL = id('hall');
const COUNTER = id('hall', 'counter');
const LOUD = id('hall', 'loud');
const PIN = id('hall', 'counter', 'pin');
const CAT = id('hall', 'cat');
const NEAR = id('hall', 'near');
const FAR = id('yard', 'far');
const PIT = id('hall', 'pit');

/** What an acting body did, as the sink heard it. */
interface Heard {
  readonly spoken: Spoken[];
  readonly told: Told[];
  readonly sends: Sent[];
  readonly destroyed: Destroyed[];
  readonly marked: InstanceId[];
  /** Each `move` proposed: the mover, the thing and where it is to go. */
  readonly moves: [InstanceId, InstanceId, InstanceId][];
  /** Each `act` performed: the actor, and the reading as the body evaluated it. */
  readonly acts: [InstanceId, Performed][];
}

interface Turn {
  readonly draft: Draft;
  readonly visitor: InstanceId;
  readonly catalogue: Catalogue;
}

/** A fresh turn, with a visitor in the hall, under the host's caps given. */
function turn(caps: StaticCaps = CAPS): Turn {
  const catalogue = catalogueOf(bundle, caps);
  const draft = new Draft(initialState(catalogue));
  const visitor = draft.mint();
  draft.add(
    newInstance(
      visitor,
      { from: 'visitor' },
      catalogue.visitorKind!,
      HALL,
      draft.nextSerial(),
      caps,
    ),
  );
  return { draft, visitor, catalogue };
}

/** The `do` (or the `permit`) `self`'s kind plays as the target of `verb`. */
function body(draft: Draft, self: InstanceId, verb: string, part: 'do' | 'permit' = 'do'): Block {
  const plays = playsOf(draft.instance(self)!.kind.plays, 'shop', verb, 'target');
  expect(plays).toHaveLength(1);
  const block = plays[0]!.declaration[part];
  if (block === null) throw new Error(`no ${part} for ${verb}`);
  return block;
}

function frameOf(turn: Turn, self: InstanceId, budget: Budget): Frame {
  return {
    state: turn.draft,
    kinds: turn.catalogue.lookup,
    library: 'shop',
    self,
    names: turn.catalogue.names,
    passes: () => true,
    bindings: new Map([
      ['actor', boundObject(turn.visitor)],
      ['here', boundObject(HALL)],
    ]),
    budget,
    caps: turn.catalogue.caps,
  };
}

/**
 * Run `verb`'s `do` for `self` in act mode; what the sink heard, and the
 * budget charged. `answer` says what came of the nth `move` or `act`
 * proposed, counting both from 0.
 */
function act(
  turn: Turn,
  self: InstanceId,
  verb: string,
  budget = new Budget(DEFAULT_LIMITS.budgets),
  performing: (actor: InstanceId) => void = () => {},
  answer: (nth: number) => Proposed = () => 'done',
): Heard {
  let proposed = 0;
  const heard: Heard = {
    spoken: [],
    told: [],
    sends: [],
    destroyed: [],
    marked: [],
    moves: [],
    acts: [],
  };
  const sink: ActSink = {
    lifecycle: {
      draft: turn.draft,
      catalogue: turn.catalogue,
      passes: (container) => (container === WORLD_ID ? WORLD_PASSES_ANYTHING : true),
      budget,
      mayHold: null,
      now: 0,
    },
    say: (spoken) => heard.spoken.push(spoken),
    tell: (told) => heard.told.push(told),
    sent: (sends) => heard.sends.push(...sends),
    destroyed: (destroyed) => heard.destroyed.push(destroyed),
    marked: (marked) => heard.marked.push(marked),
    move: (mover, item, to) => {
      heard.moves.push([mover, item, to]);
      return answer(proposed++);
    },
    act: (actor, performed) => {
      heard.acts.push([actor, performed]);
      performing(actor);
      return answer(proposed++);
    },
  };
  expect(runBody(body(turn.draft, self, verb), frameOf(turn, self, budget), 'act', sink)).toBe(
    'end',
  );
  return heard;
}

const property = (turn: Turn, self: InstanceId, name: string) =>
  turn.draft.instance(self)!.properties.get(name);
const wards = (turn: Turn) => (property(turn, COUNTER, 'wards') as SproutList).elements;
const words = (spoken: Spoken) =>
  'text' in spoken.said
    ? spoken.said.text
    : 'absent' in spoken.said
      ? `absent ${spoken.said.absent}`
      : `${spoken.said.passage.origin} ${spoken.said.passage.name}: ${spoken.said.passage.body.text.trim()}`;

describe('what a `do` writes', () => {
  it('`set` writes `self` through the draft, and a later read in the turn sees it', () => {
    const one = turn();
    act(one, COUNTER, 'fill');
    expect(property(one, COUNTER, 'n')).toBe(3);
    act(one, COUNTER, 'fill');
    expect(property(one, COUNTER, 'n')).toBe(5);
    // The committed state is untouched until the turn commits.
    const committed = new Draft(initialState(one.catalogue));
    expect(committed.instance(COUNTER)!.properties.get('n')).toBe(1);
  });

  it('`set` faults on a value outside the range, and writes nothing of it', () => {
    const one = turn();
    expect(() => act(one, COUNTER, 'spill')).toThrow(ValueOutOfRange);
    // The first `set` landed; the second, 27, did not.
    expect(property(one, COUNTER, 'n')).toBe(7);
  });

  it('`adjust` clamps at the top of the range and at the bottom, rather than faulting', () => {
    const one = turn();
    act(one, COUNTER, 'bump');
    // 1 + 20 is 9 at the top; 9 - 30 is 0 at the bottom; 0 + 9 is 9.
    expect(property(one, COUNTER, 'n')).toBe(9);
  });

  it('`add` appends a new option and does nothing with one held; `remove` likewise', () => {
    const one = turn();
    act(one, COUNTER, 'grow');
    expect(wards(one)).toEqual(['oak', 'silver']);
    act(one, COUNTER, 'shrink');
    expect(wards(one)).toEqual(['silver']);
  });

  it('`add` of a new option to a full list faults, and writes nothing of it', () => {
    const one = turn({ ...CAPS, listElements: 1 });
    expect(() => act(one, COUNTER, 'grow')).toThrow(ListFull);
    expect(wards(one)).toEqual(['oak']);
  });

  it("writes memory as `self`'s own, about the actor: `remember` sets, `adjust` clamps", () => {
    const one = turn();
    act(one, COUNTER, 'greet');
    const about = one.draft.instance(COUNTER)!.memory.get(one.visitor)!;
    expect(Object.fromEntries(about)).toEqual({ met: true, seen: 3 });
    // Nothing is written on the actor: memory is the rememberer's.
    expect(one.draft.instance(one.visitor)!.memory.size).toBe(0);
  });

  it('`remember` faults on a value outside the range, and writes nothing', () => {
    const one = turn();
    expect(() => act(one, COUNTER, 'stare')).toThrow(ValueOutOfRange);
    expect(one.draft.instance(COUNTER)!.memory.size).toBe(0);
  });
});

describe('what a `do` says, spawns and destroys', () => {
  it('tells the place, or the one it names as evaluated, with the names in scope, in body order', () => {
    const one = turn();
    const heard = act(one, COUNTER, 'announce');
    expect(heard.spoken).toEqual([]);
    expect(heard.told.map((told) => [told.by, told.one, words(told)])).toEqual([
      [COUNTER, null, '{actor} rings {self}.'],
      [COUNTER, one.visitor, 'shop.Counter done: Done.'],
      [COUNTER, COUNTER, 'Rung.'],
    ]);
    expect(heard.told.map((told) => [...told.bindings.keys()])).toEqual([
      ['actor', 'here'],
      ['actor', 'here', 'a'],
      ['actor', 'here', 'a'],
    ]);
  });

  it("says words in quotes, and a passage as `self`'s kind has it, a composer's own over a default", () => {
    const one = turn();
    const plain = act(one, COUNTER, 'speak').spoken;
    expect(plain.map((spoken) => [spoken.by, words(spoken)])).toEqual([
      [COUNTER, 'Plain words.'],
      [COUNTER, 'shop.Counter done: Done.'],
    ]);
    const loud = act(one, LOUD, 'speak').spoken;
    expect(words(loud[1]!)).toBe('shop.Loud done: Done, loudly.');
  });

  it('carries the names in scope where it was said, a `let` among them only after it', () => {
    const one = turn();
    const [first, second] = act(one, COUNTER, 'speak').spoken;
    expect([...first!.bindings.keys()]).toEqual(['actor', 'here']);
    expect([...second!.bindings.keys()]).toEqual(['actor', 'here', 'a']);
  });

  it('spawns into what the name is bound to, binds a `let` to the new one, and hands on what the engine sends', () => {
    const one = turn();
    const heard = act(one, COUNTER, 'craft');
    const [cup, carried] = [heard.sends[1]!.recipient, heard.sends[3]!.recipient];
    expect(heard.sends).toEqual([
      { message: 'entered', recipient: COUNTER, item: cup, from: COUNTER },
      { message: 'spawned', recipient: cup, from: COUNTER },
      { message: 'entered', recipient: one.visitor, item: carried, from: COUNTER },
      { message: 'spawned', recipient: carried, from: COUNTER },
    ]);
    expect(one.draft.children(COUNTER)).toEqual([PIN, cup]);
    expect(one.draft.children(one.visitor)).toEqual([carried]);
    expect(heard.spoken[0]!.bindings.get('cup')).toEqual(boundObject(cup));
  });

  it('destroys `self` when the body ends: what follows still runs, and what it held goes with it', () => {
    const one = turn();
    const heard = act(one, COUNTER, 'vanish');
    expect(heard.spoken.map(words)).toEqual(['Gone.']);
    expect(heard.destroyed).toHaveLength(1);
    expect(heard.destroyed[0]).toEqual({ id: COUNTER, removed: [COUNTER, PIN] });
    expect(heard.sends).toEqual([]);
    expect(one.draft.instance(COUNTER)).toBeUndefined();
    // The write after `destroy self` landed before it took effect.
    expect(one.draft.destroyed(COUNTER)!.properties.get('n')).toBe(5);
    expect(one.draft.instance(PIN)).toBeUndefined();
    expect(one.draft.destroyed(PIN)!.container).toBe(COUNTER);
  });
});

describe('what a `do` asks for', () => {
  it('asks for `self` to be woken, at the turn’s instant, charged as the statement it is, and goes on', () => {
    const one = turn();
    const budget = new Budget(DEFAULT_LIMITS.budgets);
    const heard = act(one, COUNTER, 'rest', budget);
    expect(one.draft.instance(COUNTER)!.wakes).toEqual([
      { serial: one.draft.commit().state.serial, askedAt: 0, dueAt: 120 },
    ]);
    expect(heard.spoken.map(words)).toEqual(['Resting.']);
    // The `wake` and the `say`, one step each.
    expect(budget.spentSteps).toBe(2);
  });

  it('faults a second `wake` past the host’s cap of one, and says nothing after it', () => {
    const one = turn();
    act(one, COUNTER, 'rest');
    let heard: Heard | undefined;
    expect(() => {
      heard = act(one, COUNTER, 'rest');
    }).toThrow(WakeFault);
    expect(heard).toBeUndefined();
    expect(one.draft.instance(COUNTER)!.wakes).toHaveLength(1);
  });
});

describe('what a `do` moves', () => {
  it('proposes each `move` with `self` as the mover, the names as bound, and goes on after one made', () => {
    const one = turn();
    const heard = act(one, COUNTER, 'haul');
    expect(heard.moves).toEqual([
      [COUNTER, one.visitor, COUNTER],
      [COUNTER, COUNTER, HALL],
    ]);
    expect(heard.spoken.map(words)).toEqual(['Hauled.']);
    // The sink makes the move; the body writes nothing of it itself.
    expect(one.draft.instance(one.visitor)!.container).toBe(HALL);
  });

  it('ends the body at the first refused `move`: nothing after it runs', () => {
    const one = turn();
    const first = act(one, COUNTER, 'haul', undefined, undefined, () => 'refused');
    expect(first.moves).toEqual([[COUNTER, one.visitor, COUNTER]]);
    expect(first.spoken).toEqual([]);
    const second = act(turn(), COUNTER, 'haul', undefined, undefined, (nth) =>
      nth === 1 ? 'refused' : 'done',
    );
    expect(second.moves).toHaveLength(2);
    expect(second.spoken).toEqual([]);
  });

  it('ends the whole body, not just the block, where the refused `move` is inside an `if`', () => {
    const one = turn();
    const heard = act(one, COUNTER, 'lug', undefined, undefined, () => 'refused');
    expect(heard.moves).toHaveLength(1);
    expect(heard.spoken).toEqual([]);
    // What ran before the refusal stands.
    expect(property(one, COUNTER, 'n')).toBe(4);
    const made = act(turn(), COUNTER, 'lug');
    expect(made.spoken.map(words)).toEqual(['Inside.', 'After.']);
  });

  it('still destroys `self` as a body that asked to be destroyed ends at a refusal', () => {
    const one = turn();
    const heard = act(one, COUNTER, 'sink', undefined, undefined, () => 'refused');
    expect(heard.spoken).toEqual([]);
    expect(heard.destroyed).toHaveLength(1);
    expect(one.draft.instance(COUNTER)).toBeUndefined();
  });
});

describe('what a `do` connects', () => {
  it('writes `self`’s link to what the binding holds, replacing where it led, and goes on', () => {
    const one = turn();
    const heard = act(one, PIT, 'dig');
    const links = [...one.draft.instance(PIT)!.links];
    expect(links).toHaveLength(1);
    const [direction, hole] = links[0]!;
    expect(direction).toBe('down');
    expect(one.draft.instance(hole)!.container).toBe(PIT);
    expect(heard.spoken.map(words)).toEqual(['Dug.']);
  });
});

describe('what a `do` performs', () => {
  it('hands each `act` to the sink with `self` as the actor and each role as evaluated, and goes on after one done', () => {
    const one = turn();
    const heard = act(one, CAT, 'poke');
    expect(heard.acts).toEqual([
      [
        CAT,
        {
          verb: 'nuzzle',
          library: 'shop',
          roles: new Map([
            ['target', { binds: 'object', id: one.visitor }],
            ['toys', { binds: 'object', id: HALL }],
          ]),
        },
      ],
    ]);
    expect(heard.spoken.map(words)).toEqual(['After.']);
  });

  it('ends the body where the `act` is refused: nothing after it runs', () => {
    const heard = act(turn(), CAT, 'poke', undefined, undefined, () => 'refused');
    expect(heard.acts).toHaveLength(1);
    expect(heard.spoken).toEqual([]);
  });

  it('ends the body where the reading it performed destroyed `self`', () => {
    const one = turn();
    const heard = act(one, CAT, 'shove', undefined, (actor) => destroyInstance(one.draft, actor));
    expect(heard.acts).toHaveLength(1);
    expect(heard.spoken).toEqual([]);
    // Nothing is destroyed twice: the body asked for no destroy of its own.
    expect(heard.destroyed).toEqual([]);
  });

  it('throws an engine error for an `act` in a body that decides', () => {
    const one = turn();
    const budget = new Budget(DEFAULT_LIMITS.budgets);
    expect(() =>
      runBody(body(one.draft, CAT, 'poke'), frameOf(one, CAT, budget), 'decide', null),
    ).toThrow(/`act` reached a body that decides/);
  });
});

describe('the two modes', () => {
  it('decides in a `permit`: a refusal with its words, or `allow`', () => {
    const one = turn();
    const decide = () =>
      runBody(
        body(one.draft, COUNTER, 'weigh', 'permit'),
        frameOf(one, COUNTER, new Budget(DEFAULT_LIMITS.budgets)),
        'decide',
        null,
      );
    expect(decide()).toBe('allow');
    // 1, then 3, 5 and 7.
    for (let times = 0; times < 3; times++) act(one, COUNTER, 'fill');
    expect(decide()).toMatchObject({ refused: { text: 'Too full.' } });
    // Words in quotes are a one-line passage, carried with the library
    // whose body said them, where a kind in their slots is read from.
    const refusal = decide();
    if (typeof refusal === 'string' || !('prose' in refusal.refused)) {
      return expect.unreachable('the `permit` refused with words in quotes');
    }
    expect(refusal.refused.library).toBe('shop');
    expect(refusal.refused.prose.pieces).toMatchObject([
      { kind: 'prose-words', text: 'Too full.' },
    ]);
  });

  it('says a passage its kind lacks, whose `.prose` file the world was loaded without, as absent', () => {
    const one = turn();
    const diagnostics = new Diagnostics();
    const said = parseStatement(new SourceFile('b.sprout', 'say gone'), diagnostics)!;
    const block: Block = { kind: 'block', at: said.at, statements: [said] };
    const heard: Spoken[] = [];
    const sink = { say: (spoken: Spoken) => heard.push(spoken) } as unknown as ActSink;
    runBody(block, frameOf(one, COUNTER, new Budget(DEFAULT_LIMITS.budgets)), 'act', sink);
    expect(heard.map((spoken) => spoken.said)).toEqual([{ absent: 'gone' }]);
  });

  it('throws an engine error for `text`, which only a `describe` gives', () => {
    const one = turn();
    const text = parseStatement(new SourceFile('b.sprout', 'text "Hi."'), new Diagnostics())!;
    const block: Block = { kind: 'block', at: text.at, statements: [text] };
    const sink = {} as ActSink;
    expect(() =>
      runBody(block, frameOf(one, COUNTER, new Budget(DEFAULT_LIMITS.budgets)), 'act', sink),
    ).toThrow('`text` reached a body');
  });

  it('throws an engine error, not a fault, for an effect in a body that decides', () => {
    const one = turn();
    const budget = new Budget(DEFAULT_LIMITS.budgets);
    for (const verb of ['fill', 'speak', 'craft', 'vanish', 'haul']) {
      expect(() =>
        runBody(body(one.draft, COUNTER, verb), frameOf(one, COUNTER, budget), 'decide', null),
      ).toThrow(/reached a body that decides/);
    }
    expect(property(one, COUNTER, 'n')).toBe(1);
  });

  it('throws an engine error for a refusal in a body that acts, and for acting with nowhere to act', () => {
    const one = turn();
    const budget = new Budget(DEFAULT_LIMITS.budgets);
    const permit = body(one.draft, COUNTER, 'weigh', 'permit');
    const sink = { lifecycle: {} } as ActSink;
    expect(() => runBody(permit, frameOf(one, COUNTER, budget), 'act', sink)).toThrow(
      /reached a `do`/,
    );
    expect(() =>
      runBody(body(one.draft, COUNTER, 'fill'), frameOf(one, COUNTER, budget), 'act', null),
    ).toThrow(/somewhere to put/);
  });
});

describe('what a `do` is charged', () => {
  it('charges a step for every statement and every node, a write as a reading is charged', () => {
    const one = turn();
    const budget = new Budget(DEFAULT_LIMITS.budgets);
    act(one, COUNTER, 'fill', budget);
    // `let a = 2`: 2. `self.set(:n, self.get(:n) + a)`: the statement,
    // `self`, the call and `:n`, then five for the value: 9.
    expect(budget.spentSteps).toBe(11);
  });

  it('charges a `say` as the statement it is', () => {
    const one = turn();
    const budget = new Budget(DEFAULT_LIMITS.budgets);
    act(one, COUNTER, 'speak', budget);
    // Two `say`s and a `let` with its literal.
    expect(budget.spentSteps).toBe(4);
  });

  it('charges a `move` as the statement and its two names; the move itself is the sink’s', () => {
    const one = turn();
    const budget = new Budget(DEFAULT_LIMITS.budgets);
    act(one, COUNTER, 'haul', budget);
    // Two `move`s of three each, and a `say`.
    expect(budget.spentSteps).toBe(7);
  });

  it('charges an `act` as the statement and each name it evaluates; the reading is the sink’s', () => {
    const one = turn();
    const budget = new Budget(DEFAULT_LIMITS.budgets);
    act(one, CAT, 'poke', budget);
    // The `act` and its two names, and a `say`.
    expect(budget.spentSteps).toBe(4);
  });
});

describe('what a `do` sends', () => {
  it('queues each send in body order, from `self`, down a path, with the value it carries', () => {
    const one = turn();
    const heard = act(one, COUNTER, 'ring');
    const authored = heard.sends.filter((sent) => sent.message === 'authored');
    expect(
      authored.slice(0, 3).map((sent) => [sent.recipient, sent.declared.name, sent.value]),
    ).toEqual([
      [PIN, 'knock', null],
      [CAT, 'tally', 1],
      [NEAR, 'knock', null],
    ]);
    expect(new Set(authored.map((sent) => sent.from))).toEqual(new Set([COUNTER]));
  });

  it('sends nothing to a target out of range, and broadcasts to what the walk reaches', () => {
    const one = turn();
    const to = act(one, COUNTER, 'ring').sends.map((sent) => sent.recipient);
    // The yard is another place, and the world passes nothing between places.
    expect(to).not.toContain(FAR);
    // The broadcast: what the counter holds, then the hall and what else it holds; never itself.
    const broadcast = to.slice(3);
    expect(broadcast[0]).toBe(PIN);
    expect(broadcast).toEqual(expect.arrayContaining([HALL, LOUD, CAT, NEAR]));
    expect(broadcast).not.toContain(COUNTER);
    expect(broadcast).not.toContain(WORLD_ID);
  });
});
