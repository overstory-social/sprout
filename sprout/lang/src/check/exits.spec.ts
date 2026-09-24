import { describe, expect, it } from 'vitest';

import type { ConnectStatement } from '../syntax/ast.js';
import { Diagnostics } from '../source/diagnostics.js';
import { locationOf } from '../source/source.js';
import { kindName } from '../declare/kinds.js';
import type { Named } from '../declare/names.js';
import { BOOLEAN } from '../declare/types.js';
import type { Node } from '../source/nodes.js';
import { compileWorld } from '../fixtures/bundle.js';
import { readStatement } from '../fixtures/parse.js';
import { letBinding, objectOf, Scope, selfBinding, valueOf } from './bindings.js';
import type { CheckContext } from './check.js';
import { checkConnect, checkExit } from './exits.js';

const PERSON = { 'person.sprout': 'kind Person is sprout.Visitor { }\n' };

/** A world whose yard's grammar block holds `lines`, beside `more` files; what compiling it said. */
function said(lines: string, more: Readonly<Record<string, string>> = {}) {
  const world = [
    'world ways is sprout.World {',
    '  visitors are Person',
    '  visitors arrive at yard',
    `  object yard is sprout.Place { grammar { ${lines} } object lamp is Lamp object shelf is Shelf }`,
    '  object shop is sprout.Place { object loft is sprout.Place }',
    '}',
    '',
  ].join('\n');
  const { diagnostics } = compileWorld('ways', {
    'ways.sprout': world,
    'lamp.sprout': 'kind Lamp { :lit false :fuel 3 }\n',
    'shelf.sprout': 'kind Shelf { contains }\n',
    ...PERSON,
    ...more,
  });
  return diagnostics.map((d) => [d.severity, locationOf(d.at), d.message, d.remedy]);
}

describe('an exit, against the whole bundle', () => {
  it('leads to a place named from where it is written, by a path to one deeper, under a guard', () => {
    expect(
      said(
        'exit in "into the shop" -> shop  exit up "to the loft" -> shop.loft  exit north "on" -> shop when (!lamp.get(:lit) && self.count >= 0)',
      ),
    ).toEqual([]);
  });

  it('refuses a destination nothing is called, with the one most likely meant', () => {
    expect(said('exit in "in" -> shpo')).toEqual([
      [
        'refusal',
        'ways.sprout:4:59',
        'Nothing here is called `shpo`. Did you mean `shop`?',
        'In reach: `lamp`, `shelf`, `yard`, `shop` and `ways`.',
      ],
    ]);
  });

  it('refuses a destination that holds no actors, and the world itself', () => {
    expect(said('exit in "onto the shelf" -> shelf')).toEqual([
      [
        'refusal',
        'ways.sprout:4:71',
        '`shelf` does not hold actors, so nobody could stand where this exit leads.',
        'Lead it to a place: something that composes `sprout.Place` or writes `contains actors`.',
      ],
    ]);
    expect(said('exit up "up" -> ways')[0]!.slice(2)).toEqual([
      '`ways` is the world, and an exit leads to a place inside it.',
      'Lead the exit to a place in the world: something that composes `sprout.Place` or writes `contains actors`.',
    ]);
  });

  it('in a kind’s body, refuses a destination only where nothing of its name is a place', () => {
    const cell = (to: string) => ({
      'cell.sprout': `kind Cell is sprout.Place { grammar { exit out "out" -> ${to} } }\n`,
    });
    expect(said('', cell('shelf')).map((one) => one.slice(2))).toEqual([
      [
        'Nothing called `shelf` holds actors, so nobody could stand where this exit leads.',
        'Lead it to a place: something that composes `sprout.Place` or writes `contains actors`.',
      ],
    ]);
    expect(said('', cell('shop'))).toEqual([]);
  });

  it('refuses an exit or a link on something that is not a place', () => {
    const shelf = {
      'shelf.sprout':
        'kind Shelf { contains grammar { exit out "off" -> yard  link lift "up" } }\n',
    };
    expect(said('', shelf)).toEqual([
      [
        'refusal',
        'shelf.sprout:1:38',
        '`Shelf` is not a place, so nobody stands in it to take a way out.',
        'Write the exit on a place: something that composes `sprout.Place` or writes `contains actors`.',
      ],
      [
        'refusal',
        'shelf.sprout:1:62',
        '`Shelf` is not a place, so nobody stands in it to take a way out.',
        'Write the link on a place: something that composes `sprout.Place` or writes `contains actors`.',
      ],
    ]);
  });

  it('refuses a `when` that is not a condition, or reads who is acting', () => {
    expect(said('exit in "in" -> shop when (lamp.get(:fuel))')[0]!.slice(2)).toEqual([
      "An exit's `when` says whether it applies, so it is true or false, and this is integer.",
      'Write a condition, as in `when (self.get(:lit))`.',
    ]);
    expect(said('exit in "in" -> shop when (actor.is(Lamp))')[0]!.slice(2)).toEqual([
      "`actor` is not bound in an exit's `when`: it is asked of the place, whoever looks.",
      'Read the place through `self`, as in `when (self.get(:lit))`, or a thing by its name.',
    ]);
  });

  it('refuses a `when` that draws, since it is asked to show the ways out', () => {
    expect(said('exit in "in" -> shop when (chance(2))')[0]!.slice(2)).toEqual([
      "An exit's `when` may not use `chance`: it is asked to show a visitor the ways out, so a roll would offer a way that vanishes when taken.",
      'Roll in a `do`, a handler or a tick, keep what it gave on a property, and read that here.',
    ]);
  });

  it('warns about a `when` that is the literal `false`, which never holds', () => {
    expect(said('exit in "in" -> shop when (false)')).toEqual([
      [
        'warning',
        'ways.sprout:4:70',
        "This exit's `when` is `false`, so the exit never applies.",
        'Give it a condition that can hold, or take the exit out.',
      ],
    ]);
  });

  it('is checked by `checkExit` against the kind that wrote it, its names recorded', () => {
    const { bundle } = compileWorld('ways', {
      'ways.sprout':
        'world ways is sprout.World { visitors are Person visitors arrive at yard object yard is Cell }\n',
      'cell.sprout':
        'kind Cell is sprout.Place { grammar { exit up "up" -> yard  link onward "x" } }\n',
      ...PERSON,
    });
    const cell = bundle!.kinds.find((kind) => kind.name === 'Cell')!;
    const table = new Map<Node, Named>();
    const diagnostics = new Diagnostics();
    const setting = {
      kinds: bundle!.kindLookup,
      diagnostics,
      names: {
        source: { tree: bundle!.tree, contents: bundle!.contents },
        vantage: { in: 'kind' as const, giver: kindName(cell), path: [], self: cell },
        world: bundle!.world,
        table,
      },
    };
    expect(cell.exits.map((exit) => checkExit(exit, cell, setting))).toEqual([true, true]);
    expect(diagnostics.all).toEqual([]);
    const exit = cell.exits[0]!.line;
    // A kind has no place, so which `yard` its exit leads to is each instance's.
    expect(exit.kind === 'grammar-exit' && table.get(exit.destination)).toEqual({
      names: 'placed',
      candidates: [
        {
          steps: [{ in: 'tree', path: ['yard'] }],
          kind: expect.anything(),
          declaration: expect.anything(),
        },
      ],
    });
  });
});

