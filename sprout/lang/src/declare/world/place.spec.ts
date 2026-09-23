// The world itself is never where visitors arrive (the spec's Actors and
// visitors), whatever it declares: not where its own body says
// `contains actors`, not where a kind it composes beside `sprout.World`
// holds actors, and not where such a kind is not there. It is refused in
// either mode at its name, and the remedy names a place inside the world
// where there is one.

import { describe, expect, it } from 'vitest';

import type { KindDeclaration, WorldDeclaration } from '../../syntax/ast.js';
import { KindTable } from '../kinds.js';
import { Diagnostics } from '../../source/diagnostics.js';
import { parseDeclarations } from '../../syntax/parse.js';
import { SourceFile, textOf } from '../../source/source.js';
import { objectsIn, resolveObjects } from '../objects.js';
import { placeObjects } from '../tree.js';
import { resolveArrival } from '../world.js';
import { ENUMS } from '../../fixtures/world.js';

const IT_IS_THE_WORLD = '`shop` is the world itself, and visitors arrive in a place inside it.';
const DECLARE_ONE =
  'Declare a place in the world, an object that composes `sprout.Place` or writes `contains actors` in its body, and name it here.';

describe('the world itself is never where visitors arrive', () => {
  it('is refused where its own body says `contains actors`', () => {
    const { found, said, remedies, where } = arrivingAtShop('contains actors');
    expect(found).toEqual({ found: 'refused' });
    expect(said).toEqual([IT_IS_THE_WORLD]);
    expect(remedies).toEqual([DECLARE_ONE]);
    expect(where).toEqual(['shop']);
  });

  it('is refused where a kind it composes beside `sprout.World` holds actors', () => {
    const { found, said } = arrivingAtShop('', ', victorian.Hall', {
      victorian: 'kind Hall {\n  contains actors\n}',
    });
    expect(found).toEqual({ found: 'refused' });
    expect(said).toEqual([IT_IS_THE_WORLD]);
  });

  it('is refused where it only holds things', () => {
    const { found, said } = arrivingAtShop('contains');
    expect(found).toEqual({ found: 'refused' });
    expect(said).toEqual([IT_IS_THE_WORLD]);
  });

  it('is refused, not a gap, where a kind it composes is not there', () => {
    const { found, said } = arrivingAtShop('', ', Hal', {
      shop: 'kind Hall {\n  contains actors\n}',
    });
    expect(found).toEqual({ found: 'refused' });
    expect(said).toEqual([IT_IS_THE_WORLD]);
  });

  it('names a place in the world to arrive at instead, the shallowest first declared', () => {
    const { remedies } = arrivingAtShop(
      'contains actors',
      '',
      {},
      'kind Room {\n  contains actors\n}\nkind Box {\n  contains\n}\n',
      'object crate is Box {\n    object nook is Room\n  }\n  object hall is Room',
    );
    expect(remedies).toEqual(['Name a place in the world, as in `visitors arrive at hall`.']);
  });

  it('names a deeper place by its path when that is the only one', () => {
    const { remedies } = arrivingAtShop(
      '',
      '',
      {},
      'kind Room {\n  contains actors\n}\nkind Box {\n  contains\n}\n',
      'object crate is Box {\n    object nook is Room\n  }',
    );
    expect(remedies).toEqual(['Name a place in the world, as in `visitors arrive at crate.nook`.']);
  });

  /**
   * `visitors arrive at shop`, the world's body holding `line` and the
   * objects `inside`, beside `rest`.
   */
  function arrivingAtShop(
    line: string,
    composes = '',
    libraries: Readonly<Record<string, string>> = {},
    rest = '',
    inside = '',
  ) {
    const parsing = new Diagnostics();
    const diagnostics = new Diagnostics();
    const kinds = new KindTable();
    for (const [library, source] of Object.entries(libraries)) {
      kinds.add(
        library,
        parseDeclarations(new SourceFile(`${library}.sprout`, source), parsing).filter(
          (d): d is KindDeclaration => d.kind === 'kind',
        ),
        diagnostics,
      );
    }
    const declarations = parseDeclarations(
      new SourceFile(
        'shop.sprout',
        `world shop is sprout.World${composes} {\n  ${line}\n  visitors arrive at shop\n  ${inside}\n}\n${rest}`,
      ),
      parsing,
    );
    expect(parsing.refusals.map((d) => d.message)).toEqual([]);
    kinds.add(
      'shop',
      declarations.filter((d): d is KindDeclaration => d.kind === 'kind'),
      diagnostics,
    );
    kinds.resolve('shop', ENUMS, diagnostics);
    const world = declarations.find((d): d is WorldDeclaration => d.kind === 'world')!;
    const objects = resolveObjects('shop', objectsIn(world), {
      enums: ENUMS,
      kinds,
      diagnostics,
    });
    const tree = placeObjects(objects, { world: 'shop', diagnostics });
    const before = diagnostics.all.length;
    const found = resolveArrival(world, { tree, objects, kinds, from: 'shop', diagnostics });
    const said = diagnostics.all.slice(before);
    return {
      found,
      said: said.map((d) => d.message),
      remedies: said.map((d) => d.remedy),
      where: said.map((d) => textOf(d.at)),
    };
  }
});
