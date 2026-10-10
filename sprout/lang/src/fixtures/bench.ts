// The bench the carried-role and wildcard specs are written about: a shop
// whose chest is locked, a brass key and a torch that must be held
// (`sprout.RequiresHeld`), a book that need not be, an open pouch and a
// shut satchel for a case to put in a visitor's hands, an open crate on
// the floor holding a spare key, a gauge that guards every verb it is a
// tool in and then `prop` alone, and a cat who acts. `prop` is the world's
// verb whose tool is carried; `put` and `unlock` are the library's. Spec
// support: the package build leaves it out.

import type { Bundle } from '../bundle/bundle.js';
import { compiledWorld } from './bundle.js';
import { commandContext, type Study } from './parser.js';
import { turn } from './reading.js';
import { declaredId, type InstanceId } from '../runtime/ids.js';
import { readCommand, type CommandOutcome } from '../runtime/parser.js';

/** A single quote, as an import's specifier is written between them. */
const Q = "'";

/** What a spec that needs more of the bench's world adds to it, each in its place. */
export interface BenchExtras {
  /** Lines of the shop's `grammar` block, after `article the`. */
  readonly grammar?: readonly string[];
  /** Objects the shop holds, after its cat. */
  readonly objects?: readonly string[];
  /** Objects the world holds beside the shop. */
  readonly places?: readonly string[];
  /** Declarations of kinds, enums and verbs, in the world's file. */
  readonly declarations?: readonly string[];
}

/** The bench's files, with what `extras` adds. */
export function benchFiles(extras: BenchExtras = {}): Record<string, string> {
  return {
    'bench.sprout': [
      `import * as sprout from ${Q}sprout${Q}`,
      `import {prop} from ${Q}verbs${Q}`,
      '',
      'world bench is sprout.World {',
      '  visitors are Person',
      '  visitors arrive at shop',
      '',
      '  object shop is sprout.Place {',
      ...(extras.grammar === undefined
        ? ['    grammar { article the }']
        : [
            '    grammar {',
            '      article the',
            ...extras.grammar.map((line) => `      ${line}`),
            '    }',
          ]),
      '    object chest is Chest { :open false }',
      '    object brass_key is Key { grammar { name "brass key" } }',
      '    object torch is Torch',
      '    object book is Book',
      '    object pouch is Pouch',
      '    object satchel is Pouch { :open false }',
      '    object crate is sprout.Container {',
      '      object spare_key is Key { grammar { name "spare key" } }',
      '    }',
      '    object gauge is Gauge',
      '    object shelf is Shelf',
      '    object cat is Cat',
      ...(extras.objects ?? []).map((line) => `    ${line}`),
      '  }',
      ...(extras.places ?? []).map((line) => `  ${line}`),
      '}',
      '',
      'kind Person is sprout.Visitor { }',
      'kind Chest is sprout.Container, sprout.Lockable { }',
      'kind Key is sprout.RequiresHeld { grammar { nouns "key" } }',
      'kind Torch is sprout.RequiresHeld { }',
      'kind Book { }',
      'kind Pouch is sprout.Container { }',
      'kind Cat is sprout.Actor { }',
      '',
      '// Guards every verb it is a tool in, and `prop` besides, each refusing',
      '// when its flag is set.',
      'kind Gauge {',
      '  :stuck false',
      '  :bent false',
      '  as tool for any  { permit { if (self.get(:stuck)) { refuse "The gauge is stuck." } } }',
      '  as tool for prop { permit { if (self.get(:bent)) { refuse "The gauge is bent." } } }',
      '}',
      '',
      '// Refuses to be the target of anything while it is wobbly.',
      'kind Shelf {',
      '  :wobbly false',
      '  as target for any { permit { if (self.get(:wobbly)) { refuse "The shelf wobbles." } } }',
      '  as target for prop { do { say "The shelf stays put." } }',
      '}',
      ...(extras.declarations ?? []),
      '',
    ].join('\n'),
    'verbs.sprout': [
      'verb prop { role target  role tool carried  "prop [target] with [tool]" }',
      '',
    ].join('\n'),
  };
}

export const BENCH: Bundle = compiledWorld('bench', benchFiles());

const IN = (...path: string[]): InstanceId => declaredId('bench', ['shop', ...path]);
export const SHOP = IN();
export const CHEST = IN('chest');
export const BRASS_KEY = IN('brass_key');
export const TORCH = IN('torch');
export const BOOK = IN('book');
export const POUCH = IN('pouch');
export const SATCHEL = IN('satchel');
export const CRATE = IN('crate');
export const SPARE_KEY = IN('crate', 'spare_key');
export const GAUGE = IN('gauge');
export const SHELF = IN('shelf');
export const CAT = IN('cat');

/**
 * A bench with one visitor, Marta, in the shop, and each of `held` moved
 * to where the case says: `[thing, container]`, a container of `null`
 * meaning Marta herself.
 */
export function bench(held: readonly (readonly [InstanceId, InstanceId | null])[] = []): Study {
  const one = turn(BENCH, [SHOP]);
  const marta = one.people[0]!;
  for (const [thing, into] of held) one.draft.place(thing, into ?? marta);
  return { ...one, nicknames: new Map([[marta, 'Marta']]) };
}

/** `line`, as Marta typed it, with no exits. */
export function typedAtBench(one: Study, line: string): CommandOutcome {
  return readCommand(line, one.people[0]!, commandContext(one, []));
}
