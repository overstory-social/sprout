import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { Bundle } from '../bundle/bundle.js';
import { DEFAULT_LIMITS } from '../bundle/limits.js';
import type { ResolvedVerb } from '../declare/verbs.js';
import { WORLD_PASSES_ANYTHING } from '../declare/world.js';
import { compiledWorld } from '../fixtures/bundle.js';
import { Budget } from './budget.js';
import { catalogueOf, type Catalogue } from './catalogue.js';
import { Draft } from './draft.js';
import { boundObject, IntegerOverflow } from './evaluate.js';
import { declaredId, type InstanceId } from './ids.js';
import { initialState } from './load.js';
import { MoveFault } from './move.js';
import {
  consentPass,
  effectPass,
  participantsOf,
  runReading,
  type Acted,
  type Bound,
  type PermitRefusal,
  type Reading,
  type ReadingContext,
  type ReadingOutcome,
  type Said,
} from './reading.js';
import { newInstance, readerOf } from './state.js';
import type { Value } from './values.js';
import { SproutList } from './lists.js';

const CAPS = DEFAULT_LIMITS.caps;

/**
 * A yard whose hall holds a player of each part a reading has. `Both`
 * composes `First` and `Second`, each playing the target of `order`, and
 * adds its own; every `permit` refuses when its flag is set, and every
 * `do` says who it is. The world holds things and not actors.
 */
const YARD = compiledWorld('yard', {
  'world.sprout': [
    'world yard is sprout.World { contains visitors are Person visitors arrive at hall',
    '  object hall is Room {',
    '    object both is Both',
    '    object tool is Tool',
    '    object w1 is Weight',
    '    object w2 is Weight',
    '    object trip is Tripwire',
    '    object stone is Plain',
    '    object guard is Guard',
    '    object dial is Dial',
    '    object safe is Safe',
    '    object lock is Lock',
    '    object key is Key',
    '    object bubble is Bubble {',
    '      object bead is Plain',
    '    }',
    '    object glass is Glued',
    '    object cat is Person',
    '    object dog is Person',
    '    object basket is Basket',
    '    object wardrobe is Room',
    '  }',
    '}',
    'enum Topic { bridge, toll, weather }',
    'kind Room { contains actors }',
    'kind Basket { contains }',
    'kind Plain { }',
    'kind Key { }',
    'verb order {',
    '  role target  role tool  role weights many',
    '  "order [target] with [tool] using [weights]"  "order [target] using [weights]"  "order [target]"',
    '}',
    'verb nudge { role target  "nudge [target]" }',
    'verb nod { role target  "nod at [target]" }',
    'verb unlock { role target  role tool  "unlock [target] with [tool]"  "unlock [target]" }',
    'verb dial { role target  role number: integer  "turn [target] to [number]" }',
    'verb pop { role target  role tool  "pop [target] with [tool]"  "pop [target]" }',
    'kind Person is sprout.Actor {',
    '  :balks false',
    '  :log 0 min 0 max 99',
    '  as actor for order {',
    '    permit { if (self.get(:balks)) { refuse "The actor balks." } }',
    '    do     { self.adjust(:log, 1)  say "actor" }',
    '  }',
    '  as actor for ask { do { say "You ask." } }',
    '  as target for nudge { do { say "nudged" } }',
    '}',
    'kind First  { :a false  as target for order { permit { if (self.get(:a)) { refuse "First balks." } }  do { say "first" } } }',
    'kind Second { :b false  as target for order { permit { if (self.get(:b)) { refuse "Second balks." } } do { say "second" } } }',
    'kind Both is First, Second { :c false  as target for order { permit { if (self.get(:c)) { refuse "Both balks." } }  do { say "both" } } }',
    'kind Tool { :t false  as tool for order { permit { if (self.get(:t)) { refuse "The tool balks." } } do { say "tool" } } }',
    'kind Weight { as weights for order { do { say "weight" } } }',
    'kind Tripwire { as tool for order { permit { if (2147483647 + 1 > 0) { allow } } } }',
    'kind Guard {',
    '  :knows [Topic] default [bridge, toll]',
    '  as target for ask {',
    '    topic from :knows',
    '    do { if (bound topic) { say "bound" } else { say "unbound" } }',
    '  }',
    '}',
    'kind Dial {',
    '  as target for dial { number from 1 to 12  do { if (bound number) { say "bound" } else { say "unbound" } } }',
    '}',
    'kind Safe {',
    '  :combo 0 min 0 max 99',
    '  as target for dial { number from :combo  do { if (bound number) { say "bound" } else { say "unbound" } } }',
    '}',
    'kind Lock {',
    '  as target for unlock {',
    '    permit {',
    '      if (bound tool) { if (!tool.is(Key)) { refuse "{tool} is not a key." } }',
    '      else { refuse "You need something to turn the lock with." }',
    '    }',
    '    do { say "unlocked" }',
    '  }',
    '}',
    'kind Bubble {',
    '  contains',
    '  as target for pop { do { destroy self  say "pop" } }',
    '  as tool for pop   { do { say "tool pop" } }',
    '}',
    'kind Glued is Bubble { :n 0 min 0 max 9  as target for pop { do { self.adjust(:n, 1)  say "glued" } } }',
    '',
  ].join('\n'),
});

