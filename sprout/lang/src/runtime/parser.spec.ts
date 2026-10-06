// A typed line read in the corpus world `good/grammar`: every line comes
// to exactly one reading or one of the world's answers, in the world's
// words, the same for the same seed, and what a line may cost is charged
// to the turn's steps. The
// areas' own rules are in `parser/*.spec.ts`.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { chooser } from '../fixtures/parse.js';
import {
  BRASS_KEY,
  CHEST,
  COIN,
  commandContext,
  DIAL,
  DOOR,
  EXITS,
  GONG,
  GUARD,
  HALL,
  IRON_KEY,
  LAMP,
  LAMP_OIL,
  PEBBLE_A,
  PEBBLE_B,
  stepBudget,
  study,
  STUDY,
  STUDY_FILES,
  typed,
  type Study,
} from '../fixtures/parser.js';
import { Budget, BudgetExhausted } from './budget.js';
import { commandTurn } from './command.js';
import { Draws, SEED_MAX } from './draws.js';
import { liveTree } from './live.js';
import { rangeOf } from './range.js';
import { parseCommand, readCommand, type CommandOutcome } from './parser.js';
import {
  CATALOGUE as WAYS_CATALOGUE,
  MARTA as WAYS_MARTA,
  MOUTH,
  ways,
} from '../fixtures/exits.js';
import { boundObject, boundValue } from './evaluate.js';
import { readerOf } from './state.js';
import {
  actorOf,
  belfry,
  belfryHost,
  CATALOGUE,
  INES,
  MARTA,
  typed as command,
} from '../fixtures/turns.js';
import { turn, words as spoken } from '../fixtures/reading.js';
import { compiledWorld } from '../fixtures/bundle.js';
import type { Answer } from './parser/answers.js';
import * as D from '../fixtures/darkness.js';
import type { RefusingExit } from './parser/exits.js';
import { typedWords } from '../declare/addressing.js';
import { addressOf } from './parser/address.js';
import { answersTo } from './parser/nouns.js';
import { declaredId, type InstanceId } from './ids.js';
import type { Bound, Reading } from './reading.js';

/** A reading as a case compares it: the verb by library and name, and each role's filler. */
function understood(outcome: CommandOutcome): { verb: string; bindings: Record<string, Bound> } {
  if (!('understood' in outcome)) throw new Error(`answered \`${outcome.answer}\``);
  if (!('verb' in outcome.understood)) {
    throw new Error(`understood as the intent \`${outcome.understood.intent.name}\``);
  }
  const { verb, bindings } = outcome.understood;
  return { verb: `${verb.library}.${verb.name}`, bindings: Object.fromEntries(bindings) };
}

function answered(outcome: CommandOutcome): Answer {
  if ('understood' in outcome) {
    const { understood } = outcome;
    const name = 'verb' in understood ? understood.verb.name : understood.intent.name;
    throw new Error(`understood as \`${name}\``);
  }
  return outcome;
}

/** `one` with the chest's lid up, so what it holds is in range. */
function openChest(one: Study): Study {
  const chest = one.draft.instance(CHEST)!;
  one.draft.write({ ...chest, properties: new Map([...chest.properties, ['open', true]]) });
  return one;
}

/** Every object an outcome names: what its reading binds, or what its answer binds and offers. */
function named(outcome: CommandOutcome): InstanceId[] {
  if ('understood' in outcome) {
    return [...outcome.understood.bindings.values()].flatMap((bound) =>
      'object' in bound ? [bound.object] : 'set' in bound ? [...bound.set] : [],
    );
  }
  return [...outcome.bindings.values()].flatMap((one) =>
    one.binds === 'object' ? [one.id] : one.binds === 'set' ? [...one.ids] : [],
  );
}

/** What the first visitor in `one` can name: their range, walked by the study's pass rules. */
function rangeIn(one: Study): ReadonlySet<InstanceId> {
  const { passes } = commandContext(one);
  const budget = new Budget({ ...DEFAULT_LIMITS.budgets, steps: 1e9 });
  return rangeOf({ tree: liveTree(one.draft), passes, budget }, one.people[0]!, 'any').within;
}

/** The words of the passage an answer says, as the standard library writes it. */
const words = (answer: Answer): string =>
  'passage' in answer.said
    ? answer.said.passage.body.text.trim()
    : 'recorded' in answer.said
      ? answer.said.recorded.transcript
      : 'absent' in answer.said
        ? `absent ${answer.said.absent}`
        : answer.said.text;

describe('the study', () => {
  it('is the corpus world `good/grammar`, file for file', () => {
    const folder = join(dirname(fileURLToPath(import.meta.url)), '../../../../corpus/good/grammar');
    const files = readdirSync(folder).filter((file) => file.endsWith('.sprout'));
    expect(Object.keys(STUDY_FILES).sort()).toEqual(files.sort());
    for (const file of files) {
      expect(STUDY_FILES[file], file).toBe(readFileSync(join(folder, file), 'utf8'));
    }
  });
});

