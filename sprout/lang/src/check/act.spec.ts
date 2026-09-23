import { describe, expect, it } from 'vitest';

import type { ActStatement, KindDeclaration, VerbDeclaration } from '../syntax/ast.js';
import { Diagnostics } from '../source/diagnostics.js';
import { parseDeclarations, parseStatement } from '../syntax/parse.js';
import { locationOf, SourceFile } from '../source/source.js';
import { EnumTable } from '../declare/enums.js';
import { KindTable, type KindRef } from '../declare/kinds.js';
import { VerbNames } from '../declare/roles.js';
import { VerbTable } from '../declare/verbs.js';
import { integer } from '../declare/types.js';
import {
  actorBinding,
  hereBinding,
  letBinding,
  objectOf,
  OPEN_OBJECT,
  Scope,
  selfBinding,
  setOf,
  valueOf,
} from './bindings.js';
import type { CheckContext } from './check.js';
import { checkAct } from './act.js';

/** The verbs and kinds every case acts among; `Cat` is an NPC's kind, `Visitor` a person's, and `Kettle` no actor's. */
const WORLD = `enum Topic { bridge, toll }
verb nuzzle { role target  "nuzzle [target]" }
verb unlock { role target: Lockable  role tool  "unlock [target] with [tool]"  "unlock [target]" }
verb shove  { role target  role pole  "shove [target] with [pole]" }
verb nudge  { role target  role tool optional }
verb poke   { role target  role tool }
verb ask    { role target  role topic: symbol  "ask [target] about [topic]" }
verb dial   { role target  role number: integer  "dial [number] on [target]" }
verb throw  { role target  role tools many  "throw [target] using [tools]" }
verb purr   { "purr" }
kind Lockable { }
kind Rib { }
kind Creature is sprout.Actor { }
kind Visitor is Creature, sprout.Visitor { }
kind Cat is Creature { }
kind Kettle { }
`;

const TABLES = (() => {
  const setup = new Diagnostics();
  const sprout = parseDeclarations(
    new SourceFile('sprout.sprout', 'kind Actor { contains }\nkind Visitor is Actor { }\n'),
    setup,
  );
  const shop = parseDeclarations(new SourceFile('shop.sprout', WORLD), setup);
  const enums = new EnumTable();
  enums.add(
    'shop',
    shop.filter((d) => d.kind === 'enum'),
    setup,
  );
  const declared = shop.filter((d): d is VerbDeclaration => d.kind === 'verb');
  const names = new VerbNames();
  names.add('shop', declared);
  const kinds = new KindTable();
  kinds.add(
    'sprout',
    sprout.filter((d): d is KindDeclaration => d.kind === 'kind'),
    setup,
  );
  kinds.add(
    'shop',
    shop.filter((d): d is KindDeclaration => d.kind === 'kind'),
    setup,
  );
  kinds.resolve('shop', enums, setup, undefined, { verbs: names });
  const verbs = new VerbTable();
  verbs.add('shop', declared, { kinds, enums, diagnostics: setup });
  if (setup.all.length > 0) throw new Error(setup.all.map((d) => d.message).join(' '));
  return { kinds, enums, verbs };
})();

const kind = (name: string): KindRef => TABLES.kinds.qualified('shop', name)!;

/** Where the fixture's bindings say they were written. */
const NAMES = new SourceFile('names.sprout', 'self actor here door stone ribs t n\n');
const spanOf = (word: string) => {
  const start = NAMES.text.indexOf(word);
  return NAMES.span(start, start + word.length);
};

/**
 * A `do` of `self`'s kind, with `door` a `Lockable`, `stone` of no known
 * kind, `ribs` a set of `Rib`, `t` a `Topic` and `n` a number in scope.
 */
