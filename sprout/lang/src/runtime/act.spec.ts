import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { WORLD_PASSES_ANYTHING } from '../declare/world.js';
import { compiledWorld } from '../fixtures/bundle.js';
import { ActFault, readingOfAct, type Performed } from './act.js';
import { Budget, BudgetExhausted } from './budget.js';
import { catalogueOf } from './catalogue.js';
import { Draft } from './draft.js';
import { boundObject, boundValue, type Evaluated } from './evaluate.js';
import { declaredId, type InstanceId } from './ids.js';
import { destroyInstance } from './lifecycle.js';
import { initialState } from './load.js';
import {
  runReading,
  type Acted,
  type Bound,
  type ReadingContext,
  type ReadingOutcome,
  type Said,
} from './reading.js';
import { newInstance } from './state.js';
import { Draws } from './draws.js';

const CAPS = DEFAULT_LIMITS.caps;

/**
 * A den where a cat acts. Each verb a visitor does to the cat has the
 * cat perform another: one it plays itself, one the visitor refuses, one
 * that plays nothing, one that destroys the cat, one that performs itself
 * again, and one that spawns. The mouse is in a sealed box, out of the
 * cat's range; a person waves by performing a bow.
 */
const DEN = compiledWorld('den', {
  'den.sprout': [
    'world den is sprout.World { contains visitors are Person visitors arrive at hall',
    '  object hall is Room {',
    '    object cat is Cat',
    '    object dog is Creature',
    '    object box is Box {',
    '      object mouse is Yarn',
    '    }',
    '  }',
    '}',
    'enum Mood { calm, cross }',
    'kind Room { contains actors }',
    'kind Yarn { }',
    'kind Box { contains }',
    'verb pet    { role target  "pet [target]" }',
    'verb tease  { role target  "tease [target]" }',
    'verb ignore { role target  "ignore [target]" }',
    'verb scare  { role target  "scare [target]" }',
    'verb spin   { role target  "spin [target]" }',
    'verb knit   { role target  "knit [target]" }',
    'verb chase  { role target  role prey  "chase [target] after [prey]" }',
    'verb nuzzle { role target  role toys many  "nuzzle [target] with [toys]" }',
    'verb swat   { role target  "swat [target]" }',
    'verb yawn   { "yawn" }',
    'verb fade   { "fade" }',
    'verb purl   { "purl" }',
    'verb hiss   { role target  role mood: symbol  "hiss at [target] [mood]" }',
    'verb wave   { "wave" }',
    'verb bow    { "bow" }',
    'verb shrug  { "shrug" }',
    'kind Creature is sprout.Actor {',
    '  as target for swat { permit { refuse "You pull your hand away." } }',
    '  as actor for wave  { do { act bow () } }',
    '  as actor for bow   { do { say "You bow." } }',
    '  as actor for shrug { do { act yawn () } }',
    '}',
    'kind Person is Creature, sprout.Visitor { }',
    'kind Cat is Creature {',
    '  :spins 0 min 0 max 99',
    '  :moods [Mood] default [cross]',
    '  as actor for nuzzle { do { say "purr" } }',
    '  as actor for fade   { do { destroy self } }',
    '  as actor for purl   { do { spawn Yarn in self } }',
    '  as target for hiss  { mood from :moods  do { if (bound mood) { say "hiss" } } }',
    '  as target for pet    { do { act nuzzle (target: actor, toys: actor)  say "after" } }',
    '  as target for tease  { do { self.adjust(:spins, 1)  act swat (target: actor)  say "never" } }',
    '  as target for ignore { do { act yawn () } }',
    '  as target for scare  { do { act fade ()  say "never" } }',
    '  as target for spin   { do { self.adjust(:spins, 1)  act spin (target: self) } }',
    '  as target for knit   { do { spawn Yarn in self  act purl () } }',
    '  as target for chase  { do { act nuzzle (target: prey) } }',
    '}',
    '',
  ].join('\n'),
});

const at = (...path: string[]): InstanceId => declaredId('den', path);
const WORLD_ID = at();
const HALL = at('hall');
const CAT = at('hall', 'cat');
const DOG = at('hall', 'dog');
const MOUSE = at('hall', 'box', 'mouse');

