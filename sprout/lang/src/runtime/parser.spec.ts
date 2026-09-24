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
import { parseCommand, type CommandOutcome } from './parser.js';
import {
  CATALOGUE as WAYS_CATALOGUE,
  MARTA as WAYS_MARTA,
  MOUTH,
  ways,
} from '../fixtures/exits.js';
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
import { words as spoken } from '../fixtures/reading.js';
import type { Answer } from './parser/answers.js';
import { typedWords } from '../declare/addressing.js';
import type { InstanceId } from './ids.js';
import type { Bound } from './reading.js';

/** A reading as a case compares it: the verb by library and name, and each role's filler. */
function understood(outcome: CommandOutcome): { verb: string; bindings: Record<string, Bound> } {
  if (!('understood' in outcome)) throw new Error(`answered \`${outcome.answer}\``);
  const { verb, bindings } = outcome.understood;
  return { verb: `${verb.library}.${verb.name}`, bindings: Object.fromEntries(bindings) };
}

function answered(outcome: CommandOutcome): Answer {
  if ('understood' in outcome) throw new Error(`understood as \`${outcome.understood.verb.name}\``);
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
  const bound = [...outcome.bindings.values()].flatMap((one) =>
    one.binds === 'object' ? [one.id] : one.binds === 'set' ? [...one.ids] : [],
  );
  return [...bound, ...outcome.choices.map((choice) => choice.id)];
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
    expect(answered(typed(one, 'go south')).answer).toBe('unknown');
    expect(answered(typed(one, 'north', [])).answer).toBe('unknown');
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
    // A gong answers and is no key, so the phrase does not match; `unlock [target]`
    // reads, and nothing is called "door with gong".
    expect(answered(typed(one, 'unlock door with gong')).answer).toBe('not_here');
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

  it('takes the nearest of things written alike, since no answer could tell them apart', () => {
    // The second pebble in the visitor's hands is nearer than the first on the floor.
    const one = study();
    one.draft.place(PEBBLE_B, one.people[0]!);
    for (let seed = 0; seed < 16; seed++) {
      expect(understood(typed(one, 'take pebble', EXITS, seed)).bindings['target']).toEqual({
        object: PEBBLE_B,
      });
    }
    // One in the open chest is farther than one on the floor beside it.
    const chested = openChest(study());
    chested.draft.place(PEBBLE_B, CHEST);
    for (let seed = 0; seed < 16; seed++) {
      expect(understood(typed(chested, 'take pebble', EXITS, seed)).bindings['target']).toEqual({
        object: PEBBLE_A,
      });
    }
  });

  it('draws from the turn’s seed among things written alike and equally near', () => {
    const meant = (seed: number): Bound | undefined =>
      understood(typed(study(), 'take pebble', EXITS, seed)).bindings['target'];
    const seeds = Array.from({ length: 32 }, (_, seed) => seed);
    for (const seed of seeds) expect(meant(seed), `seed ${seed}`).toEqual(meant(seed));
    expect(new Set(seeds.map((seed) => JSON.stringify(meant(seed))))).toEqual(
      new Set([PEBBLE_A, PEBBLE_B].map((object) => JSON.stringify({ object }))),
    );
  });
});

describe('the answers', () => {
  it("asks `which` among things that differ, in the world's words, with the line that means each", () => {
    const one = study();
    for (const line of ['take key', 'take metal', 'take the key']) {
      const which = answered(typed(one, line));
      expect(which.answer, line).toBe('which');
      expect(which.choices.map((choice) => choice.id)).toEqual([BRASS_KEY, IRON_KEY]);
      expect(which.bindings.get('candidates')).toEqual({
        binds: 'set',
        ids: [BRASS_KEY, IRON_KEY],
      });
      expect(words(which)).toBe(
        'Which do you mean: {for thing of candidates}{thing}{if $last}?{else}, {/if}{/for}',
      );
    }
    expect(answered(typed(one, 'take key')).choices.map((choice) => choice.line)).toEqual([
      'take brass key',
      'take iron key',
    ]);
    // Typed again as offered, each choice is understood.
    for (const choice of answered(typed(one, 'take key')).choices) {
      expect(understood(typed(one, choice.line)).bindings['target']).toEqual({ object: choice.id });
    }
  });

  it('asks about the one noun of a run that is in doubt, keeping the rest of the line', () => {
    const which = answered(typed(study(), 'juggle gong, key and lamp'));
    expect(which.choices.map((choice) => choice.line)).toEqual([
      'juggle gong, brass key and lamp',
      'juggle gong, iron key and lamp',
    ]);
  });

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
      expect(none.choices, line).toEqual([]);
    }
  });

  it('asks `which` before saying `not_here`, where one phrase asks and another names nothing', () => {
    // `unlock [target] with [tool]` asks which key; `unlock [target]` finds no "door with key".
    expect(answered(typed(study(), 'unlock door with key')).answer).toBe('which');
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
    expect(turn.value.choices).toEqual([]);
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

  it('carries a `which`’s choices, and reads no exit where the place gives none', () => {
    const one = study();
    const context = commandContext(one);
    const which = parseCommand('take key', one.people[0]!, context);
    if (!('answered' in which)) throw new Error('not answered');
    expect(which.choices.map((choice) => choice.line)).toEqual(['take brass key', 'take iron key']);
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
      expect(['understood', 'which', 'not_here', 'unknown'], line).toContain(kinds[0]);
      if ('understood' in outcome!) continue;
      expect('passage' in outcome!.said, line).toBe(true);
      if (outcome!.answer !== 'which') continue;
      // A `which` offers two or more, and typing any offered line asks it no more.
      expect(outcome!.choices.length, line).toBeGreaterThan(1);
      for (const choice of outcome!.choices) {
        const again = typed(one, choice.line, EXITS, seed);
        const same =
          !('understood' in again) &&
          again.answer === 'which' &&
          again.choices.map((x) => x.id).join() === outcome!.choices.map((x) => x.id).join();
        expect(same, `${line} → ${choice.line}`).toBe(false);
      }
    }
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
