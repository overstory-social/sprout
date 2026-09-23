// The world itself is where visitors arrive only when it is a place: its
// own body says `contains actors`, or a kind it composes beside
// `sprout.World` does. A kind it composes that is not there leaves
// whether it is a place unknown, which is a gap and not a refusal.

import { describe, expect, it } from 'vitest';

import type { KindDeclaration, WorldDeclaration } from '../../syntax/ast.js';
import { KindTable } from '../kinds.js';
import { Diagnostics } from '../../source/diagnostics.js';
import { parseDeclarations } from '../../syntax/parse.js';
import { SourceFile, textOf } from '../../source/source.js';
import { placeObjects } from '../tree.js';
import { resolveArrival } from '../world.js';
import { ENUMS } from '../../fixtures/world.js';

describe('the world is where visitors arrive only when it is a place', () => {
  it('is one where its own body says `contains actors`', () => {
    const { found, said } = arrivingAtShop('contains actors');
    expect(said).toEqual([]);
    expect(found).toEqual({ found: 'place', path: [] });
  });

  it('is one where a kind it composes beside `sprout.World` holds actors', () => {
    const { found, said } = arrivingAtShop('', ', victorian.Hall', {
      victorian: 'kind Hall {\n  contains actors\n}',
    });
    expect(said).toEqual([]);
    expect(found).toEqual({ found: 'place', path: [] });
  });

  it('is not one for holding things, and is refused at its name in the path', () => {
    const { found, said, remedies, where } = arrivingAtShop('contains');
    expect(found).toEqual({ found: 'refused' });
    expect(said).toEqual(['`shop` is not a place, and visitors arrive in one.']);
    expect(remedies).toEqual([
      "Write `contains actors` in the world's body to make it a place, or name a place in it for visitors to arrive at.",
    ]);
    expect(where).toEqual(['shop']);
  });

  it('is not known to be one when a kind it composes is not there, which is a gap', () => {
    const { found, said } = arrivingAtShop('', ', Hal', {
      shop: 'kind Hall {\n  contains actors\n}',
    });
    expect(said).toEqual([]);
    expect(found).toMatchObject({
      found: 'absent',
      message:
        'Nothing here is a `Hal`. Did you mean `Hall`? `shop` is made of it, so it is not known to be a place for visitors to arrive in.',
      said: false,
    });
  });

  /** `visitors arrive at shop`, the world's body holding `line`. */
  function arrivingAtShop(
    line: string,
    composes = '',
    libraries: Readonly<Record<string, string>> = {},
  ) {
    const diagnostics = new Diagnostics();
    const parsing = new Diagnostics();
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
    kinds.resolve('shop', ENUMS, diagnostics);
    const declaredWorld = parseDeclarations(
      new SourceFile(
        'shop.sprout',
        `world shop: sprout.World${composes} {\n  ${line}\n  visitors arrive at shop\n}`,
      ),
      parsing,
    ).find((d): d is WorldDeclaration => d.kind === 'world')!;
    expect(parsing.refusals.map((d) => d.message)).toEqual([]);
    const tree = placeObjects([], { world: 'shop', diagnostics });
    const found = resolveArrival(declaredWorld, {
      tree,
      objects: [],
      kinds,
      from: 'shop',
      diagnostics,
    });
    return {
      found,
      said: diagnostics.all.map((d) => d.message),
      remedies: diagnostics.all.map((d) => d.remedy),
      where: diagnostics.all.map((d) => textOf(d.at)),
    };
  }
});
