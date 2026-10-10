import { describe, expect, it } from 'vitest';

import { typedWords } from '../../declare/addressing.js';
import { DEFAULT_LIMITS } from '../../bundle/limits.js';
import { compiledWorld } from '../../fixtures/bundle.js';
import { chooser } from '../../fixtures/parse.js';
import { commandContext, typed, type Study } from '../../fixtures/parser.js';
import { turn } from '../../fixtures/reading.js';
import { Budget } from '../budget.js';
import { declaredId, type InstanceId } from '../ids.js';
import { readCommand, type CommandOutcome } from '../parser.js';
import { addressOf } from './address.js';
import { holdsAll, itemsOfRun } from './runs.js';

const PANTRY = compiledWorld('pantry', {
  'pantry.sprout': [
    'world pantry is sprout.World { visitors are Person visitors arrive at pantry_room',
    '  object pantry_room is sprout.Place {',
    '    object salt is sprout.Fixture',
    '    object pepper is sprout.Fixture',
    '    object shaker is sprout.Fixture { grammar { name "salt and pepper shaker" } }',
    '    object lamp is sprout.Fixture',
    '    object brass_key is sprout.Fixture',
    '    object iron_key is sprout.Fixture',
    '    object box is sprout.Container',
    '  }',
    '}',
    'verb juggle { role things many  "juggle [things]" }',
    'enum Topic { rock_and_roll, weather }',
    'verb hum { role tune: symbol  "hum [tune]" }',
  ].join('\n'),
  'person.sprout': 'kind Person is sprout.Visitor { }\n',
});
const at = (name: string): InstanceId => declaredId('pantry', ['pantry_room', name]);
const [SALT, PEPPER, SHAKER, LAMP, BRASS_KEY, IRON_KEY, BOX] = [
  'salt',
  'pepper',
  'shaker',
  'lamp',
  'brass_key',
  'iron_key',
  'box',
].map(at) as [InstanceId, InstanceId, InstanceId, InstanceId, InstanceId, InstanceId, InstanceId];

const pantry = (): Study => ({
  ...turn(PANTRY, [declaredId('pantry', ['pantry_room'])]),
  nicknames: new Map(),
});

/**
 * What a line's first reading binds `role` to, then each turn after it: a
 * planned reading's; `afresh:` and an item's words its own turn reads; or
 * a command read from its own words.
 */
function turns(outcome: CommandOutcome, role: string): (InstanceId | string | null)[] {
  if (!('understood' in outcome)) throw new Error(`answered \`${outcome.answer}\``);
  const of = (bindings: ReadonlyMap<string, unknown>) => {
    const bound = bindings.get(role) as { object?: InstanceId } | undefined;
    return bound?.object ?? null;
  };
  return [
    of(outcome.understood.bindings),
    ...outcome.rest.map((one) => {
      if (!('planned' in one)) return one.text;
      return one.reread === undefined ? of(one.planned.bindings) : `afresh: ${one.reread.words}`;
    }),
  ];
}

const read = (line: string, seed = 7, referents: readonly InstanceId[] = []) => {
  const one = pantry();
  return readCommand(line, one.people[0]!, commandContext(one, [], seed, referents));
};

