// The study the command parser's specs are written about: the corpus
// world `good/grammar`, compiled, with visitors standing in
// its hall under the nicknames a case gives them, and what reading a line
// there comes to. `runtime/parser.spec.ts` and `runtime/parser/*.spec.ts`
// share it. Spec support: the package build leaves it out.

import type { Bundle } from '../bundle/bundle.js';
import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { compiledWorld } from './bundle.js';
import { turn, type Turn } from './reading.js';
import { passRules } from '../runtime/passes.js';
import { Budget } from '../runtime/budget.js';
import { Draws } from '../runtime/draws.js';
import { readCommand, type CommandContext, type CommandOutcome } from '../runtime/parser.js';
import type { CommandExit } from '../runtime/parser/exits.js';
import { declaredId, type InstanceId } from '../runtime/ids.js';

/**
 * The corpus world `good/grammar`, file by file, as its folder holds it;
 * `runtime/parser.spec.ts` holds the two to each other.
 */
export const STUDY_FILES: Readonly<Record<string, string>> = {
  'world.sprout': [
    '// What a thing is called and answers to, and the words a visitor types',
    '// for it: names and articles written and left to their defaults, nouns',
    "// added by an object and by its kind, a kind's name given to every",
    '// instance of it, and verbs typed with a thing of a kind, a set of',
    '// things, a number and a topic in their slots.',
    'world study is sprout.World {',
    '  visitors are Person',
    '  visitors arrive at hall',
    '',
    '  object hall is sprout.Place {',
    '    object brass_key is Key {',
    '      grammar {',
    '        name  "brass key"',
    '        nouns "shiny thing"',
    '      }',
    '    }',
    '    object iron_key is Key',
    '    object lamp is Lamp { grammar { article the } }',
    '    object lamp_oil is Oil',
    '    object gong is Gong {',
    '      grammar {',
    '        name    "brass disc"',
    '        article the',
    '      }',
    '    }',
    '    object pebble_a is Pebble',
    '    object pebble_b is Pebble',
    '    object chest is Chest {',
    '      object coin is Coin',
    '    }',
    '    object guard is Guard {',
    '      grammar {',
    '        name    "Oskar"',
    '        article none',
    '      }',
    '    }',
    '    object dial is Dial',
    '    object door is Door',
    '  }',
    '',
    '  object cellar is sprout.Place {',
    '    object barrel is Barrel',
    '    object ukulele is Coin { grammar { article a } }',
    '  }',
    '}',
    '',
    'enum Topic { bridge, toll, old_press }',
    '',
  ].join('\n'),
  'verbs.sprout': [
    '// A verb for each kind of slot: a thing of a kind with a tool one phrase',
    '// leaves out, a set of things, and a number.',
    'verb unlock { role target: Door  role tool: Key  "unlock [target] with [tool]"  "unlock [target]" }',
    'verb juggle { role things many  "juggle [things]" }',
    'verb turn   { role target: Dial  role number: integer  "turn [target] to [number]" }',
    '',
  ].join('\n'),
  'person.sprout': ['kind Person is sprout.Visitor { }', ''].join('\n'),
  'key.sprout': [
    '// Every key answers to `metal` as well as to its own name.',
    'kind Key {',
    '  grammar { nouns "metal" }',
    '}',
    '',
  ].join('\n'),
  'lamp.sprout': ['kind Lamp { }', ''].join('\n'),
  'oil.sprout': [
    "// Oil answers to `lamp` too, and a lamp's own name is still what `lamp` means.",
    'kind Oil {',
    '  grammar { nouns "lamp" }',
    '}',
    '',
  ].join('\n'),
  'gong.sprout': ['kind Gong { }', ''].join('\n'),
  'pebble.sprout': [
    '// A kind may name every instance of it: each pebble is "a pebble".',
    'kind Pebble {',
    '  grammar { name "pebble" }',
    '}',
    '',
  ].join('\n'),
  'chest.sprout': [
    '// Shut, so what it holds is out of reach until it opens.',
    'kind Chest {',
    '  contains',
    '  :open false',
    '  pass any (self.get(:open))',
    '  grammar { article the }',
    '}',
    '',
  ].join('\n'),
  'coin.sprout': ['kind Coin { }', ''].join('\n'),
  'guard.sprout': [
    '// The topics a guard hears are the ones it knows.',
    'kind Guard {',
    '  :knows [Topic] default [bridge, old_press]',
    '',
    '  as target for ask {',
    '    topic from :knows',
    '    do {',
    '      if (bound topic) { say "The guard nods." } else { say "The guard shrugs." }',
    '    }',
    '  }',
    '}',
    '',
  ].join('\n'),
  'dial.sprout': [
    'kind Dial {',
    '  as target for turn {',
    '    number from 1 to 12',
    '    do {',
    '      if (bound number) { say "The dial clicks round." } else { say "The dial goes no further." }',
    '    }',
    '  }',
    '}',
    '',
  ].join('\n'),
  'door.sprout': [
    'kind Door {',
    '  as target for unlock {',
    '    do { say "The lock turns over." }',
    '  }',
    '}',
    '',
  ].join('\n'),
  'barrel.sprout': ['kind Barrel { }', ''].join('\n'),
};