const at = (...path: string[]): InstanceId => declaredId('yard', path);
const WORLD_ID = at();
const HALL = at('hall');
const BOTH = at('hall', 'both');
const TOOL = at('hall', 'tool');
const W1 = at('hall', 'w1');
const W2 = at('hall', 'w2');
const TRIP = at('hall', 'trip');
const STONE = at('hall', 'stone');
const GUARD = at('hall', 'guard');
const DIAL = at('hall', 'dial');
const SAFE = at('hall', 'safe');
const LOCK = at('hall', 'lock');
const KEY = at('hall', 'key');
const BUBBLE = at('hall', 'bubble');
const BEAD = at('hall', 'bubble', 'bead');
const GLASS = at('hall', 'glass');
const CAT = at('hall', 'cat');
const DOG = at('hall', 'dog');
const BASKET = at('hall', 'basket');
const WARDROBE = at('hall', 'wardrobe');

interface Turn {
  readonly draft: Draft;
  readonly catalogue: Catalogue;
  readonly budget: Budget;
  /** Visitors, by the order they arrived. */
  readonly people: InstanceId[];
}

/** A fresh turn over `bundle` as declared, with a visitor standing in each place given. */
function turn(bundle: Bundle, where: readonly InstanceId[], budget?: Budget): Turn {
  const catalogue = catalogueOf(bundle, CAPS);
  const draft = new Draft(initialState(catalogue));
  const people = where.map((place) => {
    const visitor = newInstance(
      draft.mint(),
      { from: 'visitor' },
      catalogue.visitorKind!,
      place,
      draft.nextSerial(),
      CAPS,
    );
    draft.add(visitor);
    return visitor.id;
  });
  return { draft, catalogue, budget: budget ?? new Budget(DEFAULT_LIMITS.budgets), people };
}

function contextOf(one: Turn): ReadingContext {
  return {
    draft: one.draft,
    catalogue: one.catalogue,
    passes: (container) => (container === one.draft.world ? WORLD_PASSES_ANYTHING : true),
    budget: one.budget,
    mayHold: null,
  };
}

function verbOf(bundle: Bundle, library: string, name: string): ResolvedVerb {
  const verb = bundle.verbs.qualified(library, name);
  if (verb === null) throw new Error(`no verb ${library}.${name}`);
  return verb;
}

function reading(
  bundle: Bundle,
  verb: string,
  actor: InstanceId,
  bindings: Record<string, Bound>,
  library = bundle.manifest.name,
): Reading {
  return {
    verb: verbOf(bundle, library, verb),
    actor,
    bindings: new Map(Object.entries(bindings)),
  };
}

/** Write `values` onto `id`'s properties in the turn's draft. */
function setOn(one: Turn, id: InstanceId, values: Record<string, Value>): void {
  const instance = one.draft.instance(id)!;
  one.draft.write({
    ...instance,
    properties: new Map([...instance.properties, ...Object.entries(values)]),
  });
}