describe('the items of a run', () => {
  const one = pantry();
  const addressing = { world: one.draft.world, nicknames: one.nicknames };
  const candidates = [SALT, PEPPER, SHAKER, LAMP, BRASS_KEY, IRON_KEY, BOX].map((id, near) => {
    const instance = one.draft.instance(id)!;
    return { instance, address: addressOf(instance, addressing), near, carried: false };
  });
  const context = { budget: new Budget(DEFAULT_LIMITS.budgets), referents: [] };
  const take = PANTRY.verbs.qualified('sprout', 'take')!.roles[0]!;
  const items = (line: string, role = take) => {
    const words = typedWords(line);
    return itemsOfRun(words, role, candidates, context)?.map(({ start, end }) =>
      words.slice(start, end).join(' '),
    );
  };

  it('are its nouns, split at `and` and commas, a comma before `and` or not', () => {
    expect(items('salt and lamp')).toEqual(['salt', 'lamp']);
    expect(items('salt, lamp and box')).toEqual(['salt', 'lamp', 'box']);
    expect(items('salt, lamp, and box')).toEqual(['salt', 'lamp', 'box']);
    expect(items('the salt, the lamp')).toEqual(['the salt', 'the lamp']);
  });

  it('read a name that holds `and` whole where it names something, the longest first', () => {
    expect(items('salt and pepper shaker')).toBeUndefined();
    expect(items('the salt and pepper shaker and the lamp')).toEqual([
      'the salt and pepper shaker',
      'the lamp',
    ]);
    expect(items('lamp and salt and pepper shaker')).toEqual(['lamp', 'salt and pepper shaker']);
    // Adjectives alone name the shaker only weakly, so the run splits.
    expect(items('salt and pepper')).toEqual(['salt', 'pepper']);
  });

  it('are no more than a set role may bind, as `all` takes, the host’s figure', () => {
    const words = typedWords('salt, pepper, lamp and box');
    const capped = {
      ...context,
      budget: new Budget({ ...DEFAULT_LIMITS.budgets, setRoleObjects: 2 }),
    };
    const kept = itemsOfRun(words, take, candidates, capped)!;
    expect(kept.map(({ start, end }) => words.slice(start, end).join(' '))).toEqual([
      'salt',
      'pepper',
    ]);
    expect(items('salt, pepper, lamp and box')).toHaveLength(4);
  });

  it('hold `all` as no thing, before or after the others', () => {
    expect(holdsAll(typedWords('lamp and all'))).toBe(true);
    expect(holdsAll(typedWords('all, lamp'))).toBe(true);
    expect(holdsAll(typedWords('all'))).toBe(false);
    expect(holdsAll(typedWords('lamp and ball'))).toBe(false);
  });

  it('try no stretch wider than a name in reach holds connectors', () => {
    const budget = new Budget(DEFAULT_LIMITS.budgets);
    const plain = candidates.filter(({ instance }) => instance.id !== SHAKER);
    const words = typedWords(Array.from({ length: 40 }, () => 'salt').join(' and '));
    expect(itemsOfRun(words, take, plain, { ...context, budget })).toHaveLength(8);
    const withoutShaker = budget.spentSteps;
    expect(withoutShaker).toBeLessThan(40 * plain.length * 2);
  });

  it('are none for one noun, an empty noun, a set role or a value role', () => {
    expect(items('lamp')).toBeUndefined();
    expect(items('lamp and')).toBeUndefined();
    expect(items('lamp, , box')).toBeUndefined();
    const juggle = PANTRY.verbs.qualified('pantry', 'juggle')!.roles[0]!;
    expect(items('salt and lamp', juggle)).toBeUndefined();
    const hum = PANTRY.verbs.qualified('pantry', 'hum')!.roles[0]!;
    expect(items('rock and roll', hum)).toBeUndefined();
  });
});