interface Turn {
  readonly context: ReadingContext;
  readonly people: InstanceId[];
}

/** A fresh turn with `people` visitors in the hall; the box passes nothing, and the world anything. */
function turn(people = 1, budget = new Budget(DEFAULT_LIMITS.budgets)): Turn {
  const catalogue = catalogueOf(DEN, CAPS);
  const draft = new Draft(initialState(catalogue));
  const ids = Array.from({ length: people }, () => {
    const visitor = newInstance(
      draft.mint(),
      { from: 'visitor' },
      catalogue.visitorKind!,
      HALL,
      draft.nextSerial(),
      CAPS,
    );
    draft.add(visitor);
    return visitor.id;
  });
  const passes = (container: InstanceId) =>
    container === WORLD_ID ? WORLD_PASSES_ANYTHING : container !== at('hall', 'box');
  return {
    context: { draft, catalogue, passes, budget, draws: new Draws(7), mayHold: null, now: 0 },
    people: ids,
  };
}

/** A visitor's typed command, run: `verb` done to the cat, or to nothing. */
function typed(
  one: Turn,
  verb: string,
  bindings: Record<string, Bound> = { target: { object: CAT } },
): ReadingOutcome {
  const found = DEN.verbs.qualified('den', verb)!;
  return runReading(
    { verb: found, actor: one.people[0]!, bindings: new Map(Object.entries(bindings)) },
    one.context,
  );
}

function acted(outcome: ReadingOutcome): Acted {
  if ('refused' in outcome) throw new Error('the reading was refused');
  return outcome;
}

/** Each line as what it is, who said it, to whom, from whom, and its words. */
const lines = (acted: Acted) =>
  acted.said.map((line: Said) => ({
    effect: line.effect,
    by: line.by,
    to: line.to,
    speaker: line.speaker,
    words:
      'text' in line.said
        ? line.said.text
        : 'absent' in line.said
          ? `absent ${line.said.absent}`
          : `${line.said.passage.origin} ${line.said.passage.name}`,
  }));

const performed = (verb: string, roles: Record<string, Evaluated>): Performed => ({
  verb,
  library: 'den',
  roles: new Map(Object.entries(roles)),
});

describe('the reading an `act` builds', () => {
  it('has `self` as the actor and each role filled as it takes it, one thing standing for a set of one', () => {
    const one = turn();
    const [marta] = one.people;
    const reading = readingOfAct(
      performed('nuzzle', { target: boundObject(marta!), toys: boundObject(DOG) }),
      CAT,
      one.context,
    );
    expect(reading.verb.name).toBe('nuzzle');
    expect(reading.actor).toBe(CAT);
    expect(reading.bindings).toEqual(
      new Map<string, Bound>([
        ['target', { object: marta! }],
        ['toys', { set: [DOG] }],
      ]),
    );
    const hiss = readingOfAct(
      performed('hiss', { target: boundObject(DOG), mood: boundValue('calm') }),
      CAT,
      one.context,
    );
    expect(hiss.bindings.get('mood')).toEqual({ value: 'calm' });
  });

  it('faults where a thing it names is out of the actor’s range, or no longer live', () => {
    const one = turn();
    expect(() =>
      readingOfAct(performed('nuzzle', { target: boundObject(MOUSE) }), CAT, one.context),
    ).toThrow(ActFault);
    destroyInstance(one.context.draft, DOG);
    expect(() =>
      readingOfAct(
        performed('nuzzle', { target: boundObject(CAT), toys: { binds: 'set', ids: [DOG] } }),
        CAT,
        one.context,
      ),
    ).toThrow(/out of range of `den\.hall\.cat`/);
  });

  it('charges the range walk for each thing it names', () => {
    const budget = new Budget(DEFAULT_LIMITS.budgets);
    const one = turn(1, budget);
    readingOfAct(performed('nuzzle', { target: boundObject(DOG) }), CAT, one.context);
    // Out from the cat through the hall to the world, three; in to the dog, one.
    expect(budget.spentSteps).toBe(4);
  });
});

