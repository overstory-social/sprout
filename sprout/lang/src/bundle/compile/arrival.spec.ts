import { describe, expect, it } from 'vitest';

import type { Declaration, WorldDeclaration } from '../../syntax/ast.js';
import { resolveDeclarations } from '../declarations.js';
import { STANDARD_LIBRARY } from '../standard-library.js';
import { Diagnostics } from '../../source/diagnostics.js';
import { parseDeclarations } from '../../syntax/parse.js';
import { locationOf, SourceFile } from '../../source/source.js';
import { arrivalPlace } from './arrival.js';
import { Report } from './report.js';

/** Where visitors arrive in the world `shop` written as `own`, in `mode`. */
function arriving(own: string, mode: 'publish' | 'load' = 'publish', refused = false) {
  const parsing = new Diagnostics();
  const byLibrary = new Map<string, Declaration[]>([
    ['shop', parseDeclarations(new SourceFile('world.sprout', own), parsing)],
    ['sprout', STANDARD_LIBRARY.files.flatMap((file) => parseDeclarations(file, parsing))],
  ]);
  expect(parsing.refusals.map((d) => d.message)).toEqual([]);
  const report = new Report(mode, new SourceFile('sprout.json', '').span(0, 0));
  const tables = resolveDeclarations(byLibrary, { namespace: 'shop', name: 'shop' }, report);
  const declared = byLibrary.get('shop')!.find((d): d is WorldDeclaration => d.kind === 'world')!;
  const before = report.diagnostics.all.length;
  const path = arrivalPlace(declared, tables, 'shop', refused, report);
  return {
    path,
    said: report.diagnostics.all.slice(before).map((d) => `${locationOf(d.at)} ${d.message}`),
    absent: report.absent.map((a) => [a.what, a.kind]),
  };
}

const at = (place: string, more = '') =>
  `world shop: sprout.World { visitors arrive at ${place} }\nobject hall: sprout.Place in shop\n${more}`;

describe('where visitors arrive, as a compile records it', () => {
  it('is the path of a place, and the world’s is the empty one', () => {
    expect(arriving(at('hall')).path).toEqual(['hall']);
    expect(
      arriving('world shop: sprout.World { contains actors visitors arrive at shop }').path,
    ).toEqual([]);
  });

  it('refuses a place nothing answers to at publish, and records it at load', () => {
    expect(arriving(at('hal'))).toEqual({
      path: null,
      said: ['world.sprout:1:47 Nothing here is called `hal`. Did you mean `hall`?'],
      absent: [],
    });
    const loaded = arriving(at('hal'), 'load');
    expect(loaded.path).toBeNull();
    expect(loaded.absent).toEqual([['hal', 'place-of-arrival']]);
  });

  it('says nothing of it at publish while one of the world’s own files was refused', () => {
    expect(arriving(at('yard'), 'publish', true).said).toEqual([]);
    expect(arriving(at('yard'), 'load', true).absent).toEqual([['yard', 'place-of-arrival']]);
  });

  it('tells an absent place once at publish, through what left it absent', () => {
    const { said } = arriving(at('yard', 'object yard: Nope in shop'));
    expect(said).toEqual([]);
  });
});