/** The study, compiled. */
export const STUDY: Bundle = compiledWorld('study', STUDY_FILES);

export const IN = (...path: string[]): InstanceId => declaredId('study', path);
export const HALL = IN('hall');
export const CELLAR = IN('cellar');
export const [
  BRASS_KEY,
  IRON_KEY,
  LAMP,
  LAMP_OIL,
  GONG,
  PEBBLE_A,
  PEBBLE_B,
  CHEST,
  GUARD,
  DIAL,
  DOOR,
] = [
  'brass_key',
  'iron_key',
  'lamp',
  'lamp_oil',
  'gong',
  'pebble_a',
  'pebble_b',
  'chest',
  'guard',
  'dial',
  'door',
].map((name) => IN('hall', name)) as [
  InstanceId,
  InstanceId,
  InstanceId,
  InstanceId,
  InstanceId,
  InstanceId,
  InstanceId,
  InstanceId,
  InstanceId,
  InstanceId,
  InstanceId,
];
export const COIN = IN('hall', 'chest', 'coin');
export const BARREL = IN('cellar', 'barrel');
export const UKULELE = IN('cellar', 'ukulele');

/** The exits a case says apply in the hall. */
export const EXITS: readonly CommandExit[] = [
  { direction: 'north', label: 'into the yard', to: CELLAR },
  { direction: 'down', label: 'down the cellar stair', to: CELLAR },
];

/** A study with a visitor in the hall for each nickname given, in that order. */
export interface Study extends Turn {
  readonly nicknames: ReadonlyMap<InstanceId, string>;
}

export function study(nicknames: readonly string[] = ['Marta B'], budget?: Budget): Study {
  const one = turn(
    STUDY,
    nicknames.map(() => HALL),
    budget,
  );
  return { ...one, nicknames: new Map(one.people.map((id, at) => [id, nicknames[at]!])) };
}

/**
 * What reading a line reads, in `one`, with the hall's exits, the pass
 * rules its kinds write, and a stream of draws from `seed`.
 */
export function commandContext(one: Study, exits = EXITS, seed = 7): CommandContext {
  const { draft, catalogue, budget } = one;
  const passes = passRules({
    state: draft,
    kinds: catalogue.lookup,
    caps: catalogue.caps,
    budget,
    names: catalogue.names,
  });
  const draws = new Draws(seed);
  return { state: draft, catalogue, budget, draws, passes, nicknames: one.nicknames, exits };
}

/** `line`, as the first visitor in `one` typed it, in a turn of `seed`. */
export function typed(one: Study, line: string, exits = EXITS, seed = 7): CommandOutcome {
  return readCommand(line, one.people[0]!, commandContext(one, exits, seed));
}

/** A budget of the host's figures with `steps` in place of its step budget. */
export const stepBudget = (steps: number): Budget =>
  new Budget({ ...DEFAULT_LIMITS.budgets, steps });
