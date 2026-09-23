import { describe, expect, it } from 'vitest';

import type { DestroyStatement, MoveStatement, SpawnStatement, Statement } from '../syntax/ast.js';
import { letBinding, showBindingType, valueOf } from './bindings.js';
import { narrowingOf, type CheckContext } from './check.js';
import { checkDestroy, checkEffect, checkLet, checkMove, checkSpawn } from './statements.js';
import { kindName, type KindLookup } from '../declare/kinds.js';
import { ACTOR } from '../declare/actors.js';
import { Diagnostics } from '../source/diagnostics.js';
import { parseExpression, parseStatement } from '../syntax/parse.js';
import { locationOf, SourceFile } from '../source/source.js';
import { integer } from '../declare/types.js';
import {
  at,
  bodyOf,
  kind,
  KINDS,
  PRINTER,
  saidBy,
  SHOP,
  VESSEL,
  vessel,
  warded,
} from '../fixtures/check.js';

/** A statement as written. The parse must succeed first. */

function parsed(text: string): Statement {
  const parsing = new Diagnostics();
  const statement = parseStatement(new SourceFile('b.sprout', text), parsing);
  expect(
    parsing.refusals.map((d) => d.message),
    `\`${text}\` did not parse`,
  ).toEqual([]);
  return statement!;
}

/** Read a `let` and bring it into scope, or say why it does not come. */
function named(text: string, context: CheckContext) {
  const binding = checkLet(parsed(text) as Parameters<typeof checkLet>[0], context);
  return { binding, shown: binding === null ? null : showBindingType(binding.type) };
}

/** Check a `spawn`: the kind it makes, and everything said, where it was said. */
function spawned(text: string, context: CheckContext) {
  const kind = checkSpawn(parsed(text) as SpawnStatement, context);
  return {
    kind: kind === null ? null : kindName(kind),
    said: context.diagnostics.refusals.map((d) => [locationOf(d.at), d.message, d.remedy]),
  };
}

/** Check a `move`: whether it passed, and everything said, where it was said. */
function moved(text: string, context: CheckContext) {
  const passed = checkMove(parsed(text) as MoveStatement, context);
  return {
    passed,
    said: context.diagnostics.refusals.map((d) => [locationOf(d.at), d.message, d.remedy]),
  };
}

describe('`let` names a value', () => {
  it('reads the spec’s own example, in a body that has what it needs', () => {
    const context = vessel();
    expect(named('let ribs = tools.count(Rib)', context).shown).toBe('integer');
    expect(named('let state = self.get(:inked)', context).shown).toBe('boolean');
    expect(context.scope.lookup('ribs')!.origin).toBe('let');
  });

  it('takes the expression’s type EXACTLY, widening nothing', () => {
    // An integer 0 to 9 stays an integer 0 to 9: there is nothing
    // annotated, so there is nothing to widen towards.
    expect(named('let room = self.get(:capacity)', vessel()).shown).toBe('integer 0 to 9');
    expect(named('let opens = tool.get(:opens)', warded()).shown).toBe('[Ward]');
  });

  it('may name a thing in the world, at the kind it was known by', () => {
    expect(named('let it = target', vessel()).shown).toBe('an object');
    expect(named('let key = tool', warded()).shown).toBe('shop.Key');
  });

  it('names a thing narrowed by `is()` at the kind it was narrowed to', () => {
    const context = vessel();
    const expr = parseExpression(new SourceFile('b.sprout', 'target.is(Key)'), new Diagnostics());
    const narrowing = narrowingOf(expr!, context)!;
    const branch = context.scope.narrowing(narrowing.binding, narrowing.kind);
    const inside: CheckContext = { ...context, scope: branch, diagnostics: new Diagnostics() };
    expect(named('let it = target', inside).shown).toBe('shop.Key');
  });

  it('is written once and never again', () => {
    // There is no reassignment anywhere in the language, so the only
    // way to write a name twice is to `let` it twice.
    const context = vessel();
    expect(named('let n = 1', context).shown).toBe('integer');
    expect(named('let n = 2', context).binding).toBeNull();
    expect(saidBy(context).join(' ')).toContain('`n` already names a name for a value');
    // And the first one still means what it did.
    expect(context.scope.lookup('n')!.origin).toBe('let');
  });

  it('may not take the name of a role, a loop variable, or anything else in scope', () => {
    for (const [text, first] of [
      ['let tools = 1', "this verb's role"],
      ['let self = 1', 'the role-player'],
      ['let actor = 1', 'whoever is acting'],
      ['let here = 1', "the actor's place"],
    ] as const) {
      const context = vessel();
      expect(named(text, context).binding, text).toBeNull();
      expect(saidBy(context).join(' '), text).toContain(first);
    }
  });

  it('cannot name something that changes the world, because an initializer is an expression', () => {
    const context = vessel();
    expect(named('let x = self.set(:inked, true)', context).binding).toBeNull();
    expect(saidBy(context).join(' ')).toContain('it is not a value');
    // And the name does not come into scope after a refusal.
    expect(context.scope.lookup('x')).toBeNull();
  });

  it('cannot name something that is not there', () => {
    const context = vessel();
    expect(named('let x = nothing_at_all', context).binding).toBeNull();
    expect(saidBy(context).join(' ')).toContain('Nothing here is called `nothing_at_all`');
    expect(context.scope.lookup('x')).toBeNull();
  });
});