describe('an `act` run where it stands', () => {
  it('runs both passes, its lines heard from the NPC, and the body goes on after it', () => {
    const one = turn(2);
    const [marta, ivo] = one.people;
    expect(lines(acted(typed(one, 'pet')))).toEqual([
      // The cat's own reading: its participants, the cat and Marta, do not hear
      // it, and the dog, an NPC, reads nothing.
      { effect: 'said', by: CAT, to: [ivo], speaker: CAT, words: 'purr' },
      // Then the rest of the cat's `do` in Marta's command, said to her.
      { effect: 'said', by: CAT, to: [marta], speaker: null, words: 'after' },
    ]);
  });

  it('says a refusal in its consent pass as the NPC’s, and ends the body that ran it there', () => {
    const one = turn(2);
    const [marta, ivo] = one.people;
    const outcome = acted(typed(one, 'tease'));
    expect(lines(outcome)).toEqual([
      {
        effect: 'refused',
        by: marta,
        to: [ivo],
        speaker: CAT,
        words: 'You pull your hand away.',
      },
      // Nothing after the `act` runs, and the refusal was not said to
      // Marta, so her command is answered by the world.
      {
        effect: 'said',
        by: WORLD_ID,
        to: [marta],
        speaker: null,
        words: 'sprout.World nothing_happens',
      },
    ]);
    // What ran before the refused `act` stands.
    expect(one.context.draft.instance(CAT)!.properties.get('spins')).toBe(1);
    expect(outcome.said[0]!.bindings.get('actor')).toEqual(boundObject(CAT));
  });

  it('has no output of its own where its reading says nothing; the person’s command is answered once', () => {
    const one = turn();
    const [marta] = one.people;
    expect(lines(acted(typed(one, 'ignore')))).toEqual([
      {
        effect: 'said',
        by: WORLD_ID,
        to: [marta],
        speaker: null,
        words: 'sprout.World nothing_happens',
      },
    ]);
  });

  it('ends the body that performed it where its reading destroyed the actor', () => {
    const one = turn();
    const outcome = acted(typed(one, 'scare'));
    expect(outcome.destroyed).toEqual([CAT]);
    expect(lines(outcome).map((line) => line.words)).toEqual(['sprout.World nothing_happens']);
    expect(one.context.draft.instance(CAT)).toBeUndefined();
  });

  it('hands on what its reading sends, after what the body sent before it', () => {
    const one = turn();
    const outcome = acted(typed(one, 'knit'));
    expect(outcome.sends.map((send) => [send.message, send.recipient])).toEqual([
      ['entered', CAT],
      ['spawned', expect.any(String)],
      ['entered', CAT],
      ['spawned', expect.any(String)],
    ]);
    const [first, , second] = outcome.sends;
    expect(first).not.toEqual(second);
  });

  it('is a reading of a person’s too, whose lines reach them', () => {
    const one = turn();
    const [marta] = one.people;
    expect(lines(acted(typed(one, 'wave', {})))).toEqual([
      { effect: 'said', by: marta, to: [marta], speaker: null, words: 'You bow.' },
    ]);
    expect(lines(acted(typed(one, 'shrug', {}))).map((line) => line.words)).toEqual([
      'sprout.World nothing_happens',
    ]);
  });

  it('faults where it names something out of the actor’s range', () => {
    const one = turn();
    expect(() => typed(one, 'chase', { target: { object: CAT }, prey: { object: MOUSE } })).toThrow(
      ActFault,
    );
  });

  it('runs one deeper than the reading it stands in, a typed command at 0, and faults past the depth', () => {
    const budget = new Budget({ ...DEFAULT_LIMITS.budgets, cascadeDepth: 3 });
    const one = turn(1, budget);
    let fault: unknown;
    try {
      typed(one, 'spin');
    } catch (error) {
      fault = error;
    }
    expect(fault).toBeInstanceOf(BudgetExhausted);
    expect((fault as BudgetExhausted).limit).toBe('cascadeDepth');
    // The command's reading and three `act`s ran; the fourth was one too deep.
    expect(one.context.draft.instance(CAT)!.properties.get('spins')).toBe(4);
  });
});