/** What a line said: the quoted words, or a passage's origin, name and words. */
function words(said: PermitRefusal['said']): string {
  if ('text' in said) return said.text;
  return `${said.passage.origin} ${said.passage.name}: ${said.passage.body.text.trim()}`;
}

const lines = (acted: Acted): [InstanceId, string][] =>
  acted.said.map((line: Said) => [line.by, words(line.said)]);

function acted(outcome: ReadingOutcome): Acted {
  if ('refused' in outcome) throw new Error(`refused: ${words(outcome.refused.said)}`);
  return outcome;
}

function refused(outcome: ReadingOutcome): PermitRefusal {
  if (!('refused' in outcome)) throw new Error('the reading was not refused');
  return outcome.refused;
}

const NOTHING = 'sprout.World nothing_happens: Nothing much comes of that.';

describe('who takes part, and in what order', () => {
  it('is the actor, then the roles as the verb declares them, a set in the order typed', () => {
    const one = turn(YARD, [HALL]);
    const [visitor] = one.people;
    const order = reading(YARD, 'order', visitor!, {
      target: { object: BOTH },
      tool: { object: TOOL },
      weights: { set: [W2, W1] },
    });
    expect(participantsOf(order)).toEqual([
      { id: visitor, role: 'actor' },
      { id: BOTH, role: 'target' },
      { id: TOOL, role: 'tool' },
      { id: W2, role: 'weights' },
      { id: W1, role: 'weights' },
    ]);
  });

  it('leaves out a tool the command left out, and a value role, which nothing plays', () => {
    const one = turn(YARD, [HALL]);
    const [visitor] = one.people;
    const bare = reading(YARD, 'order', visitor!, { target: { object: BOTH } });
    expect(participantsOf(bare).map((p) => p.id)).toEqual([visitor, BOTH]);
    const ask = reading(
      YARD,
      'ask',
      visitor!,
      { target: { object: GUARD }, topic: { value: 'toll' } },
      'sprout',
    );
    expect(participantsOf(ask).map((p) => p.id)).toEqual([visitor, GUARD]);
  });

  it('runs every `do` in that order, each kind composed before its composer', () => {
    const one = turn(YARD, [HALL]);
    const [visitor] = one.people;
    const order = reading(YARD, 'order', visitor!, {
      target: { object: BOTH },
      tool: { object: TOOL },
      weights: { set: [W2, W1] },
    });
    expect(lines(acted(runReading(order, contextOf(one))))).toEqual([
      [visitor, 'actor'],
      [BOTH, 'first'],
      [BOTH, 'second'],
      [BOTH, 'both'],
      [TOOL, 'tool'],
      [W2, 'weight'],
      [W1, 'weight'],
    ]);
    // A participant with no `permit` consented: the weights wrote none.
    expect(one.draft.instance(visitor!)!.properties.get('log')).toBe(1);
  });

  it('refuses at the first `permit` to refuse, in the same order', () => {
    const one = turn(YARD, [HALL]);
    const [visitor] = one.people;
    const order = reading(YARD, 'order', visitor!, {
      target: { object: BOTH },
      tool: { object: TOOL },
    });
    const first = () => words(refused(runReading(order, contextOf(one))).said);
    setOn(one, TOOL, { t: true });
    expect(first()).toBe('The tool balks.');
    setOn(one, BOTH, { c: true });
    expect(first()).toBe('Both balks.');
    setOn(one, BOTH, { b: true });
    expect(first()).toBe('Second balks.');
    setOn(one, BOTH, { a: true });
    expect(first()).toBe('First balks.');
    setOn(one, visitor!, { balks: true });
    const refusal = refused(runReading(order, contextOf(one)));
    expect(refusal).toMatchObject({
      by: visitor,
      role: 'actor',
      origin: 'yard.Person',
      said: { text: 'The actor balks.' },
    });
    // What the refusing play saw, for its slots: every role, a set left out as empty.
    expect([...refusal.bindings.keys()]).toEqual(['actor', 'here', 'target', 'tool', 'weights']);
  });
});