describe('`let` names what a `spawn` makes', () => {
  it('as an object of the kind spawned', () => {
    const context = vessel();
    expect(named('let cup = spawn Rib in self', context).shown).toBe('shop.Rib');
    expect(context.scope.lookup('cup')!.origin).toBe('let');
    expect(saidBy(context)).toEqual([]);
  });

  it('names nothing when the spawn is refused', () => {
    const context = vessel();
    expect(named('let cup = spawn Kiln in self', context).binding).toBeNull();
    expect(context.scope.lookup('cup')).toBeNull();
    const target = vessel();
    expect(named('let cup = spawn Rib in shelf', target).binding).toBeNull();
    expect(target.scope.lookup('cup')).toBeNull();
  });
});

describe('a call in statement position', () => {
  it('lets through a call that writes', () => {
    const context = vessel();
    const expr = parseExpression(
      new SourceFile('b.sprout', 'self.set(:inked, true)'),
      new Diagnostics(),
    );
    expect(checkEffect(expr!, context)).toBe(true);
    expect(saidBy(context)).toEqual([]);
  });

  it('refuses a value where a statement is wanted', () => {
    const context = vessel();
    const expr = parseExpression(new SourceFile('b.sprout', 'self.get(:inked)'), new Diagnostics());
    expect(checkEffect(expr!, context)).toBe(false);
    expect(context.diagnostics.refusals[0]!.message).toContain('reads something');
  });

  it('holds a write to the write rules', () => {
    const context = vessel();
    const expr = parseExpression(
      new SourceFile('b.sprout', 'target.set(:inked, true)'),
      new Diagnostics(),
    );
    expect(checkEffect(expr!, context)).toBe(false);
    expect(saidBy(context).join(' ')).toContain('Only `self` writes its own state');
  });
});