describe('a line read as a reading', () => {
  it('reads a standard library verb, the article and a determiner optional before a noun', () => {
    for (const line of [
      'take brass key',
      'take the brass key',
      'TAKE  My Brass Key',
      'pick up that brass key',
      'get a brass key',
    ]) {
      expect(understood(typed(study(), line)), line).toEqual({
        verb: 'sprout.take',
        bindings: { target: { object: BRASS_KEY } },
      });
    }
  });

  it('reads the engine verbs by the phrases the standard library gives them', () => {
    const one = study();
    expect(understood(typed(one, 'l')).verb).toBe('sprout.look');
    expect(understood(typed(one, 'look around')).verb).toBe('sprout.look');
    expect(understood(typed(one, 'i')).verb).toBe('sprout.inventory');
    expect(understood(typed(one, 'z')).verb).toBe('sprout.wait');
    expect(understood(typed(one, '?')).verb).toBe('sprout.help');
    for (const line of ['x gong', 'look at gong', 'examine the gong', 'inspect gong']) {
      expect(understood(typed(one, line)), line).toEqual({
        verb: 'sprout.examine',
        bindings: { target: { object: GONG } },
      });
    }
  });

  it("reads a direction, its abbreviation or an exit's label as `go`, bare or after `go`", () => {
    const one = study();
    const north = { way: { exit: EXITS[0]! } };
    for (const line of ['north', 'n', 'go north', 'go n', 'walk north', 'into the yard']) {
      expect(understood(typed(one, line)), line).toEqual({ verb: 'sprout.go', bindings: north });
    }
    expect(understood(typed(one, 'go down the cellar stair')).bindings).toEqual({
      way: { exit: EXITS[1]! },
    });
    expect(answered(typed(one, 'go south')).answer).toBe('no_way');
    expect(answered(typed(one, 'north', [])).answer).toBe('no_way');
    expect(answered(typed(one, 'go yonder')).answer).toBe('unknown');
  });

  it('answers a direction no exit goes in with `no_way`, given the direction written out', () => {
    const one = study();
    for (const [line, way] of [
      ['south', 'south'],
      ['go sw', 'southwest'],
      ['walk up', 'up'],
    ] as const) {
      const outcome = answered(typed(one, line));
      expect(outcome.answer, line).toBe('no_way');
      expect(outcome.bindings.get('way'), line).toEqual({ binds: 'value', value: way });
      expect('passage' in outcome.said && outcome.said.passage.name, line).toBe('no_way');
    }
  });

  it('answers an exit that refuses, named by its direction or its label, with its words', () => {
    const one = study();
    const refusing: RefusingExit = {
      direction: 'west',
      label: 'through the brambles',
      refuses: { by: one.people[0]!, said: { absent: 'brambles' } },
    };
    for (const line of ['west', 'w', 'go west', 'through the brambles']) {
      const outcome = answered(typed(one, line, [...EXITS, refusing]));
      expect(outcome.answer, line).toBe('refused');
      expect(outcome.said, line).toEqual({ absent: 'brambles' });
      expect([...outcome.bindings.keys()], line).toEqual(['actor', 'here']);
    }
    // A way that does not go loses to a reading of the line.
    expect(understood(typed(one, 'north', [...EXITS, refusing])).verb).toBe('sprout.go');
  });

  it('fills a role of a kind only with a thing of it, and reads the tool a phrase leaves out as unbound', () => {
    const one = study();
    expect(understood(typed(one, 'unlock door with iron key'))).toEqual({
      verb: 'study.unlock',
      bindings: { target: { object: DOOR }, tool: { object: IRON_KEY } },
    });
    expect(understood(typed(one, 'unlock door'))).toEqual({
      verb: 'study.unlock',
      bindings: { target: { object: DOOR } },
    });
    // A gong answers and is no key, so the phrase reads only in part, and
    // the world says what it understood; nothing is called "door with gong".
    const gong = answered(typed(one, 'unlock door with gong'));
    expect(gong.answer).toBe('cannot');
    expect(gong.bindings.get('reading')).toEqual(boundValue('unlock the door with the brass disc'));
  });

  it('fills a set role with a run split on `and` and commas, in the order typed, duplicates collapsed', () => {
    const one = study();
    const juggled = (line: string) => understood(typed(one, line)).bindings['things'];
    expect(juggled('juggle gong')).toEqual({ set: [GONG] });
    expect(juggled('juggle brass key and gong')).toEqual({ set: [BRASS_KEY, GONG] });
    expect(juggled('juggle gong, iron key, and the brass key')).toEqual({
      set: [GONG, IRON_KEY, BRASS_KEY],
    });
    expect(juggled('juggle gong and gong')).toEqual({ set: [GONG] });
    expect(answered(typed(one, 'juggle gong and')).answer).toBe('unknown');
    expect(answered(typed(one, 'juggle , gong')).answer).toBe('unknown');
  });

  it("binds a value only where the role's player hears it, spelt as a visitor types it", () => {
    const one = study();
    expect(understood(typed(one, 'ask oskar about old press')).bindings).toEqual({
      target: { object: GUARD },
      topic: { value: 'old_press' },
    });
    // `ask [target] [topic]` also reads the line, with "about old press" as a
    // topic that binds nothing; words that bind no value are not matched, so
    // it ranks below and nothing is drawn.
    const asked = typed(one, 'ask oskar about old press');
    expect('understood' in asked && asked.drawn).toBeNull();
    expect(understood(typed(one, 'ask oskar about the bridge')).bindings['topic']).toEqual({
      value: 'bridge',
    });
    expect(understood(typed(one, 'ask oskar bridge')).bindings['topic']).toEqual({
      value: 'bridge',
    });
    // A topic the guard does not know, and words that are no topic, match and bind nothing.
    for (const line of ['ask oskar about toll', 'ask oskar about potatoes!', 'ask oskar about 3']) {
      expect(understood(typed(one, line)).bindings, line).toEqual({ target: { object: GUARD } });
    }
    expect(understood(typed(one, 'turn dial to 7')).bindings).toEqual({
      target: { object: DIAL },
      number: { value: 7 },
    });
    expect(understood(typed(one, 'turn dial to 13')).bindings).toEqual({
      target: { object: DIAL },
    });
    expect(understood(typed(one, 'turn dial to seven')).bindings).toEqual({
      target: { object: DIAL },
    });
  });

  it('matches a nickname longest-first, as a whole', () => {
    const one = study(['Pip', 'Marta B', 'Marta']);
    const [, martaB, marta] = one.people;
    expect(understood(typed(one, 'give gong to marta b')).bindings).toEqual({
      item: { object: GONG },
      recipient: { object: martaB },
    });
    expect(understood(typed(one, 'give gong to marta')).bindings['recipient']).toEqual({
      object: marta,
    });
    expect(answered(typed(one, 'give gong to b')).answer).toBe('not_here');
  });
});