describe('the consent pass', () => {
  it('is the whole outcome when it refuses: no `do` runs and nothing is said or sent', () => {
    const one = turn(YARD, [HALL]);
    const [visitor] = one.people;
    setOn(one, TOOL, { t: true });
    const order = reading(YARD, 'order', visitor!, {
      target: { object: BOTH },
      tool: { object: TOOL },
    });
    const outcome = runReading(order, contextOf(one));
    expect(Object.keys(outcome)).toEqual(['refused']);
    expect(one.draft.instance(visitor!)!.properties.get('log')).toBe(0);
  });

  it('stops at the refusal: a later `permit` that would fault is never reached', () => {
    const order = (visitor: InstanceId) =>
      reading(YARD, 'order', visitor, { target: { object: BOTH }, tool: { object: TRIP } });
    const faulting = turn(YARD, [HALL]);
    expect(() => runReading(order(faulting.people[0]!), contextOf(faulting))).toThrow(
      IntegerOverflow,
    );

    const one = turn(YARD, [HALL]);
    setOn(one, BOTH, { c: true });
    expect(words(refused(runReading(order(one.people[0]!), contextOf(one))).said)).toBe(
      'Both balks.',
    );
    // Four `permit`s of four steps each (`if`, `self`, `get`, `:p`), and the `refuse`.
    expect(one.budget.spentSteps).toBe(17);
  });

  it('reads only, so it may be asked of committed state alone', () => {
    const one = turn(YARD, [HALL]);
    const [visitor] = one.people;
    const { state } = one.draft.commit();
    const order = reading(YARD, 'order', visitor!, { target: { object: BOTH } });
    expect(
      consentPass(order, { state: readerOf(state), catalogue: one.catalogue, budget: one.budget }),
    ).toBeNull();
  });

  it('reads an optional tool only once `bound` says the command named one', () => {
    const one = turn(YARD, [HALL]);
    const [visitor] = one.people;
    const unlock = (tool?: InstanceId) =>
      runReading(
        reading(YARD, 'unlock', visitor!, {
          target: { object: LOCK },
          ...(tool === undefined ? {} : { tool: { object: tool } }),
        }),
        contextOf(one),
      );
    expect(words(refused(unlock()).said)).toBe('You need something to turn the lock with.');
    const stone = refused(unlock(STONE));
    expect(words(stone.said)).toBe('{tool} is not a key.');
    expect(lines(acted(unlock(KEY)))).toEqual([[LOCK, 'unlocked']]);
  });
});

describe('a value role, as each role-player hears it', () => {
  it('binds for the player whose `from` holds the option, and not for one that wrote none', () => {
    const one = turn(YARD, [HALL]);
    const [visitor] = one.people;
    const ask = (topic: string) =>
      acted(
        runReading(
          reading(
            YARD,
            'ask',
            visitor!,
            { target: { object: GUARD }, topic: { value: topic } },
            'sprout',
          ),
          contextOf(one),
        ),
      );
    const toll = ask('toll');
    expect(lines(toll)).toEqual([
      [visitor, 'You ask.'],
      [GUARD, 'bound'],
    ]);
    expect(toll.said[0]!.bindings.has('topic')).toBe(false);
    expect(toll.said[1]!.bindings.get('topic')).toEqual({ binds: 'value', value: 'toll' });
    expect(lines(ask('weather'))[1]).toEqual([GUARD, 'unbound']);
  });

  it('reads the options from the role-player as it stands now', () => {
    const one = turn(YARD, [HALL]);
    const [visitor] = one.people;
    const knows = one.draft.instance(GUARD)!.properties.get('knows') as SproutList;
    setOn(one, GUARD, { knows: knows.add('weather') });
    const said = acted(
      runReading(
        reading(
          YARD,
          'ask',
          visitor!,
          { target: { object: GUARD }, topic: { value: 'weather' } },
          'sprout',
        ),
        contextOf(one),
      ),
    );
    expect(lines(said)[1]).toEqual([GUARD, 'bound']);
  });

  it('binds a number within the range written, or within the property’s range', () => {
    const one = turn(YARD, [HALL]);
    const [visitor] = one.people;
    const dial = (target: InstanceId, number: number) =>
      lines(
        acted(
          runReading(
            reading(YARD, 'dial', visitor!, {
              target: { object: target },
              number: { value: number },
            }),
            contextOf(one),
          ),
        ),
      )[0]![1];
    expect([dial(DIAL, 1), dial(DIAL, 12), dial(DIAL, 0), dial(DIAL, 13)]).toEqual([
      'bound',
      'bound',
      'unbound',
      'unbound',
    ]);
    expect([dial(SAFE, 0), dial(SAFE, 99), dial(SAFE, 100)]).toEqual(['bound', 'bound', 'unbound']);
  });
});