describe('`spawn` makes a kind in something that holds things', () => {
  it('makes the kind it names, in a container the body can name', () => {
    expect(spawned('spawn Rib in self', vessel())).toEqual({ kind: 'shop.Rib', said: [] });
    expect(spawned('spawn Key in actor', vessel())).toEqual({ kind: 'shop.Key', said: [] });
    expect(spawned('spawn sprout.Container in self', vessel())).toEqual({
      kind: 'sprout.Container',
      said: [],
    });
  });

  it('accepts a container of the bare object type, which the engine checks when it runs', () => {
    // The worked microworld writes `spawn Sheet in here`, and `here` is
    // the object type: whether it holds things is known only then.
    expect(spawned('spawn Rib in here', vessel())).toEqual({ kind: 'shop.Rib', said: [] });
    expect(spawned('spawn Rib in target', vessel())).toEqual({ kind: 'shop.Rib', said: [] });
  });

  it('refuses a kind nothing declares', () => {
    expect(spawned('spawn Kiln in self', vessel()).said).toEqual([
      [
        'b.sprout:1:7',
        'Nothing here is a `Kiln`.',
        'Write a kind this world declares, or one a library it uses exports.',
      ],
    ]);
  });

  it('refuses `sprout.World` and whatever composes it, named as written', () => {
    const remedy = 'Spawn a kind of your own, as in `spawn Cup in self`.';
    expect(spawned('spawn sprout.World in self', vessel()).said).toEqual([
      [
        'b.sprout:1:7',
        '`sprout.World` is what the world is made of, and there is only ever one world.',
        remedy,
      ],
    ]);
    // A bare `World` resolves to `sprout.World` where the world declares
    // none of its own, and is named the way it was written.
    expect(KINDS.unqualified('World', 'shop')!.library).toBe('sprout');
    expect(spawned('spawn World in self', vessel()).said).toEqual([
      [
        'b.sprout:1:7',
        '`World` is what the world is made of, and there is only ever one world.',
        remedy,
      ],
    ]);
    expect(spawned('spawn Shop in self', vessel()).said).toEqual([
      [
        'b.sprout:1:7',
        '`Shop` composes `sprout.World`, which is what the world is made of, and there is only ever one world.',
        remedy,
      ],
    ]);
  });

  it('refuses a container nothing in the body answers to', () => {
    expect(spawned('spawn Rib in cupboard', vessel()).said).toEqual([
      [
        'b.sprout:1:14',
        'Nothing here is called `cupboard`.',
        'In reach: `self`, `actor`, `here`, `tools` and `target`.',
      ],
    ]);
  });

  it('refuses a dotted container, since no identifier inside a body resolves yet', () => {
    for (const text of ['spawn Rib in kiln.shelf', 'spawn Rib in self.shelf']) {
      const { kind, said } = spawned(text, vessel());
      expect(kind, text).toBeNull();
      expect(
        said.map(([where, message]) => `${where} ${message}`),
        text,
      ).toEqual([`b.sprout:1:14 Nothing here is called \`${text.slice(13)}\`.`]);
    }
  });

  it('refuses a container that is a value or a set, naming what it is', () => {
    const numbered = bodyOf(VESSEL, letBinding('n', valueOf(integer(0, 9)), at('n')));
    expect(spawned('spawn Rib in n', numbered).said).toEqual([
      [
        'b.sprout:1:14',
        'A new `Rib` goes into something that holds things, and `n` is integer 0 to 9.',
        'Name a container, as in `spawn Cup in self`.',
      ],
    ]);
    expect(spawned('spawn sprout.Container in tools', vessel()).said).toEqual([
      [
        'b.sprout:1:27',
        'A new `sprout.Container` goes into something that holds things, and `tools` is a set of shop.Rib.',
        'Name a container, as in `spawn Cup in self`.',
      ],
    ]);
  });

  it('refuses a container whose kind holds nothing', () => {
    const remedy = 'Containment is a declaration: a kind that holds things writes `contains`.';
    expect(spawned('spawn Rib in tool', warded()).said).toEqual([
      ['b.sprout:1:14', '`shop.Key` holds nothing, so nothing can be spawned in it.', remedy],
    ]);
    expect(spawned('spawn Rib in self', warded()).said).toEqual([
      ['b.sprout:1:14', '`shop.Warded` holds nothing, so nothing can be spawned in it.', remedy],
    ]);
  });

  it('says both when the kind and the container are both wrong', () => {
    const { kind, said } = spawned('spawn Kiln in shelf', vessel());
    expect(kind).toBeNull();
    expect(said.map(([where]) => where)).toEqual(['b.sprout:1:7', 'b.sprout:1:15']);
  });

  it('asks for no property, since every property has a written default', () => {
    // `Key` declares `:wear` and `:opens`; a spawn is at the defaults.
    expect(spawned('spawn Key in self', vessel()).said).toEqual([]);
  });

  it('refuses a spawn of what a person is made of, and takes an NPC’s kind', () => {
    // `Printer` composes `sprout.Visitor`; `Cat` composes only `sprout.Actor`.
    const cat = kind('Cat', [], [ACTOR], true);
    const kinds: KindLookup = {
      qualified: (library, name) =>
        library === 'shop' && name === 'Cat' ? cat : KINDS.qualified(library, name),
      unqualified: (name, from) => (name === 'Cat' ? cat : KINDS.unqualified(name, from)),
      all: () => [...KINDS.all(), cat],
    };
    expect(spawned('spawn Cat in self', { ...vessel(), kinds })).toEqual({
      kind: 'shop.Cat',
      said: [],
    });
    expect(spawned('spawn Printer in self', vessel())).toEqual({
      kind: null,
      said: [
        [
          'b.sprout:1:7',
          '`Printer` composes `sprout.Visitor`, what a person is made of, and nothing spawns a visitor: each one is a person who arrives.',
          'For an NPC, use a kind that composes `sprout.Actor` and not `sprout.Visitor`; to share it with the visitors, write `kind Creature is sprout.Actor { … }` and `kind Person is Creature, sprout.Visitor { }`.',
        ],
      ],
    });
  });
});