describe('what a thing answers to', () => {
  it('answers to its name, the last word of it, its identifier and every noun its closure writes', () => {
    const one = study();
    const target = (line: string) => understood(typed(one, line)).bindings['target'];
    expect(target('take shiny thing')).toEqual({ object: BRASS_KEY });
    expect(target('take gong')).toEqual({ object: GONG });
    expect(target('take disc')).toEqual({ object: GONG });
    expect(target('take brass disc')).toEqual({ object: GONG });
    expect(target('take oil')).toEqual({ object: LAMP_OIL });
    expect(target('take lamp oil')).toEqual({ object: LAMP_OIL });
  });

  it('prefers the thing whose whole name was typed to one that answers to a noun', () => {
    // Oil answers to `lamp`, and the lamp is called it.
    expect(understood(typed(study(), 'take lamp')).bindings['target']).toEqual({ object: LAMP });
  });

  it('takes the nearer of things alike, since nearer things rank first', () => {
    // The second pebble in the visitor's hands is nearer than the first on the floor.
    const one = study();
    one.draft.place(PEBBLE_B, one.people[0]!);
    for (let seed = 0; seed < 16; seed++) {
      const read = typed(one, 'x pebble', EXITS, seed);
      expect(understood(read).bindings['target']).toEqual({ object: PEBBLE_B });
      expect('understood' in read && read.drawn).toBeNull();
    }
    // One in the open chest is farther than one on the floor beside it.
    const chested = openChest(study());
    chested.draft.place(PEBBLE_B, CHEST);
    for (let seed = 0; seed < 16; seed++) {
      expect(understood(typed(chested, 'x pebble', EXITS, seed)).bindings['target']).toEqual({
        object: PEBBLE_A,
      });
    }
  });

  it('draws from the turn’s seed among things written alike and equally near, and says nothing of it', () => {
    const read = (seed: number) => typed(study(), 'take pebble', EXITS, seed);
    const meant = (seed: number): Bound | undefined => understood(read(seed)).bindings['target'];
    const seeds = Array.from({ length: 32 }, (_, seed) => seed);
    for (const seed of seeds) expect(meant(seed), `seed ${seed}`).toEqual(meant(seed));
    expect(new Set(seeds.map((seed) => JSON.stringify(meant(seed))))).toEqual(
      new Set([PEBBLE_A, PEBBLE_B].map((object) => JSON.stringify({ object }))),
    );
    // Drawn among two, and no word could tell them apart, so nothing is meant.
    const one = read(0);
    expect('understood' in one && one.drawn).toEqual({ among: 2, meant: null });
  });
});

describe('choosing among readings', () => {
  it('takes one whose consent pass allows over one it refuses, whatever the seed', () => {
    const holding = study();
    holding.draft.place(BRASS_KEY, holding.people[0]!);
    for (let seed = 0; seed < 16; seed++) {
      // Taking the brass key is refused, for it is held; dropping the iron key, for it is not.
      const take = typed(holding, 'take key', EXITS, seed);
      expect(understood(take).bindings['target']).toEqual({ object: IRON_KEY });
      expect('understood' in take && take.drawn).toBeNull();
      expect(understood(typed(holding, 'drop key', EXITS, seed)).bindings['target']).toEqual({
        object: BRASS_KEY,
      });
    }
  });

  it('takes the reading that matched more words, whatever the seed', () => {
    // `lamp oil` is one thing named in full, and no reading of `lamp` alone matches as much.
    for (let seed = 0; seed < 8; seed++) {
      expect(understood(typed(study(), 'x lamp oil', EXITS, seed)).bindings['target']).toEqual({
        object: LAMP_OIL,
      });
    }
  });

  it('draws among things that differ, and says which through the world’s `meant`', () => {
    const drawn = (seed: number) => typed(study(), 'take key', EXITS, seed);
    const seeds = Array.from({ length: 32 }, (_, seed) => seed);
    const taken = new Set<string>();
    for (const seed of seeds) {
      const read = drawn(seed);
      if (!('understood' in read)) throw new Error('not understood');
      const target = read.understood.bindings.get('target');
      expect(read.drawn, `seed ${seed}`).toEqual({
        among: 2,
        meant: target !== undefined && 'object' in target ? target.object : null,
      });
      taken.add(JSON.stringify(target));
    }
    expect(taken.size).toBe(2);
  });
});

describe('the answers', () => {
  it("says `not_here`, in the world's words, of a noun nothing in range answers to, naming nothing", () => {
    const one = study();
    // The coin is in the shut chest, the barrel in another place, and nothing is a unicorn.
    const lines = [
      'take coin',
      'juggle gong and the coin',
      'x the barrel',
      'take barrel',
      'take unicorn',
      'take brass key please',
    ];
    for (const line of lines) {
      const none = answered(typed(one, line));
      expect(none.answer, line).toBe('not_here');
      expect(words(none), line).toBe('You see nothing like that here.');
      expect(none.bindings.get('actor'), line).toEqual({ binds: 'object', id: one.people[0] });
      expect(none.bindings.get('here'), line).toEqual({ binds: 'object', id: HALL });
      expect([...none.bindings.keys()].sort(), line).toEqual(['actor', 'here']);
    }
  });

  it('reads what one phrase reads, though another names nothing in range', () => {
    // `unlock [target] with [tool]` reads; `unlock [target]` finds no "door with key".
    expect(understood(typed(study(), 'unlock door with brass key')).verb).toBe('study.unlock');
  });

  it('names what a lid held once it is open', () => {
    const open = openChest(study());
    expect(understood(typed(open, 'take coin')).bindings).toEqual({ target: { object: COIN } });
    expect(answered(typed(open, 'x the barrel')).answer).toBe('not_here');
  });

  it("says `unknown`, in the world's words, of a line no phrase reads, the empty line included", () => {
    const one = study();
    for (const line of ['', '   ', 'dance', 'take', 'juggle gong and', 'juggle , gong', ',']) {
      const unknown = answered(typed(one, line));
      expect(unknown.answer, line).toBe('unknown');
      expect(words(unknown)).toBe('That is not something you can do here.');
      expect(unknown.bindings.get('actor')).toEqual({ binds: 'object', id: one.people[0] });
      expect(unknown.bindings.get('here')).toEqual({ binds: 'object', id: HALL });
    }
  });
});