function bodyOf(self: KindRef): CheckContext {
  const scope = Scope.root();
  const setting = new Diagnostics();
  const topic = TABLES.enums.qualified('shop', 'Topic')!;
  for (const binding of [
    selfBinding(self, spanOf('self')),
    actorBinding(kind('Visitor'), spanOf('actor')),
    hereBinding(spanOf('here')),
    letBinding('door', objectOf(kind('Lockable')), spanOf('door')),
    letBinding('stone', OPEN_OBJECT, spanOf('stone')),
    letBinding('ribs', setOf(kind('Rib')), spanOf('ribs')),
    letBinding('t', valueOf({ type: 'symbol', of: topic }), spanOf('t')),
    letBinding('n', valueOf(integer(0, 9)), spanOf('n')),
  ]) {
    scope.introduce(binding, setting);
  }
  return {
    scope,
    kinds: TABLES.kinds,
    from: 'shop',
    self,
    diagnostics: new Diagnostics(),
    acting: { verbs: TABLES.verbs },
  };
}

/** Check `text` in a body of `self`: whether it passed, and what was said, where. */
function checked(text: string, self = kind('Cat')) {
  const parsing = new Diagnostics();
  const statement = parseStatement(new SourceFile('b.sprout', text), parsing) as ActStatement;
  expect(
    parsing.refusals.map((d) => d.message),
    text,
  ).toEqual([]);
  const context = bodyOf(self);
  const passed = checkAct(statement, context);
  return {
    passed,
    said: context.diagnostics.all.map((d) => [locationOf(d.at), d.message, d.remedy]),
  };
}