describe('the effect pass', () => {
  it('answers with the world’s `nothing_happens` when nothing was said to the actor', () => {
    const one = turn(YARD, [HALL]);
    const [visitor] = one.people;
    const said = acted(
      runReading(reading(YARD, 'nod', visitor!, { target: { object: STONE } }), contextOf(one)),
    );
    expect(lines(said)).toEqual([[WORLD_ID, NOTHING]]);
    expect(said.said[0]).toMatchObject({ to: [visitor], speaker: null });
  });

  it('does not when something was', () => {
    const one = turn(YARD, [HALL]);
    const [visitor] = one.people;
    const said = acted(
      runReading(reading(YARD, 'nudge', visitor!, { target: { object: DOG } }), contextOf(one)),
    );
    expect(lines(said)).toEqual([[DOG, 'nudged']]);
    expect(said.said[0]).toMatchObject({ to: [visitor], speaker: null });
  });

  it('may run alone, having polled consent apart', () => {
    const one = turn(YARD, [HALL]);
    const [visitor] = one.people;
    const nod = reading(YARD, 'nod', visitor!, { target: { object: STONE } });
    expect(
      consentPass(nod, { state: one.draft, catalogue: one.catalogue, budget: one.budget }),
    ).toBeNull();
    expect(lines(effectPass(nod, contextOf(one)))).toEqual([[WORLD_ID, NOTHING]]);
  });

  it('hands on everything a destroy removed, sends nothing for it, and a participant destroyed does nothing more', () => {
    const one = turn(YARD, [HALL]);
    const [visitor] = one.people;
    const said = acted(
      runReading(
        reading(YARD, 'pop', visitor!, { target: { object: BUBBLE }, tool: { object: BUBBLE } }),
        contextOf(one),
      ),
    );
    // The bubble played the target, and was gone before it could play the tool.
    expect(lines(said)).toEqual([[BUBBLE, 'pop']]);
    // What it held went with it, and the queue drops everything pending on each.
    expect(said.destroyed).toEqual([BUBBLE, BEAD]);
    expect(said.sends).toEqual([]);
    expect(one.draft.instance(BEAD)).toBeUndefined();
  });

  it('runs none of a participant’s later composed plays once one of them destroyed it', () => {
    const one = turn(YARD, [HALL]);
    const [visitor] = one.people;
    const said = acted(
      runReading(reading(YARD, 'pop', visitor!, { target: { object: GLASS } }), contextOf(one)),
    );
    // `Bubble`'s play runs first and destroys the glass; `Glued`'s own, which
    // would write to it, does not run, so nothing is said of glue.
    expect(lines(said)).toEqual([[GLASS, 'pop']]);
    expect(said.destroyed).toEqual([GLASS]);
  });
});

describe('where the actor is', () => {
  const hereOf = (actor: InstanceId, one: Turn) =>
    acted(
      runReading(reading(YARD, 'nudge', actor, { target: { object: DOG } }), contextOf(one)),
    ).said[0]!.bindings.get('here');

  it('is its container, which holds actors, a place inside a place included', () => {
    const one = turn(YARD, [HALL, WARDROBE]);
    expect(hereOf(one.people[0]!, one)).toEqual({ binds: 'object', id: HALL });
    expect(hereOf(one.people[1]!, one)).toEqual({ binds: 'object', id: WARDROBE });
    expect(hereOf(CAT, one)).toEqual({ binds: 'object', id: HALL });
  });

  it('is an engine error for an actor in something that holds no actors, which nothing makes', () => {
    const one = turn(YARD, []);
    one.draft.place(CAT, BASKET);
    expect(() => hereOf(CAT, one)).toThrow(
      `\`${CAT}\` is in \`${BASKET}\`, which holds no actors.`,
    );
  });
});