describe('what reading a line costs', () => {
  it('charges every noun tried to the turn’s steps, so a longer line costs more', () => {
    const cost = (line: string): number => {
      const one = study();
      typed(one, line);
      return one.budget.spentSteps;
    };
    expect(cost('take gong')).toBeGreaterThan(0);
    expect(cost('juggle gong and lamp and brass key')).toBeGreaterThan(cost('juggle gong'));
  });

  it('faults when a line costs more than the step budget allows', () => {
    const line = `juggle ${Array.from({ length: 40 }, () => 'gong').join(' and ')}`;
    expect(() => typed(study(['Pip'], stepBudget(200)), line)).toThrow(BudgetExhausted);
  });

  it('leaves the set-role cap to the reading, which checks it as it starts', () => {
    const budget = new Budget({ ...DEFAULT_LIMITS.budgets, setRoleObjects: 2 });
    const things = understood(typed(study(['Pip'], budget), 'juggle gong, lamp and brass key'));
    expect(things.bindings['things']).toEqual({ set: [GONG, LAMP, BRASS_KEY] });
  });
});

describe('the parser a command turn reads through', () => {
  it('runs the reading a line makes, in the turn', () => {
    const state = belfry([MARTA]);
    const turn = commandTurn(
      state,
      belfryHost(undefined, parseCommand),
      command(MARTA, 'ring the bell'),
    );
    expect(turn.committed && 'acted' in turn.value).toBe(true);
  });

  it('answers the actor alone, as a notice from the world, and commits nothing else', () => {
    const state = belfry([MARTA]);
    const marta = actorOf(state, MARTA);
    const turn = commandTurn(state, belfryHost(undefined, parseCommand), command(MARTA, 'dance'));
    if (!turn.committed || !('answered' in turn.value)) throw new Error('not answered');
    expect(turn.value.answered).toMatchObject({
      effect: 'notice',
      to: [marta],
      by: state.world,
      speaker: null,
    });
    expect(spoken(turn.value.answered.said)).toBe(
      'sprout.World unknown: That is not something you can do here.',
    );
  });

  it('names a visitor by the nickname the world holds for them', () => {
    const state = belfry([MARTA, INES]);
    const context = (budget: Budget) => ({
      state: readerOf(state),
      catalogue: CATALOGUE,
      passes: () => true,
      budget,
      draws: new Draws(7),
      nicknames: new Map([...state.visitors.values()].map((v) => [v.instance, v.nickname])),
      referents: [],
      lastReading: null,
    });
    const parsed = parseCommand(
      'sniff v-ines',
      actorOf(state, MARTA),
      context(new Budget(DEFAULT_LIMITS.budgets)),
    );
    expect('reading' in parsed && parsed.reading.bindings.get('target')).toEqual({
      object: actorOf(state, INES),
    });
  });

  it('tells the actor which thing a drawn reading meant, as a notice before the reading, and reads no exit where the place gives none', () => {
    const one = study();
    const context = commandContext(one);
    const parsed = parseCommand('take key', one.people[0]!, context);
    if (!('reading' in parsed) || parsed.drawn === null) throw new Error('not drawn');
    expect(parsed.drawn.among).toBe(2);
    expect(parsed.drawn.meant).toMatchObject({ effect: 'notice', to: [one.people[0]] });
    expect(spoken(parsed.drawn.meant!.said)).toBe('sprout.World meant: ({thing})');
    expect(parsed.drawn.meant!.bindings.get('thing')).toEqual({
      binds: 'object',
      id: (parsed.reading.bindings.get('target') as { object: InstanceId }).object,
    });
    expect('answered' in parseCommand('north', one.people[0]!, context)).toBe(true);
  });
});

describe('the parser a command turn reads through', () => {
  it('reads a direction or a label as `go` through the exit that applies where the actor stands', () => {
    const state = ways();
    const actor = state.visitors.get(WAYS_MARTA)!.instance;
    const context = {
      state: readerOf(state),
      catalogue: WAYS_CATALOGUE,
      passes: () => true,
      budget: new Budget(DEFAULT_LIMITS.budgets),
      draws: new Draws(7),
      nicknames: new Map<InstanceId, string>(),
      referents: [],
      lastReading: null,
    };
    for (const line of ['north', 'go north', 'deeper into the dark']) {
      const parsed = parseCommand(line, actor, context);
      expect('reading' in parsed && parsed.reading.bindings.get('way'), line).toEqual({
        exit: { direction: 'north', label: 'deeper into the dark', to: MOUTH },
      });
    }
    // The way north that does not apply is not mentioned, even by its label.
    expect('answered' in parseCommand('toward a grey light', actor, context)).toBe(true);
  });
});

