import { describe, expect, it } from 'vitest';

import type { Declaration, WorldDeclaration } from '../../syntax/ast.js';
import type { Manifest, MicroworldSource } from '../bundle.js';
import { resolveDeclarations } from '../declarations.js';
import { STANDARD_LIBRARY } from '../standard-library.js';
import { Diagnostics } from '../../source/diagnostics.js';
import { parseDeclarations } from '../../syntax/parse.js';
import { kindName } from '../../declare/kinds.js';
import { locationOf, SourceFile } from '../../source/source.js';
import { Report } from './report.js';
import { oneWorld, worldKinds } from './world.js';

const MANIFEST = new SourceFile('sprout.json', '{\n  "name": "shop"\n}\n');

/** The declarations of `own` as the world `shop`'s, and of the standard library, by library. */
function byLibraryOf(own: string, library = ''): Map<string, Declaration[]> {
  const parsing = new Diagnostics();
  const byLibrary = new Map<string, Declaration[]>([
    ['shop', parseDeclarations(new SourceFile('world.sprout', own), parsing)],
    ['sprout', STANDARD_LIBRARY.files.flatMap((file) => parseDeclarations(file, parsing))],
  ]);
  if (library !== '') {
    byLibrary.set('victorian', parseDeclarations(new SourceFile('v.sprout', library), parsing));
  }
  expect(parsing.refusals.map((d) => d.message)).toEqual([]);
  return byLibrary;
}

/** `oneWorld` over `own`, in `mode`, with `ownFileRefused` as a case says. */
function one(own: string, mode: 'publish' | 'load' = 'publish', refused = false, library = '') {
  const source = {
    manifestFile: MANIFEST,
    manifest: { name: 'shop', namespace: 'shop' } as Manifest,
    files: [],
    libraries: [],
  } satisfies MicroworldSource;
  const report = new Report(mode, MANIFEST.span(0, 0));
  const world = oneWorld(source, byLibraryOf(own, library), refused, report);
  return {
    world,
    said: report.diagnostics.all.map((d) => `${locationOf(d.at)} ${d.message}`),
    absent: report.absent.map((a) => [a.what, a.kind]),
  };
}

/** `worldKinds` over `own`, in `mode`. */
function kinds(own: string, mode: 'publish' | 'load' = 'publish', refused = false) {
  const report = new Report(mode, MANIFEST.span(0, 0));
  const byLibrary = byLibraryOf(own);
  const tables = resolveDeclarations(byLibrary, { namespace: 'shop', name: 'shop' }, report);
  const declared = byLibrary.get('shop')!.find((d): d is WorldDeclaration => d.kind === 'world')!;
  const before = report.diagnostics.all.length;
  const found = worldKinds(declared, tables, 'shop', refused, report);
  return {
    ...found,
    said: report.diagnostics.all.slice(before).map((d) => `${locationOf(d.at)} ${d.message}`),
    absent: report.absent.map((a) => [a.what, a.kind]),
  };
}

const WORLD = 'world shop: sprout.World { visitors are Visitor visitors arrive at shop }';
const VISITOR = 'kind Visitor: sprout.Actor { }';

describe('a bundle holds one world, named as the manifest', () => {
  it('gives back the one there is', () => {
    const { world, said } = one(WORLD);
    expect(said).toEqual([]);
    expect(world!.name.text).toBe('shop');
  });

  it('refuses none at publish, at the manifest’s name, and records it at load', () => {
    expect(one('enum A { b }').said).toEqual([
      'sprout.json:2:3 This world has no `world` declaration.',
    ]);
    expect(one('enum A { b }', 'load').absent).toEqual([['shop', 'world']]);
  });

  it('does not say there is none at publish while one of its own files was refused', () => {
    expect(one('enum A { b }', 'publish', true).said).toEqual([]);
  });

  it('refuses a second at its name, and one under another name', () => {
    expect(one(`${WORLD}\n${WORLD}`)).toMatchObject({
      world: null,
      said: ['world.sprout:2:7 There are two `world` declarations, and a world has one.'],
    });
    expect(one('world yard: sprout.World { }').said).toEqual([
      "world.sprout:1:7 `yard` is not this world's name.",
    ]);
  });

  it('refuses a world or an object declared in a library', () => {
    const { said } = one(
      WORLD,
      'publish',
      false,
      'world v: sprout.World { }\nobject lamp: Voice in v',
    );
    expect(said).toEqual([
      'v.sprout:1:7 A library does not declare a world.',
      'v.sprout:2:8 A library does not declare an object, and `lamp` is one.',
    ]);
  });
});

describe('what the world and its visitors are made of', () => {
  it('is the world composed, and the world’s own kind composing `sprout.Actor`', () => {
    const { world, visitor, said } = kinds(`${WORLD}\n${VISITOR}`);
    expect(said).toEqual([]);
    expect(world!.order).toEqual(['sprout.World', 'shop.shop']);
    expect(kindName(visitor!)).toBe('shop.Visitor');
  });

  it('refuses a kind the world composes that nothing declares at publish, and at load admits no one', () => {
    const text = `world shop: sprout.World, Voice { visitors are Visitor }\n${VISITOR}`;
    expect(kinds(text).said).toEqual(['world.sprout:1:27 Nothing here is a `Voice`.']);
    const loaded = kinds(text, 'load');
    expect(loaded.world).toBeNull();
    expect(loaded.visitor).not.toBeNull();
    expect(loaded.absent).toEqual([['Voice', 'world']]);
  });

  it('records the world absent at load when a kind it composes could not be made', () => {
    const text = `world shop: sprout.World, Lamp { visitors are Visitor }\nkind Lamp: Nope { }\n${VISITOR}`;
    const loaded = kinds(text, 'load');
    expect(loaded.world).toBeNull();
    expect(loaded.absent).toEqual([
      ['Nope', 'kind-in-composition'],
      ['shop', 'world'],
    ]);
    expect(loaded.said).toEqual([
      'world.sprout:1:7 `shop` is made of a kind that is absent. The world does not admit anyone, and the host says so outside it.',
    ]);
    // At publish what stopped it has been refused already, and is all that is said.
    expect(kinds(text).said).toEqual([]);
  });

  it('refuses a visitor kind nothing declares at publish, and at load admits no one', () => {
    const text = 'world shop: sprout.World { visitors are Visitor }';
    expect(kinds(text).said).toEqual(['world.sprout:1:41 Nothing here is a `Visitor`.']);
    const loaded = kinds(text, 'load');
    expect(loaded.visitor).toBeNull();
    expect(loaded.world).not.toBeNull();
    expect(loaded.absent).toEqual([['Visitor', 'world']]);
  });

  it('does not say the visitor kind is missing at publish while an own file was refused', () => {
    expect(
      kinds('world shop: sprout.World { visitors are Visitor }', 'publish', true).said,
    ).toEqual([]);
  });

  it('refuses a visitor kind that is not an actor in either mode, since nothing is missing', () => {
    for (const mode of ['publish', 'load'] as const) {
      const found = kinds(
        'world shop: sprout.World { visitors are Hall }\nkind Hall: sprout.Place { }',
        mode,
      );
      expect(found.visitor, mode).toBeNull();
      expect(found.absent, mode).toEqual([]);
      expect(found.said, mode).toEqual([
        "world.sprout:1:41 `Hall` is not an actor, and a world's visitors are made of one.",
      ]);
    }
  });
});