describe('`destroy self` removes the object whose body runs it', () => {
  const destroy = parsed('destroy self') as DestroyStatement;

  it('is accepted in the body of anything but the world', () => {
    for (const context of [vessel(), warded(), bodyOf(PRINTER)]) {
      expect(checkDestroy(destroy, context)).toBe(true);
      expect(saidBy(context)).toEqual([]);
    }
  });

  it('is refused in the world’s own body, which is never destroyed', () => {
    const context = bodyOf(SHOP);
    expect(checkDestroy(destroy, context)).toBe(false);
    expect(
      context.diagnostics.refusals.map((d) => [locationOf(d.at), d.message, d.remedy]),
    ).toEqual([
      [
        'b.sprout:1:1',
        '`destroy self` here would destroy the world, and the world is never destroyed.',
        'Write it in the body of the thing that should go.',
      ],
    ]);
  });

  it('is accepted where no kind is known for `self`', () => {
    const context: CheckContext = { ...vessel(), self: null };
    expect(checkDestroy(destroy, context)).toBe(true);
  });
});

describe('`move` moves one thing into something that holds things', () => {
  it('moves what the body names into a container it names', () => {
    for (const text of [
      'move target to self',
      'move actor to self',
      'move self to actor',
      'move target to here',
    ]) {
      expect(moved(text, vessel()), text).toEqual({ passed: true, said: [] });
    }
    // An object of a kind that holds nothing may itself move.
    expect(moved('move self to actor', warded())).toEqual({ passed: true, said: [] });
  });

  it('accepts a destination of the bare object type, which the engine checks when it runs', () => {
    expect(moved('move self to target', vessel())).toEqual({ passed: true, said: [] });
  });

  it('refuses a value or a set as what moves, naming what it is', () => {
    const numbered = bodyOf(VESSEL, letBinding('n', valueOf(integer(0, 9)), at('n')));
    expect(moved('move n to self', numbered).said).toEqual([
      [
        'b.sprout:1:6',
        '`move` moves one thing, and `n` is integer 0 to 9.',
        'Name a thing in the world, as in `move target to self`; a value goes nowhere.',
      ],
    ]);
    expect(moved('move tools to self', vessel()).said).toEqual([
      [
        'b.sprout:1:6',
        '`move` moves one thing, and `tools` is a set of shop.Rib.',
        'Name one thing, as in `move target to self`; a set is moved one of its things at a time.',
      ],
    ]);
  });

  it('refuses to move the world, which goes nowhere', () => {
    expect(moved('move self to actor', bodyOf(SHOP))).toEqual({
      passed: false,
      said: [
        [
          'b.sprout:1:6',
          '`move self` here would move the world, and the world goes nowhere.',
          'Write it in the body of the thing that should move.',
        ],
      ],
    });
  });

  it('refuses a destination that is a value or a set, or whose kind holds nothing', () => {
    const numbered = bodyOf(VESSEL, letBinding('n', valueOf(integer(0, 9)), at('n')));
    expect(moved('move self to n', numbered).said).toEqual([
      [
        'b.sprout:1:14',
        '`self` goes into something that holds things, and `n` is integer 0 to 9.',
        'Name a container, as in `move self to actor`.',
      ],
    ]);
    expect(moved('move target to tools', vessel()).said).toEqual([
      [
        'b.sprout:1:16',
        '`target` goes into something that holds things, and `tools` is a set of shop.Rib.',
        'Name a container, as in `move target to self`.',
      ],
    ]);
    expect(moved('move actor to self', warded()).said).toEqual([
      [
        'b.sprout:1:15',
        '`shop.Warded` holds nothing, so nothing can be moved into it.',
        'Containment is a declaration: a kind that holds things writes `contains`.',
      ],
    ]);
  });

  it('refuses a name nothing here answers to on either side, dotted ones included', () => {
    expect(
      moved('move cup to kiln.shelf', vessel()).said.map(([where, message]) => [where, message]),
    ).toEqual([
      ['b.sprout:1:6', 'Nothing here is called `cup`.'],
      ['b.sprout:1:13', 'Nothing here is called `kiln.shelf`.'],
    ]);
  });

  it('says both when both sides are wrong', () => {
    const { passed, said } = moved('move tools to tool', warded());
    expect(passed).toBe(false);
    expect(said.map(([where]) => where)).toEqual(['b.sprout:1:6', 'b.sprout:1:15']);
  });
});