describe('every line has exactly one outcome (generated)', () => {
  // Words the study's grammar reads, and words it does not.
  const VOCABULARY = [
    ...STUDY.words,
    'marta',
    'unicorn',
    'please',
    '!',
    '7',
    '13',
    '-2',
    'Brass',
    ',',
    'and',
  ];

  it('never ends in nothing and never throws with the budget to read it', () => {
    const c = chooser(27);
    for (let run = 0; run < 400; run++) {
      const line = Array.from({ length: c.below(7) }, () => c.one(VOCABULARY)).join(
        c.one([' ', '  ', ' , ']),
      );
      const seed = c.below(SEED_MAX);
      const one = study(['Marta B', 'Pip'], new Budget({ ...DEFAULT_LIMITS.budgets, steps: 1e9 }));
      let outcome: CommandOutcome | undefined;
      expect(() => (outcome = typed(one, line, EXITS, seed)), line).not.toThrow();
      const kinds = ['understood' in outcome! ? 'understood' : outcome!.answer];
      expect(kinds, line).toHaveLength(1);
      expect(['understood', 'not_here', 'no_way', 'unknown'], line).toContain(kinds[0]);
      if (!('understood' in outcome!)) {
        expect('passage' in outcome!.said, line).toBe(true);
        continue;
      }
      // A reading drawn was drawn from two or more, and what it says was
      // meant is a thing the reading binds.
      const { understood: reading, drawn } = outcome!;
      if (drawn === null) continue;
      expect(drawn.among, line).toBeGreaterThan(1);
      if (drawn.meant === null) continue;
      const bound = [...reading.bindings.values()].flatMap((one) =>
        'object' in one ? [one.object] : [],
      );
      expect(bound, line).toContain(drawn.meant);
    }
  });

  it('names through a relative phrase only what stands directly in what the words after it name', () => {
    const c = chooser(355);
    const things = [
      'key',
      'brass key',
      'coin',
      'pebble',
      'lamp',
      'chest',
      'one',
      'the one',
      'gong',
    ];
    const holders = ['chest', 'the chest', 'hall', 'lamp', 'marta b', 'pip'];
    let relative = 0;
    for (let run = 0; run < 300; run++) {
      const one = study(['Marta B', 'Pip'], new Budget({ ...DEFAULT_LIMITS.budgets, steps: 1e9 }));
      if (c.below(2) === 0) openChest(one);
      const holder = c.one(holders);
      const joining = c.one(['in', 'on', 'that is in']);
      const line = `x ${c.one(things)} ${joining} ${holder}`;
      const outcome = typed(one, line, EXITS, c.below(SEED_MAX));
      if (!('understood' in outcome)) continue;
      const target = outcome.understood.bindings.get('target');
      if (target === undefined || !('object' in target)) continue;
      const container = one.draft.instance(target.object)!.container!;
      const address = addressOf(one.draft.instance(container)!, {
        world: one.draft.world,
        nicknames: one.nicknames,
      });
      expect(answersTo(typedWords(holder), address), line).not.toBeNull();
      relative++;
    }
    expect(relative).toBeGreaterThan(20);
  });

  it("never names an object outside the visitor's range, the chest shut or open, whatever the seed", () => {
    const c = chooser(102);
    // A verb's phrase, then words that are mostly nouns, near and far, and alike.
    const verbs = ['take', 'x the', 'juggle', 'give', 'unlock door with', ''];
    const nouns = ['coin', 'the coin', 'barrel', 'chest', 'gong', 'key', 'pebble', 'and', ','];
    let coinNamed = 0;
    for (let run = 0; run < 400; run++) {
      const tail = Array.from({ length: 1 + c.below(4) }, () =>
        c.below(4) === 0 ? c.one(VOCABULARY) : c.one(nouns),
      );
      const line = [c.one(verbs), ...tail].join(' ');
      const one = study(['Marta B', 'Pip'], new Budget({ ...DEFAULT_LIMITS.budgets, steps: 1e9 }));
      if (c.below(2) === 0) openChest(one);
      const range = rangeIn(one);
      for (const id of named(typed(one, line, EXITS, c.below(SEED_MAX)))) {
        expect(range.has(id), `${line}: ${id}`).toBe(true);
        if (id === COIN) coinNamed++;
      }
    }
    // The coin, in range only with the lid up, is named often enough for the rule to bite.
    expect(coinNamed).toBeGreaterThan(0);
  });

  it('with too little budget, faults as a budget and in no other way', () => {
    const c = chooser(81);
    for (let run = 0; run < 200; run++) {
      const line = Array.from({ length: 1 + c.below(6) }, () => c.one(VOCABULARY)).join(' ');
      const one = study(['Marta B'], stepBudget(1 + c.below(120)));
      try {
        typed(one, line);
      } catch (error) {
        expect(error, line).toBeInstanceOf(BudgetExhausted);
      }
    }
  });

  it('reads the same line to the same outcome every time for the same seed', () => {
    const c = chooser(54);
    for (let run = 0; run < 50; run++) {
      const line = Array.from({ length: 1 + c.below(5) }, () => c.one(VOCABULARY)).join(' ');
      const seed = c.below(SEED_MAX);
      expect(typed(study(), line, EXITS, seed), line).toEqual(typed(study(), line, EXITS, seed));
    }
  });

  it('reads words however they are cased and spaced', () => {
    expect(typedWords('  Take   the BRASS key ')).toEqual(['take', 'the', 'brass', 'key']);
  });
});

describe('a line ending in `?`', () => {
  it('is read without it, as a question typed as a command', () => {
    for (const line of ['look?', 'look ?', 'look?  ']) {
      expect(understood(typed(study(), line)).verb, line).toBe('sprout.look');
    }
    expect(understood(typed(study(), 'examine lamp?'))).toEqual({
      verb: 'sprout.examine',
      bindings: { target: { object: LAMP } },
    });
  });

  it('keeps a `?` alone, which is one of the phrases of `help`', () => {
    expect(understood(typed(study(), '?')).verb).toBe('sprout.help');
    expect(understood(typed(study(), ' ? ')).verb).toBe('sprout.help');
  });
});

describe('a place whose name shares a noun with something in it', () => {
  const YARD = compiledWorld('yard', {
    'yard.sprout': [
      'world yard is sprout.World { visitors are Person visitors arrive at west_of_house',
      '  object west_of_house is sprout.Place {',
      '    object white_house is sprout.Fixture',
      '    object box is sprout.Container { object toy_house is sprout.Fixture }',
      '  }',
      '  object kitchen is sprout.Place { }',
      '}',
    ].join('\n'),
    'person.sprout': 'kind Person is sprout.Visitor { }\n',
  });
  const at = (...path: string[]) => declaredId('yard', path);
  const place = at('west_of_house');
  const read = (line: string, seed: number, ready?: (one: Study) => void) => {
    const one: Study = { ...turn(YARD, [place]), nicknames: new Map() };
    ready?.(one);
    return typed(one, line, [], seed);
  };

  it('ranks the visitor’s own place below everything it holds, whatever the seed', () => {
    for (let seed = 0; seed < 16; seed++) {
      const house = read('x house', seed);
      expect(understood(house).bindings['target'], `seed ${seed}`).toEqual({
        object: at('west_of_house', 'white_house'),
      });
      expect('understood' in house && house.drawn).toBeNull();
    }
  });

  it('ranks it below what lies deep inside it too', () => {
    // The toy house, inside a box on the floor, is the deepest thing there.
    const reading = read('x house', 3, (one) =>
      one.draft.remove(at('west_of_house', 'white_house')),
    );
    expect(understood(reading).bindings['target']).toEqual({
      object: at('west_of_house', 'box', 'toy_house'),
    });
  });

  it('still names the place where nothing in it answers as well', () => {
    expect(understood(read('x west of house', 3)).bindings['target']).toEqual({ object: place });
    expect(understood(read('x west', 3)).bindings['target']).toEqual({ object: place });
  });
});

