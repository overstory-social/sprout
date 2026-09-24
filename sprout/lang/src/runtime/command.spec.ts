// A typed line read in the corpus world `good/grammar`: every line comes
// to exactly one reading or one of the world's answers, in the world's
// words, and what a line may cost is charged to the turn's steps. The
// areas' own rules are in `command/*.spec.ts`.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { chooser } from '../fixtures/parse.js';
import {
  BARREL,
  BRASS_KEY,
  COIN,
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
  stepBudget,
  study,
  STUDY,
  STUDY_FILES,
  typed,
} from '../fixtures/command.js';
import { Budget, BudgetExhausted } from './budget.js';
import type { CommandOutcome } from './command.js';
import type { Answer } from './command/answers.js';
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

/** The words of the passage an answer says, as the standard library writes it. */
const words = (answer: Answer): string =>
  'passage' in answer.said ? answer.said.passage.body.text.trim() : answer.said.text;

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
    // A gong answers and is no key, so the phrase does not match.
    expect(answered(typed(one, 'unlock door with gong')).answer).toBe('unknown');
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
    expect(answered(typed(one, 'give gong to b')).answer).toBe('unknown');
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
    expect(understood(typed(study(), 'take pebble')).bindings['target']).toEqual({
      object: PEBBLE_A,
    });
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

  it("says `unreachable`, in the world's words, of a thing that is there and out of reach", () => {
    const one = study();
    const inChest = answered(typed(one, 'take coin'));
    expect(inChest.answer).toBe('unreachable');
    expect(inChest.bindings.get('thing')).toEqual({ binds: 'object', id: COIN });
    expect(words(inChest)).toBe('You cannot reach {thing} from here.');
    const inRun = answered(typed(one, 'juggle gong and the coin'));
    expect([inRun.answer, inRun.bindings.get('thing')]).toEqual([
      'unreachable',
      { binds: 'object', id: COIN },
    ]);
    const inCellar = answered(typed(one, 'x the barrel'));
    expect(inCellar.answer).toBe('unreachable');
    expect(inCellar.bindings.get('thing')).toEqual({ binds: 'object', id: BARREL });
  });

  it("says `unknown`, in the world's words, of anything else, the empty line included", () => {
    const one = study();
    for (const line of ['', '   ', 'dance', 'take unicorn', 'take', 'take brass key please', ',']) {
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

  it('faults when a set role binds more things than the host allows', () => {
    const budget = new Budget({ ...DEFAULT_LIMITS.budgets, setRoleObjects: 2 });
    expect(() => typed(study(['Pip'], budget), 'juggle gong, lamp and brass key')).toThrow(
      BudgetExhausted,
    );
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
      const one = study(['Marta B', 'Pip'], new Budget({ ...DEFAULT_LIMITS.budgets, steps: 1e9 }));
      let outcome: CommandOutcome | undefined;
      expect(() => (outcome = typed(one, line)), line).not.toThrow();
      const kinds = ['understood' in outcome! ? 'understood' : outcome!.answer];
      expect(kinds, line).toHaveLength(1);
      expect(['understood', 'which', 'unreachable', 'unknown'], line).toContain(kinds[0]);
      if ('understood' in outcome!) {
        // Every thing it names is one the visitor can name.
        for (const bound of outcome.understood.bindings.values()) {
          const ids: InstanceId[] =
            'object' in bound ? [bound.object] : 'set' in bound ? [...bound.set] : [];
          for (const id of ids) expect([COIN, BARREL], line).not.toContain(id);
        }
        continue;
      }
      expect('passage' in outcome!.said, line).toBe(true);
      if (outcome!.answer !== 'which') continue;
      // A `which` offers two or more, and typing any offered line asks it no more.
      expect(outcome!.choices.length, line).toBeGreaterThan(1);
      for (const choice of outcome!.choices) {
        const again = typed(one, choice.line);
        const same =
          !('understood' in again) &&
          again.answer === 'which' &&
          again.choices.map((x) => x.id).join() === outcome!.choices.map((x) => x.id).join();
        expect(same, `${line} → ${choice.line}`).toBe(false);
      }
    }
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

  it('reads the same line to the same outcome every time', () => {
    const c = chooser(54);
    for (let run = 0; run < 50; run++) {
      const line = Array.from({ length: 1 + c.below(5) }, () => c.one(VOCABULARY)).join(' ');
      expect(typed(study(), line), line).toEqual(typed(study(), line));
    }
  });

  it('reads words however they are cased and spaced', () => {
    expect(typedWords('  Take   the BRASS key ')).toEqual(['take', 'the', 'brass', 'key']);
  });
});