describe('`connect`', () => {
  const { bundle } = compileWorld('maze', {
    'maze.sprout':
      'world maze is sprout.World { visitors are Person visitors arrive at hall object hall is Cell object stone is Stone }\n',
    'cell.sprout': 'kind Cell is sprout.Place { grammar { link onward "on"  link back "back" } }\n',
    'stone.sprout': 'kind Stone { }\n',
    ...PERSON,
  });
  const kind = (name: string) => bundle!.kinds.find((one) => one.name === name)!;

  /** `text` checked in a `do` of `Cell`, with `cell`, `stone` and `n` bound; what was said. */
  function connected(text: string) {
    const diagnostics = new Diagnostics();
    const statement = readStatement(text).statement as ConnectStatement;
    const scope = Scope.root();
    scope.introduce(selfBinding(kind('Cell'), statement.at), diagnostics);
    scope.introduce(letBinding('cell', objectOf(kind('Cell')), statement.at), diagnostics);
    scope.introduce(letBinding('rock', objectOf(kind('Stone')), statement.at), diagnostics);
    scope.introduce(letBinding('n', valueOf(BOOLEAN), statement.at), diagnostics);
    const context: CheckContext = {
      scope,
      kinds: bundle!.kindLookup,
      from: 'maze',
      self: kind('Cell'),
      diagnostics,
    };
    const accepted = checkConnect(statement, context);
    return { accepted, said: diagnostics.all.map((d) => [d.message, d.remedy]) };
  }

  it('assigns a link `self` has to a binding holding a place', () => {
    expect(connected('connect onward to cell')).toEqual({ accepted: true, said: [] });
    expect(connected('connect back to self')).toEqual({ accepted: true, said: [] });
  });

  it('refuses a link `self` does not have, naming the ones it has', () => {
    expect(connected('connect up to cell')).toEqual({
      accepted: false,
      said: [
        [
          '`Cell` has no link `up`, so there is nothing to connect.',
          'Connect one it has: `connect onward to …`, `connect back to …`.',
        ],
      ],
    });
  });

  it('offers to declare the link it names only where that name may name one', () => {
    expect(connected('connect deeper to cell').said).toEqual([
      [
        '`Cell` has no link `deeper`, so there is nothing to connect.',
        'Connect one it has: `connect onward to …`, `connect back to …`; or declare `link deeper "…"`.',
      ],
    ]);
  });

  it('names the writing body’s own links: a composed kind’s in a kind, and a named kind’s in an object', () => {
    const body = 'on :spawned (from) { connect onward to from }';
    const { diagnostics } = compileWorld('maze', {
      'maze.sprout': `world maze is sprout.World { visitors are Person visitors arrive at hall object hall is Cell { ${body} } }\n`,
      'cell.sprout': 'kind Cell is sprout.Place { grammar { link onward "on" } }\n',
      'deep.sprout': `kind Deep is Cell { ${body} }\n`,
      ...PERSON,
    });
    expect(diagnostics.map((d) => [locationOf(d.at), d.message, d.remedy])).toEqual([
      [
        'deep.sprout:1:50',
        '`Deep` has no link `onward`, so there is nothing to connect.',
        'Declare one in its grammar block, as in `link onward "deeper into the dark"`.',
      ],
    ]);
  });

  it('refuses a destination that is not a binding, is a value, or holds no actors', () => {
    expect(connected('connect onward to hall').said).toEqual([
      [
        '`hall` is not a binding, and a link leads only to a place the world made while it runs.',
        'Connect it to a binding that holds the place, as in `let cell = spawn Cell in self` then `connect onward to cell`; a place written in source is reached by an `exit`.',
      ],
    ]);
    expect(connected('connect onward to n').said).toEqual([
      [
        'A link leads to a place, and `n` is boolean.',
        'Connect it to one place, as in `connect onward to cell`.',
      ],
    ]);
    expect(connected('connect onward to rock').said).toEqual([
      [
        '`Stone` does not hold actors, so nobody could stand where this link leads.',
        'Connect it to a place: something that composes `sprout.Place` or writes `contains actors`.',
      ],
    ]);
  });
});