describe('a reading its consent pass allows, beside one it refuses', () => {
  const MAZE = compiledWorld('labyrinth', {
    'labyrinth.sprout': [
      'kind Room is sprout.Place { as target for any { permit { refuse "No such thing." } } }',
      'kind Bag { }',
      'world labyrinth is sprout.World { visitors are Person visitors arrive at maze',
      '  object maze is Room {',
      '    grammar { name "Maze" }',
      '    object passages is sprout.Fixture { grammar { name "passages"  nouns "maze" } }',
      '    object sack is Bag { grammar { name "brown sack"  nouns "sack" "bag" } }',
      '    object leather_bag is Bag { grammar { name "leather bag of coins"  nouns "bag" } }',
      '  }',
      '  object garden is sprout.Place {',
      '    grammar { name "garden" }',
      '    object beds is sprout.Fixture { grammar { name "flower beds"  nouns "garden" } }',
      '  }',
      '  object yard is sprout.Place {',
      '    object press is sprout.Fixture {',
      '      grammar { name "press" }',
      '      as target for take { permit { refuse "Bolted down." } }',
      '    }',
      '    object press_bar is Bag { grammar { name "press bar" } }',
      '  }',
      '}',
    ].join('\n'),
    'person.sprout': 'kind Person is sprout.Visitor { }\n',
  });
  const at = (...path: string[]) => declaredId('labyrinth', path);
  const read = (line: string, place: string, seed: number, ready?: (one: Study) => void) => {
    const one: Study = { ...turn(MAZE, [at(place)]), nicknames: new Map() };
    ready?.(one);
    return typed(one, line, [], seed);
  };
  const target = (outcome: CommandOutcome) => understood(outcome).bindings['target'];

  it('is chosen over the own place that refuses, though the place’s whole name was typed', () => {
    for (let seed = 0; seed < 16; seed++) {
      expect(target(read('x maze', 'maze', seed)), `seed ${seed}`).toEqual({
        object: at('maze', 'passages'),
      });
    }
  });

  it('is chosen over a nearer thing that refuses, as taking what is held does', () => {
    const holding = (one: Study) => one.draft.place(at('maze', 'sack'), one.people[0]!);
    for (let seed = 0; seed < 16; seed++) {
      expect(target(read('take bag', 'maze', seed, holding)), `seed ${seed}`).toEqual({
        object: at('maze', 'leather_bag'),
      });
    }
  });

  it('leaves the own place further than what it holds where nothing refuses, its whole name typed', () => {
    for (let seed = 0; seed < 16; seed++) {
      expect(target(read('x garden', 'garden', seed)), `seed ${seed}`).toEqual({
        object: at('garden', 'beds'),
      });
    }
    expect(target(read('x flower beds', 'garden', 3))).toEqual({ object: at('garden', 'beds') });
  });

  it('names nothing by adjectives alone where a thing is named by a noun, however its reading is answered', () => {
    // `press` is the press bar's adjective; taking the bar is allowed, taking the press refused.
    for (let seed = 0; seed < 16; seed++) {
      expect(target(read('take press', 'yard', seed)), `seed ${seed}`).toEqual({
        object: at('yard', 'press'),
      });
    }
    expect(target(read('take press bar', 'yard', 0))).toEqual({ object: at('yard', 'press_bar') });
  });

  it('weighs a whole name only among things equally near: a nearer thing named by a noun wins', () => {
    // The lamp oil, in the visitor's hands, answers to `lamp`; the lamp on the floor is called it.
    const one = study();
    expect(target(typed(one, 'take lamp'))).toEqual({ object: LAMP });
    one.draft.place(LAMP_OIL, one.people[0]!);
    for (let seed = 0; seed < 16; seed++) {
      expect(target(typed(one, 'x lamp', EXITS, seed)), `seed ${seed}`).toEqual({
        object: LAMP_OIL,
      });
    }
  });
});

describe('a line typed with a synonym', () => {
  const YARD = compiledWorld('yard', {
    'yard.sprout': [
      'world yard is sprout.World { visitors are Person visitors arrive at hall',
      '  synonyms pry: "lever"',
      '  object hall is sprout.Place {',
      '    object chest is sprout.Fixture { synonyms pry: "force" }',
      '    object crate is sprout.Fixture',
      '  }',
      '}',
      'verb pry { role target  "pry [target]"  "use a bar on [target]"  synonyms "prise" }',
    ].join('\n'),
    'person.sprout': 'kind Person is sprout.Visitor { }\n',
  });
  const [hall, chest, crate] = [['hall'], ['hall', 'chest'], ['hall', 'crate']].map((path) =>
    declaredId('yard', path),
  );
  const at = (line: string) => {
    const one: Study = { ...turn(YARD, [hall!]), nicknames: new Map() };
    return typed(one, line, []);
  };

  it('reads as the verb, a verb’s own or the world’s, whatever it is typed with', () => {
    for (const line of ['prise crate', 'lever crate', 'pry crate']) {
      expect(understood(at(line)), line).toEqual({
        verb: 'yard.pry',
        bindings: { target: { object: crate } },
      });
    }
  });

  it('reads an object’s only where that object takes part, and is otherwise not understood', () => {
    expect(understood(at('force chest'))).toEqual({
      verb: 'yard.pry',
      bindings: { target: { object: chest } },
    });
    expect(at('force crate')).toMatchObject({ answer: 'unknown' });
    // A phrase that does not write the name gives nothing.
    expect(at('use a lever on crate')).toMatchObject({ answer: 'unknown' });
  });
});