describe('an NPC acting', () => {
  it('says its lines to whoever would hear its `tell`, the participants left out', () => {
    const one = turn(YARD, [HALL, HALL]);
    const [marta, ivo] = one.people;
    const said = acted(
      runReading(reading(YARD, 'nudge', CAT, { target: { object: marta! } }), contextOf(one)),
    );
    expect(said.said).toHaveLength(1);
    // The actors directly in the hall in contents order: the dog, then Ivo.
    expect(said.said[0]).toMatchObject({ to: [DOG, ivo], by: marta, speaker: CAT });
  });

  it('has no output where its reading said nothing, since nobody is behind it to answer', () => {
    const one = turn(YARD, [HALL]);
    const said = acted(
      runReading(reading(YARD, 'nod', CAT, { target: { object: STONE } }), contextOf(one)),
    );
    expect(said.said).toEqual([]);
  });
});

/**
 * A depot whose things move in their `do`s. The walker boards a cart by
 * moving itself; the cart grabs the actor, which `sprout.Actor`'s
 * `depart` refuses since the mover is the cart, and folds into itself,
 * which the engine refuses; the crate packs a new sheet into the actor's
 * hands, and scraps itself after moving to where the actor stands; a
 * pin moves itself into whatever it pins, which holds nothing.
 */
const DEPOT = compiledWorld('depot', {
  'world.sprout': [
    'world depot is sprout.World { contains visitors are Walker visitors arrive at yard',
    '  object yard is sprout.Place {',
    '    object cart is Cart',
    '    object crate is Crate',
    '    object pin is Pin',
    '    object plain is Plain',
    '    object cat is Walker',
    '  }',
    '}',
    'verb board { role target  "board [target]" }',
    'verb grab  { role target  "grab at [target]" }',
    'verb fold  { role target  "fold [target]" }',
    'verb pack  { role target  "pack [target]" }',
    'verb scrap { role target  "scrap [target]" }',
    'verb fix   { role target  role tool  "fix [target] with [tool]" }',
    'kind Walker is sprout.Actor { as actor for board { do { move self to target } } }',
    'kind Cart is sprout.Place {',
    '  as target for grab { do { move actor to self  say "after" } }',
    '  as target for fold { do { move self to self } }',
    '}',
    'kind Sheet { }',
    'kind Plain { }',
    'kind Crate {',
    '  contains',
    '  as target for pack  { do { let sheet = spawn Sheet in self  move sheet to actor  say "packed" } }',
    '  as target for scrap { do { move self to here  destroy self } }',
    '}',
    'kind Pin { as tool for fix { do { move self to target } } }',
    '',
  ].join('\n'),
});

