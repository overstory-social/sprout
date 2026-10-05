import { describe, expect, it } from 'vitest';

import { Diagnostics } from '../source/diagnostics.js';
import { locationOf } from '../source/source.js';
import { kindName } from '../declare/kinds.js';
import type { Named } from '../declare/names.js';
import type { Node } from '../source/nodes.js';
import { compileWorld } from '../fixtures/bundle.js';
import { checkLit } from './lit.js';

const PERSON = { 'person.sprout': 'kind Person is sprout.Visitor { }\n' };

/** A world whose cellar's grammar block holds `lines`, beside `more` files; what compiling it said. */
function said(lines: string, more: Readonly<Record<string, string>> = {}) {
  const world = [
    'world dark is sprout.World {',
    '  visitors are Person',
    '  visitors arrive at cellar',
    `  object cellar is sprout.Place { grammar { ${lines} } object lamp is Lamp }`,
    '}',
    '',
  ].join('\n');
  const { diagnostics } = compileWorld('dark', {
    'dark.sprout': world,
    'lamp.sprout': 'kind Lamp is sprout.LightSource { :fuel 3 }\n',
    ...PERSON,
    ...more,
  });
  return diagnostics.map((d) => [d.severity, locationOf(d.at), d.message, d.remedy]);
}

describe('a place’s `lit`, against the whole bundle', () => {
  it('is a condition over the place, reading `sees` and its own names', () => {
    expect(said('lit (self.sees(sprout.LightSource, :lit))')).toEqual([]);
    expect(said('lit (self.sees(Lamp, :lit) || lamp.get(:fuel) > 5)')).toEqual([]);
  });

  it('refuses a condition that is not true or false', () => {
    expect(said('lit (3)').map((one) => one.slice(2))).toEqual([
      [
        "A place's `lit` says whether it can be seen, so it is true or false, and this is integer.",
        'Write a condition, as in `lit (self.sees(sprout.LightSource, :lit))`.',
      ],
    ]);
  });

  it('withholds `actor` and `here`, since it is asked of the place whoever looks', () => {
    expect(said('lit (actor.holds(lamp))').map((one) => one[2])).toEqual([
      "`actor` is not bound in a place's `lit`: it is asked of the place, whoever looks.",
    ]);
    expect(said('lit (here == self)').map((one) => one[2])).toEqual([
      "`here` is not bound in a place's `lit`: it is asked of the place, whoever looks.",
    ]);
  });

  it('draws nothing', () => {
    expect(said('lit (chance(2))').map((one) => one[2])).toEqual([
      "A place's `lit` may not use `chance`: it is asked whenever anyone there looks or acts, so a roll would show a room that flickers while nobody acts.",
    ]);
  });

  it('refuses `sees` of a property that is not a boolean, or not declared', () => {
    expect(said('lit (self.sees(Lamp, :fuel))').map((one) => one[2])).toEqual([
      '`sees` asks whether something it sees has `:fuel` true, and `:fuel` is not a boolean it holds.',
    ]);
    expect(said('lit (self.sees(Lamp, :wick))')).toHaveLength(1);
  });

  it('is refused on what is not a place', () => {
    expect(said('', { 'jar.sprout': 'kind Jar { grammar { lit (true) } }\n' })).toEqual([
      [
        'refusal',
        'jar.sprout:1:22',
        '`Jar` is not a place, so nobody stands in it to see by its light.',
        'Write `lit` on a place: something that composes `sprout.Place` or writes `contains actors`.',
      ],
    ]);
  });

  it('is checked by `checkLit` against the kind that wrote it, and returns whether it was accepted', () => {
    const { bundle } = compileWorld('dark', {
      'dark.sprout':
        'world dark is sprout.World { visitors are Person visitors arrive at cellar object cellar is Cave }\n',
      'cave.sprout': 'kind Cave is sprout.Place { grammar { lit (self.count > 1) } }\n',
      ...PERSON,
    });
    const cave = bundle!.kinds.find((kind) => kind.name === 'Cave')!;
    const diagnostics = new Diagnostics();
    const table = new Map<Node, Named>();
    const setting = {
      kinds: bundle!.kindLookup,
      diagnostics,
      names: {
        source: { tree: bundle!.tree, contents: bundle!.contents },
        vantage: { in: 'kind' as const, giver: kindName(cave), path: [], self: cave },
        world: bundle!.world,
        table,
      },
    };
    expect(checkLit(cave.grammar.lit!.value, cave, setting)).toBe(true);
    expect(diagnostics.all).toEqual([]);
  });
});