describe('a line whose nouns hold words a phrase or a relative phrase also reads', () => {
  const SHED = compiledWorld('shed', {
    'shed.sprout': [
      'world shed is sprout.World { visitors are Person visitors arrive at hall',
      '  object hall is sprout.Place {',
      '    object rope is sprout.Fixture { grammar { name "rope with a knot" } }',
      '    object string is sprout.Fixture',
      '    object box is sprout.Container { object brass_key is sprout.Fixture }',
      '    object tin is sprout.Container { object iron_key is sprout.Fixture }',
      '    object bell is sprout.Fixture { grammar { name "brass bell"  nouns "brass" } }',
      '    object lamp is sprout.Fixture { grammar { adjectives "old" "tin" } }',
      '  }',
      '}',
      'verb tie { role target  role tool  "tie [target] with [tool]" }',
      'verb ring { role target  "ring [target]" }',
    ].join('\n'),
    'person.sprout': 'kind Person is sprout.Visitor { }\n',
  });
  const at = (...path: string[]) => declaredId('shed', path);
  const read = (line: string) => {
    const one: Study = { ...turn(SHED, [at('hall')]), nicknames: new Map() };
    return typed(one, line, []);
  };

  it('tries every place a phrase’s words could fall, so a name holding one still reads', () => {
    expect(understood(read('tie rope with a knot with string'))).toEqual({
      verb: 'shed.tie',
      bindings: { target: { object: at('hall', 'rope') }, tool: { object: at('hall', 'string') } },
    });
  });

  it('narrows a name by what holds it, however the relative phrase is written', () => {
    for (const line of [
      'ring key in box',
      'ring the key in the box',
      'ring the key that is in the box',
      'ring the one in the box',
      'ring key on box',
    ]) {
      const reading = read(line);
      expect(understood(reading).bindings['target'], line).toEqual({
        object: at('hall', 'box', 'brass_key'),
      });
      expect('understood' in reading && reading.drawn, line).toBeNull();
    }
    // Nothing the tin holds is a bell, so nothing is named.
    expect(read('ring bell in tin')).toMatchObject({ answer: 'not_here' });
  });

  it('names a thing by adjectives alone only where nothing is named better', () => {
    // `brass` is the bell's noun and only the key's adjective.
    expect(understood(read('ring brass')).bindings['target']).toEqual({
      object: at('hall', 'bell'),
    });
    // `iron` names nothing else, so the key it is an adjective of is named.
    expect(understood(read('ring iron')).bindings['target']).toEqual({
      object: at('hall', 'tin', 'iron_key'),
    });
    // Written adjectives name the lamp before its noun, and alone.
    expect(understood(read('ring old tin lamp')).bindings['target']).toEqual({
      object: at('hall', 'lamp'),
    });
    expect(understood(read('ring old')).bindings['target']).toEqual({ object: at('hall', 'lamp') });
  });
});

describe('a line an intent’s phrase reads', () => {
  const YARD = compiledWorld('yard', {
    'yard.sprout': [
      'world yard is sprout.World { visitors are Person visitors arrive at hall',
      '  object hall is sprout.Place {',
      '    object bell is Heavy',
      '    object gong is sprout.Fixture',
      '  }',
      '}',
      'kind Heavy { as target for shove { permit { refuse "It will not budge." } } }',
      'verb shove { role target  "shove [target]" }',
      'verb ring { role target  "ring [target]" }',
      'intent nudge { "nudge [y]"  "shove [y]"  do ring (target: y) }',
    ].join('\n'),
    'person.sprout': 'kind Person is sprout.Visitor { }\n',
  });
  const bell = declaredId('yard', ['hall', 'bell']);
  const at = (line: string) => {
    const one: Study = { ...turn(YARD, [declaredId('yard', ['hall'])]), nicknames: new Map() };
    return typed(one, line, []);
  };
  /** The intent `line` was read as, and what fills each slot. */
  const intended = (line: string) => {
    const outcome = at(line);
    if (!('understood' in outcome) || !('intent' in outcome.understood)) {
      throw new Error(`\`${line}\` was not read as an intent`);
    }
    const { intent, bindings } = outcome.understood;
    return { intent: `${intent.library}.${intent.name}`, bindings: Object.fromEntries(bindings) };
  };

  it('is read as the intent, its slots bound by name', () => {
    expect(intended('nudge bell')).toEqual({
      intent: 'yard.nudge',
      bindings: { y: { object: bell } },
    });
  });

  it('ranks as allowed, since an intent asks no consent of its own, over a verb’s reading refused', () => {
    expect(intended('shove bell')).toEqual({
      intent: 'yard.nudge',
      bindings: { y: { object: bell } },
    });
  });
});