describe('`act` in a body whose kind composes `sprout.Actor`', () => {
  it('takes each role filled by what it takes, and leaves out an optional tool or a set', () => {
    for (const text of [
      'act nuzzle (target: stone)',
      'act nuzzle (target: self)',
      'act unlock (target: door)',
      'act unlock (target: door, tool: stone)',
      'act nudge (target: stone)',
      'act ask (target: stone, topic: t)',
      'act ask (target: stone)',
      'act dial (number: n, target: stone)',
      'act throw (target: stone, tools: ribs)',
      'act throw (target: stone, tools: door)',
      'act throw (target: stone)',
      'act purr ()',
    ]) {
      expect(checked(text), text).toEqual({ passed: true, said: [] });
    }
  });

  it('takes it in the body of any actor: an NPC’s kind, what it shares with a person, a person’s', () => {
    for (const self of ['Cat', 'Creature', 'Visitor']) {
      expect(checked('act nuzzle (target: stone)', kind(self)), self).toEqual({
        passed: true,
        said: [],
      });
    }
  });

  it('refuses a body whose own kind does not compose `sprout.Actor`, at the word', () => {
    expect(checked('act nuzzle (target: stone)', kind('Kettle'))).toEqual({
      passed: false,
      said: [
        [
          'b.sprout:1:1',
          'Only an actor acts, and `Kettle` does not compose `sprout.Actor`.',
          "Compose `sprout.Actor` into `Kettle`, or write the `act` in a kind that composes it, as an NPC's kind does.",
        ],
      ],
    });
  });

  it('refuses a verb nothing declares, with the one most likely meant, and still reads its roles', () => {
    expect(checked('act nuzle (target: cabinet)').said).toEqual([
      [
        'b.sprout:1:5',
        'Nothing declares a verb `nuzle`. Did you mean `nuzzle`?',
        'Write `act nuzzle (…)`, or declare `verb nuzle { … }`.',
      ],
      [
        'b.sprout:1:20',
        'Nothing here is called `cabinet`.',
        'In reach: `self`, `actor`, `here`, `door`, `stone`, `ribs`, `t` and `n`.',
      ],
    ]);
  });

  it('refuses a role the verb does not declare, or names twice', () => {
    expect(checked('act nuzzle (tagret: stone)').said).toEqual([
      [
        'b.sprout:1:13',
        '`nuzzle` has no role `tagret`. Its role is `target`.',
        'Name one of them, as in `act nuzzle (target: stone)`.',
      ],
      [
        'b.sprout:1:5',
        '`act nuzzle` leaves out `target`, the role it is done to, which every reading fills.',
        'Name it: `act nuzzle (target: <what fills it>)`.',
      ],
    ]);
    expect(checked('act purr (target: stone)').said).toEqual([
      [
        'b.sprout:1:11',
        '`purr` has no roles, so only the actor takes part.',
        'Write `act purr ()`.',
      ],
    ]);
    expect(checked('act nuzzle (target: stone, target: door)').said).toEqual([
      ['b.sprout:1:28', '`target` is named twice in `act nuzzle (…)`.', 'Name each role once.'],
    ]);
  });

  it('refuses leaving out the target, or a tool that is not optional, naming why', () => {
    expect(checked('act nuzzle ()').said).toEqual([
      [
        'b.sprout:1:5',
        '`act nuzzle` leaves out `target`, the role it is done to, which every reading fills.',
        'Name it: `act nuzzle (target: <what fills it>)`.',
      ],
    ]);
    expect(checked('act shove (target: stone)').said).toEqual([
      [
        'b.sprout:1:5',
        '`act shove` leaves out `pole`, which is not optional: every phrase of `shove` fills it.',
        'Name it: `act shove (target: stone, pole: <what fills it>)`.',
      ],
    ]);
    expect(checked('act poke (target: stone)').said).toEqual([
      [
        'b.sprout:1:5',
        '`act poke` leaves out `tool`, which is not optional: `poke` does not mark it `optional`.',
        'Name it: `act poke (target: stone, tool: <what fills it>)`.',
      ],
    ]);
  });

  it('refuses a filler its role does not take, saying what to write', () => {
    const table: [string, string, string, string][] = [
      [
        'act unlock (target: stone)',
        'b.sprout:1:21',
        '`target` of `unlock` is filled by a `Lockable`, and `stone` is an object of no known kind.',
        'Read it as one first: `if (stone.is(Lockable)) { act unlock (target: stone) }`.',
      ],
      [
        'act unlock (target: self)',
        'b.sprout:1:21',
        '`target` of `unlock` is filled by a `Lockable`, and `self` is a `Cat`.',
        'Read it as one first: `if (self.is(Lockable)) { act unlock (target: self) }`.',
      ],
      [
        'act nuzzle (target: n)',
        'b.sprout:1:21',
        '`target` of `nuzzle` is filled by a thing in the world, and `n` is integer 0 to 9.',
        'Name a thing in the world, as in `act nuzzle (target: self)`.',
      ],
      [
        'act nuzzle (target: ribs)',
        'b.sprout:1:21',
        '`target` of `nuzzle` is filled by a thing in the world, and `ribs` is a set of `Rib`.',
        'Name one thing: only a role marked `many` takes a set.',
      ],
      [
        'act throw (target: stone, tools: n)',
        'b.sprout:1:34',
        '`tools` of `throw` is filled by a thing in the world, or a set of them, and `n` is integer 0 to 9.',
        'Name a thing in the world, as in `act throw (tools: self)`.',
      ],
      [
        'act ask (target: stone, topic: stone)',
        'b.sprout:1:32',
        '`topic` of `ask` is filled by an option the visitor names, and `stone` is an object of no known kind.',
        'Name a binding that holds an option, as a value role bound inside `if (bound …)` does.',
      ],
      [
        'act dial (target: stone, number: t)',
        'b.sprout:1:34',
        '`number` of `dial` is filled by a number the visitor names, and `t` is Topic.',
        'Name a binding that holds a number, as a `let` or a value role bound inside `if (bound …)` does.',
      ],
    ];
    for (const [text, where, message, remedy] of table) {
      expect(checked(text), text).toEqual({ passed: false, said: [[where, message, remedy]] });
    }
  });

  it('is an engine error to check without the verbs, which every `do` is checked with', () => {
    const parsing = new Diagnostics();
    const statement = parseStatement(new SourceFile('b.sprout', 'act purr ()'), parsing);
    const { acting: _acting, ...bare } = bodyOf(kind('Cat'));
    expect(() => checkAct(statement as ActStatement, bare)).toThrow(/no verbs to reach/);
  });
});