describe('a `move` in a `do`', () => {
  const at = (...path: string[]): InstanceId => declaredId('depot', path);
  const YARD_ID = at();
  const [CART, CRATE, PIN, PLAIN, CAT_ID] = ['cart', 'crate', 'pin', 'plain', 'cat'].map((name) =>
    at('yard', name),
  );
  const run = (one: Turn, verb: string, actor: InstanceId, bindings: Record<string, Bound>) =>
    acted(runReading(reading(DEPOT, verb, actor, bindings), contextOf(one)));

  it('moves, and hands on the three messages and what the places speak', () => {
    const one = turn(DEPOT, [at('yard')]);
    const [visitor] = one.people;
    const done = run(one, 'board', visitor!, { target: { object: CART! } });
    expect(one.draft.instance(visitor!)!.container).toBe(CART);
    expect(done.sends).toEqual([
      { message: 'left', recipient: at('yard'), item: visitor, to: CART },
      { message: 'entered', recipient: CART, item: visitor, from: at('yard') },
      { message: 'moved', recipient: visitor, from: at('yard'), to: CART },
    ]);
    expect(done.notices.map((notice) => [notice.notice, notice.place, notice.audience])).toEqual([
      ['leaves', at('yard'), [CAT_ID]],
      ['arrives', CART, []],
      ['described', CART, [visitor]],
    ]);
    // Nothing was said, so the world answers.
    expect(lines(done)).toEqual([[YARD_ID, NOTHING]]);
  });

  it('says a guard’s refusal to the actor, from the refusing party, and the body goes on', () => {
    const one = turn(DEPOT, [at('yard')]);
    const [visitor] = one.people;
    const done = run(one, 'grab', visitor!, { target: { object: CART! } });
    expect(one.draft.instance(visitor!)!.container).toBe(at('yard'));
    expect(done.said.map((line) => [line.effect, line.by, words(line.said)])).toEqual([
      ['refused', visitor, 'sprout.Actor held_fast: {self} is not something you can carry off.'],
      ['said', CART, 'after'],
    ]);
    // The mover is the object whose body ran the `move`, not the actor.
    expect(done.said[0]!.bindings).toEqual(
      new Map([
        ['mover', boundObject(CART!)],
        ['to', boundObject(CART!)],
      ]),
    );
    expect(done.said[0]!.to).toEqual([visitor]);
    expect(done.sends).toEqual([]);
  });

  it('says the engine’s own refusal from the world, and counts it as said to the actor', () => {
    const one = turn(DEPOT, [at('yard')]);
    const [visitor] = one.people;
    const done = run(one, 'fold', visitor!, { target: { object: CART! } });
    expect(done.said).toEqual([
      {
        effect: 'refused',
        to: [visitor],
        by: YARD_ID,
        speaker: null,
        said: { text: 'cart cannot go inside itself.' },
        bindings: new Map(),
      },
    ]);
  });

  it('keeps what a body spawns, moves and says in the order it did them', () => {
    const one = turn(DEPOT, [at('yard')]);
    const [visitor] = one.people;
    const done = run(one, 'pack', visitor!, { target: { object: CRATE! } });
    const sheet = done.sends[1]!.recipient;
    expect(done.sends.map((send) => [send.message, send.recipient])).toEqual([
      ['entered', CRATE],
      ['spawned', sheet],
      ['left', CRATE],
      ['entered', visitor],
      ['moved', sheet],
    ]);
    expect(one.draft.children(visitor!)).toEqual([sheet]);
    expect(lines(done)).toEqual([[CRATE, 'packed']]);
  });

  it('moves `self` before a `destroy self` in the same body takes effect at its end', () => {
    const one = turn(DEPOT, [at('yard')]);
    const [visitor] = one.people;
    const done = run(one, 'scrap', visitor!, { target: { object: CRATE! } });
    expect(done.destroyed).toEqual([CRATE]);
    expect(done.sends.map((send) => send.message)).toEqual(['left', 'entered', 'moved']);
    expect(one.draft.destroyed(CRATE!)!.container).toBe(at('yard'));
  });

  it('faults where the destination holds nothing, which the compiler could not tell', () => {
    const one = turn(DEPOT, [at('yard')]);
    const [visitor] = one.people;
    const bindings = { target: { object: PLAIN! }, tool: { object: PIN! } };
    expect(() => run(one, 'fix', visitor!, bindings)).toThrow(MoveFault);
  });

  it('says an NPC’s refused move to whoever would hear its `tell`, from it', () => {
    const one = turn(DEPOT, [at('yard')]);
    const [marta] = one.people;
    const done = run(one, 'grab', CAT_ID!, { target: { object: CART! } });
    expect(done.said[0]).toMatchObject({
      effect: 'refused',
      by: CAT_ID,
      to: [marta],
      speaker: CAT_ID,
    });
  });
});