describe('a pronoun a thing declares another for', () => {
  const PARK = compiledWorld('park', {
    'park.sprout': [
      'world park is sprout.World { visitors are Person visitors arrive at lawn',
      '  object lawn is sprout.Place {',
      '    object cat is Pet { grammar { article the  pronouns she } }',
      '    object dog is Pet',
      '    object ball is Ball',
      '  }',
      '}',
      'kind Pet { as target for pat { do { say "{self} wags." } } }',
      'kind Ball { grammar { pronouns it } }',
      'verb pat { role target  "pat [target]" }',
      'verb nudge { role target  role tool: Ball  "nudge [target] toward [tool]" }',
    ].join('\n'),
    'person.sprout': 'kind Person is sprout.Visitor { }\n',
  });
  const [lawn, cat, dog, ball] = [['lawn'], ['lawn', 'cat'], ['lawn', 'dog'], ['lawn', 'ball']].map(
    (path) => declaredId('park', path),
  );
  /** What `line` is read as, typed by one whose last command was done to `referents`. */
  const parsed = (line: string, referents: readonly InstanceId[]) => {
    const one = turn(PARK, [lawn!]);
    return parseCommand(line, one.people[0]!, {
      state: one.draft,
      catalogue: one.catalogue,
      passes: () => true,
      budget: one.budget,
      draws: new Draws(7),
      nicknames: new Map(),
      referents,
      lastReading: null,
    });
  };
  const corrected = (line: string, referents: readonly InstanceId[]) => {
    const read = parsed(line, referents);
    if (!('reading' in read)) throw new Error(`\`${line}\` was not understood`);
    return read.corrected.map((said) => [said.bindings.get('thing'), said.bindings.get('pronoun')]);
  };

  it('is corrected before the action, with the thing and the pronoun it declares', () => {
    expect(corrected('pat it', [cat!])).toEqual([[boundObject(cat!), boundValue('she')]]);
    const read = parsed('pat it', [cat!]);
    expect('reading' in read && read.corrected[0]).toMatchObject({
      effect: 'notice',
      said: { passage: { name: 'pronoun_correction' } },
    });
  });

  it('is not corrected where the pronoun agrees, the thing declares none, or it was named', () => {
    expect(corrected('pat her', [cat!])).toEqual([]);
    expect(corrected('pat it', [dog!])).toEqual([]);
    expect(corrected('pat cat', [cat!])).toEqual([]);
  });

  it('is said only for what the pronoun named, never for a thing another role named outright', () => {
    expect(corrected('nudge cat toward it', [cat!, ball!])).toEqual([]);
    expect(corrected('nudge it toward ball', [cat!])).toEqual([
      [boundObject(cat!), boundValue('she')],
    ]);
  });
});

describe('`again`', () => {
  const take = STUDY.verbs.qualified('sprout', 'take')!;
  /** `line`, typed by the study's first visitor, whose last reading was taking `target`. */
  const read = (line: string, target: InstanceId | null) => {
    const one = study();
    const last =
      target === null
        ? null
        : {
            verb: take,
            actor: one.people[0]!,
            bindings: new Map([['target', { object: target }]]),
          };
    return readCommand(line, one.people[0]!, { ...commandContext(one), lastReading: last });
  };

  it('runs the last reading again, `g` as `again`, whatever its words would mean now', () => {
    for (const line of ['again', 'g', 'Again']) {
      expect(understood(read(line, GONG)), line).toEqual({
        verb: 'sprout.take',
        bindings: { target: { object: GONG } },
      });
    }
  });

  it('is `not_here` where a thing it binds is out of reach, and `unknown` with no last reading', () => {
    expect(answered(read('again', COIN)).answer).toBe('not_here');
    expect(answered(read('again', null)).answer).toBe('unknown');
  });
});

describe('`again`, where the verb has changed since', () => {
  const unlock = STUDY.verbs.qualified('study', 'unlock')!;
  const juggle = STUDY.verbs.qualified('study', 'juggle')!;
  const read = (last: Reading) => {
    const one = study();
    return readCommand('again', one.people[0]!, {
      ...commandContext(one),
      lastReading: { ...last, actor: one.people[0]! },
    });
  };

  it('is `unknown` where a binding no longer fits the verb, and a reading that fits still runs', () => {
    const actor = study().people[0]!;
    const fitting: Reading = {
      verb: unlock,
      actor,
      bindings: new Map([
        ['target', { object: DOOR }],
        ['tool', { object: BRASS_KEY }],
      ]),
    };
    expect(understood(read(fitting)).verb).toBe('study.unlock');
    for (const bindings of [
      // A role the verb no longer has.
      new Map([['lid', { object: DOOR }]]),
      // A thing no longer of the role's kind.
      new Map([['target', { object: GONG }]]),
      // A set where the role takes one thing.
      new Map([['target', { set: [DOOR] }]]),
      // A role that is not optional, unbound.
      new Map<string, Bound>(),
    ]) {
      expect(answered(read({ verb: unlock, actor, bindings })).answer).toBe('unknown');
    }
    expect(
      answered(read({ verb: juggle, actor, bindings: new Map([['things', { object: GONG }]]) }))
        .answer,
    ).toBe('unknown');
  });
});

describe('`all`', () => {
  it('reads a role that takes one thing as the first thing, and each after it as a reading to run', () => {
    const outcome = typed(study(), 'unlock door with all');
    if (!('understood' in outcome)) throw new Error('`unlock door with all` was answered');
    const rest = outcome.rest.map((one) => ('planned' in one ? one.planned : null));
    const tools = [outcome.understood, ...rest].map((reading) => reading?.bindings.get('tool'));
    expect(tools).toEqual([{ object: BRASS_KEY }, { object: IRON_KEY }]);
  });

  it('reads a set role as every thing at once, with nothing after it', () => {
    const outcome = typed(study(), 'juggle all except metal, the lamp and the oil');
    expect(understood(outcome).bindings['things']).toEqual({
      set: [GONG, PEBBLE_A, PEBBLE_B, CHEST, GUARD, DIAL, DOOR],
    });
    expect('rest' in outcome && outcome.rest).toEqual([]);
  });
});

describe('a line read in the dark', () => {
  const read = (line: string, state: ReturnType<typeof D.dark>) =>
    readCommand(line, D.personOf(state, D.MARTA), {
      ...D.darkContext(state),
      draws: new Draws(7),
      exits: [{ direction: 'up', label: 'up to the kitchen', to: D.KITCHEN }],
      referents: [],
      lastReading: null,
    });

  it('names only the actor and what they carry: anything else is `not_here`', () => {
    const state = D.dark(undefined, [], [[D.MARTA, D.LAMP]]);
    const coal = read('examine coal', state);
    expect('answer' in coal && coal.answer).toBe('not_here');
    const lamp = read('examine lamp', state);
    expect('understood' in lamp && lamp.understood.bindings.get('target')).toEqual({
      object: D.LAMP,
    });
    const up = read('up', state);
    expect('understood' in up).toBe(true);
    const lit = D.dark(undefined, [[D.LAMP, 'lit', true]], [[D.MARTA, D.LAMP]]);
    const seen = read('examine coal', lit);
    expect('understood' in seen && seen.understood.bindings.get('target')).toEqual({
      object: D.COAL,
    });
  });
});