describe('a run in a role that takes one thing', () => {
  it('reads the first item, and plans a reading for each after it, in the order written', () => {
    expect(turns(read('take salt and lamp'), 'target')).toEqual([SALT, LAMP]);
    expect(turns(read('take box, pepper, and salt'), 'target')).toEqual([BOX, PEPPER, SALT]);
    expect(turns(read('put salt and pepper in box'), 'item')).toEqual([SALT, PEPPER]);
    expect(turns(read('put salt and pepper in box'), 'container')).toEqual([BOX, BOX]);
  });

  it('reads a name holding `and` whole, and as one item of a run', () => {
    expect(turns(read('take salt and pepper shaker'), 'target')).toEqual([SHAKER]);
    expect(turns(read('take salt and pepper shaker and lamp'), 'target')).toEqual([SHAKER, LAMP]);
  });

  it('keeps what a pronoun in another role named when the line began', () => {
    expect(turns(read('put salt and lamp in it', 7, [BOX]), 'container')).toEqual([BOX, BOX]);
  });

  it('leaves an item that names nothing, or ties, for its own turn to read afresh', () => {
    expect(turns(read('take lamp and unicorn and salt'), 'target')).toEqual([
      LAMP,
      'afresh: unicorn',
      SALT,
    ]);
    expect(turns(read('take lamp and key'), 'target')).toEqual([LAMP, 'afresh: key']);
    // The item's turn reads its words alone: every other role is planned as the line bound it.
    const outcome = read('put salt and key in it', 7, [BOX]);
    const later = 'understood' in outcome ? outcome.rest[0] : undefined;
    // With what `it` named when the line began, for the item's turn to read its words by.
    expect(later !== undefined && 'planned' in later && later.reread).toEqual({
      role: 'item',
      words: 'key',
      values: [],
      referents: [BOX],
    });
    expect(later !== undefined && 'planned' in later && [...later.planned.bindings]).toEqual([
      ['container', { object: BOX }],
    ]);
    expect(turns(read('take lamp and brass key'), 'target')).toEqual([LAMP, BRASS_KEY]);
  });

  it('is not understood where `all` or `everything` is one of its things, before the others or after', () => {
    for (const line of ['take lamp and all', 'take all and lamp', 'take everything and lamp']) {
      const outcome = read(line);
      expect('answer' in outcome && outcome.answer, line).toBe('unknown');
    }
  });

  it('is `not_here` where its first item names nothing, and `unknown` where a word of it names nothing in the world', () => {
    const outcome = read('take the lamp in the box and lamp');
    expect('answer' in outcome && outcome.answer).toBe('not_here');
    const unicorn = read('take unicorn and lamp');
    expect('answer' in unicorn && unicorn.answer).toBe('unknown');
  });

  it('is no run in a set role, which binds every item at once', () => {
    const outcome = read('juggle salt and lamp');
    expect('understood' in outcome && outcome.understood.bindings.get('things')).toEqual({
      set: [SALT, LAMP],
    });
    expect('understood' in outcome && outcome.rest).toEqual([]);
  });
});

describe('`and` before a verb', () => {
  it('joins two commands, the second read on its own turn', () => {
    expect(turns(read('take salt and take lamp'), 'target')).toEqual([SALT, 'take lamp']);
    expect(turns(read('take salt, and look'), 'target')).toEqual([SALT, 'look']);
  });

  it('runs a run before the command it joins', () => {
    expect(turns(read('take salt and lamp and take box'), 'target')).toEqual([
      SALT,
      LAMP,
      'take box',
    ]);
  });

  it('splits a line whose words a value role took but no one hears', () => {
    const outcome = read('hum weather and take lamp');
    expect('understood' in outcome && outcome.rest).toEqual([{ text: 'take lamp' }]);
  });

  it('splits a line whose first command names nothing, which answers it', () => {
    const boxed = read('take the lamp in the box and take lamp');
    expect('answer' in boxed && boxed.answer).toBe('not_here');
    const unicorn = read('take unicorn and take lamp');
    expect('answer' in unicorn && unicorn.answer).toBe('unknown');
    const dance = read('dance and take lamp');
    expect('answer' in dance && dance.answer).toBe('unknown');
  });
});

describe('a run of names in reach (generated)', () => {
  const NAMES: readonly [string, InstanceId][] = [
    ['salt', SALT],
    ['pepper', PEPPER],
    ['the salt and pepper shaker', SHAKER],
    ['lamp', LAMP],
    ['the brass key', BRASS_KEY],
    ['iron key', IRON_KEY],
    ['box', BOX],
  ];

  it('runs once for each name, in the order written, however its connectors are written', () => {
    const c = chooser(448);
    for (let run = 0; run < 200; run++) {
      const picked = Array.from({ length: 2 + c.below(4) }, () => c.one(NAMES));
      const names = picked.map(([name]) => name);
      const last = names.pop()!;
      const joined = `${names.join(c.one([', ', ' and ']))}${c.one([' and ', ', and ', ', '])}${last}`;
      const line = `take ${joined}`;
      const outcome = typed(pantry(), line, [], c.below(1000));
      expect(turns(outcome, 'target'), line).toEqual(picked.map(([, id]) => id));
    }
  });
});