describe('the corpus world `good/roles`', () => {
  const folder = join(dirname(fileURLToPath(import.meta.url)), '../../../../corpus/good/roles');
  const ROLES = compiledWorld('roles', {
    'world.sprout': readFileSync(join(folder, 'world.sprout'), 'utf8'),
    'kinds.sprout': readFileSync(join(folder, 'kinds.sprout'), 'utf8'),
  });
  const ROLES_HALL = declaredId('roles', ['hall']);
  const thing = (name: string): InstanceId => declaredId('roles', ['hall', name]);
  const [LEVER, DOOR, GATE, CORPUS_KEY, CORPUS_GUARD] = [
    'lever',
    'door',
    'gate',
    'key',
    'guard',
  ].map(thing);
  const play = (one: Turn, verb: string, bindings: Record<string, Bound>, library = 'roles') =>
    runReading(reading(ROLES, verb, one.people[0]!, bindings, library), contextOf(one));
  const held = (one: Turn, id: InstanceId, name: string) =>
    one.draft.instance(id)!.properties.get(name);

  it('pulls the lever once, saying its passage, and refuses the second pull in its words', () => {
    const one = turn(ROLES, [ROLES_HALL]);
    expect(lines(acted(play(one, 'pull', { target: { object: LEVER! } })))).toEqual([
      [LEVER, 'roles.Lever clunk: The lever drops with a clunk.'],
    ]);
    expect(held(one, LEVER!, 'pulled')).toBe(true);
    expect(refused(play(one, 'pull', { target: { object: LEVER! } }))).toMatchObject({
      by: LEVER,
      role: 'target',
      origin: 'roles.Lever',
      said: { text: 'It is already down.' },
    });
  });

  it('asks the actor first: full hands refuse before the lever is asked', () => {
    const one = turn(ROLES, [ROLES_HALL]);
    setOn(one, one.people[0]!, { capacity: 0 });
    expect(refused(play(one, 'pull', { target: { object: LEVER! } }))).toMatchObject({
      by: one.people[0],
      role: 'actor',
      said: { text: 'Your hands are full.' },
    });
  });

  it('unlocks the warded door with the key, both locks consenting and the key worn', () => {
    const one = turn(ROLES, [ROLES_HALL]);
    const unlock = (tool?: InstanceId) =>
      play(one, 'unlock', {
        target: { object: DOOR! },
        ...(tool === undefined ? {} : { tool: { object: tool } }),
      });
    expect(words(refused(unlock()).said)).toBe('You need something to turn the lock with.');
    expect(lines(acted(unlock(CORPUS_KEY)))).toEqual([[DOOR, 'The lock turns over.']]);
    expect([held(one, DOOR!, 'locked'), held(one, CORPUS_KEY!, 'wear')]).toEqual([false, 1]);
    // `Lockable`'s refusal is asked before the ward's.
    expect(refused(unlock(CORPUS_KEY))).toMatchObject({
      origin: 'roles.Lockable',
      said: { text: 'It is already unlocked.' },
    });
  });

  it('leaves out what `without` leaves out: the rusted gate neither refuses nor turns', () => {
    const one = turn(ROLES, [ROLES_HALL]);
    setOn(one, GATE!, { locked: false });
    const said = acted(
      play(one, 'unlock', { target: { object: GATE! }, tool: { object: CORPUS_KEY! } }),
    );
    // `Lockable`'s "already unlocked" and its bolt are gone; the ward ran,
    // the key wore, and nothing was said to the actor.
    expect(lines(said)).toEqual([[declaredId('roles', []), NOTHING]]);
    expect(held(one, CORPUS_KEY!, 'wear')).toBe(1);
  });

  it('asks the guard about a topic it knows, and about one it does not', () => {
    const one = turn(ROLES, [ROLES_HALL]);
    const ask = (topic: string) =>
      lines(
        acted(
          play(
            one,
            'ask',
            { target: { object: CORPUS_GUARD! }, topic: { value: topic } },
            'sprout',
          ),
        ),
      );
    expect(ask('toll')).toEqual([
      [CORPUS_GUARD, 'roles.Guard toll_speech: Two coppers to cross, and no haggling.'],
    ]);
    expect(ask('weather')).toEqual([[CORPUS_GUARD, 'The guard has nothing to say about that.']]);
  });
});
