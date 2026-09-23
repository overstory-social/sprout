import { describe, expect, it } from 'vitest';

import type { Declaration, WorldDeclaration } from '../../syntax/ast.js';
import {
  libraryHash,
  type LibrarySource,
  type Manifest,
  type MicroworldSource,
} from '../bundle.js';
import { resolveDeclarations } from '../declarations.js';
import { STANDARD_LIBRARY } from '../standard-library.js';
import { Diagnostics } from '../../source/diagnostics.js';
import { isNpc } from '../../declare/actors.js';
import { parseDeclarations } from '../../syntax/parse.js';
import { kindName } from '../../declare/kinds.js';
import { locationOf, SourceFile } from '../../source/source.js';
import { compileBundle } from './compile.js';
import { Report } from './report.js';
import { oneWorld, worldKinds } from './world.js';
import { file, refusals, ROOT, warnings, WORLD_LINE, world } from '../../fixtures/compile.js';

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

// The same rules through a whole compile: one `world` declaration named
// as the manifest, and what its actors are made of.

describe('a bundle holds exactly one `world` declaration, named as the manifest', () => {
  it('compiles the happy path: one world, named as the manifest, composing sprout.World', () => {
    const { bundle, diagnostics } = compileBundle(world());
    expect(refusals(diagnostics)).toEqual([]);
    expect(
      bundle!.definitions.some((d) => d.kind === 'world' && d.name.text === 'printers_shop'),
    ).toBe(true);
  });

  it('finds the world under the manifest’s namespace, which need not be its name', () => {
    const { bundle, diagnostics } = compileBundle(world({ manifest: { namespace: 'ps' } }));
    expect(refusals(diagnostics)).toEqual([]);
    expect(
      bundle!.definitions.some((d) => d.kind === 'world' && d.name.text === 'printers_shop'),
    ).toBe(true);
  });

  it('refuses no `world` declaration at publish, at the manifest’s `name` key', () => {
    const files = [file('world.sprout', 'enum Season { spring }')];
    const { bundle, diagnostics } = compileBundle(world({ files }));
    expect(bundle).toBeNull();
    const problem = refusals(diagnostics)[0]!;
    expect(problem.message).toBe('This world has no `world` declaration.');
    expect(problem.remedy).toBe(
      'Write one, in one of its files: `world printers_shop: sprout.World { … }`.',
    );
    expect(locationOf(problem.at)).toBe('sprout.json:2:3');
  });

  it('refuses two `world` declarations at publish, at the second’s name', () => {
    const files = [file('world.sprout', `${ROOT}\n${WORLD_LINE}`)];
    const { bundle, diagnostics } = compileBundle(world({ files }));
    expect(bundle).toBeNull();
    const problem = refusals(diagnostics)[0]!;
    expect(problem.message).toBe('There are two `world` declarations, and a world has one.');
    expect(problem.remedy).toBe('Remove one, or move what it holds into the other.');
    expect(locationOf(problem.at)).toBe('world.sprout:2:7');
  });

  it('refuses a `world` declaration named otherwise, with both names in the remedy', () => {
    const files = [file('world.sprout', 'world shop: sprout.World {}')];
    const { bundle, diagnostics } = compileBundle(world({ files }));
    expect(bundle).toBeNull();
    const problem = refusals(diagnostics)[0]!;
    expect(problem.message).toBe("`shop` is not this world's name.");
    expect(problem.remedy).toBe(
      'The manifest names it `printers_shop`; write `world printers_shop: sprout.World { … }`, ' +
        'or change the manifest.',
    );
    expect(locationOf(problem.at)).toBe('world.sprout:1:7');
  });

  it('refuses a `world` declaration in a vendored library’s files', () => {
    const withWorld: LibrarySource = {
      ...STANDARD_LIBRARY,
      files: [...STANDARD_LIBRARY.files, file('root.sprout', 'world sprout: sprout.World {}')],
    };
    const { bundle, diagnostics } = compileBundle(
      world({
        libraries: [withWorld],
        manifest: {
          libraries: [{ name: 'sprout', version: '0.1.0', sha: libraryHash(withWorld) }],
        },
      }),
    );
    expect(bundle).toBeNull();
    const problem = refusals(diagnostics).find((d) => d.message.includes('does not declare'))!;
    expect(problem).toBeDefined();
    expect(problem.message).toContain('A library does not declare a world.');
    expect(locationOf(problem.at)).toBe('root.sprout:1:7');
  });

  it('refuses an `object` in a vendored library’s files, since objects are the world’s', () => {
    // The corpus vendors only the standard library the CLI carries, so this is pinned here.
    const withObject: LibrarySource = {
      ...STANDARD_LIBRARY,
      files: [
        ...STANDARD_LIBRARY.files,
        file('box.sprout', 'kind Box { }\nobject box: Box in hall'),
      ],
    };
    const compiled = (mode: 'publish' | 'load') =>
      compileBundle(
        world({
          libraries: [withObject],
          manifest: {
            libraries: [{ name: 'sprout', version: '0.1.0', sha: libraryHash(withObject) }],
          },
        }),
        { mode },
      );
    const { bundle, diagnostics } = compiled('publish');
    expect(bundle).toBeNull();
    expect(refusals(diagnostics).map((d) => [locationOf(d.at), d.message, d.remedy])).toEqual([
      [
        'box.sprout:2:8',
        'A library does not declare an object, and `box` is one.',
        "The world's own files do; move it there, or declare a kind here for the world to make it of.",
      ],
    ]);
    // Never allowable, so not softened at load.
    expect(compiled('load').bundle).toBeNull();
  });

  it('is a gap at load when there is no `world` declaration, and still produces a bundle', () => {
    const files = [file('world.sprout', 'enum Season { spring }')];
    const { bundle, diagnostics } = compileBundle(world({ files }), { mode: 'load' });
    expect(bundle).not.toBeNull();
    expect(refusals(diagnostics)).toEqual([]);
    expect(bundle!.absent).toEqual([
      {
        what: 'printers_shop',
        kind: 'world',
        reason: 'missing',
        at: expect.anything(),
        consequence: 'the world admits no one until it has one',
      },
    ]);
    expect(warnings(diagnostics)[0]!.message).toContain(
      'The world admits no one until it has one.',
    );
  });

  it('is a gap at load when there are two `world` declarations, and still produces a bundle', () => {
    const files = [file('world.sprout', `${ROOT}\n${WORLD_LINE}`)];
    const { bundle, diagnostics } = compileBundle(world({ files }), { mode: 'load' });
    expect(bundle).not.toBeNull();
    expect(refusals(diagnostics)).toEqual([]);
    expect(bundle!.absent).toEqual([
      {
        what: 'printers_shop',
        kind: 'world',
        reason: 'missing',
        at: expect.anything(),
        consequence: 'the world admits no one until there is one',
      },
    ]);
  });

  it('still refuses a `world` declaration named otherwise at load, because it is never allowable', () => {
    const files = [file('world.sprout', 'world shop: sprout.World {}')];
    expect(compileBundle(world({ files }), { mode: 'load' }).bundle).toBeNull();
  });

  it('does not also say the world is missing when its only file is refused for its own defect', () => {
    // `checkShape` still returns the `world` declaration it parsed
    // alongside the refusal about the malformed list — a value inside a
    // property recovers without discarding the world around it — and
    // publish is about to refuse the bundle for that defect regardless.
    // Saying the world also has none would be the same mistake said
    // twice.
    const files = [file('world.sprout', 'world printers_shop: sprout.World {\n  :x [-]\n}')];
    const { bundle, diagnostics } = compileBundle(world({ files }));
    expect(bundle).toBeNull();
    expect(refusals(diagnostics)).toHaveLength(1);
    expect(refusals(diagnostics)[0]!.message).not.toContain('has no `world` declaration');
  });

  it('reads the same broken file as absent at load, and still gives the missing-world gap', () => {
    // At load the broken file itself is a gap (its declarations, world
    // included, are not in `byLibrary`), so the world genuinely has none
    // among what is usable, and that gap stands beside the file's.
    const files = [file('world.sprout', 'world printers_shop: sprout.World {\n  :x [-]\n}')];
    const { bundle, diagnostics } = compileBundle(world({ files }), { mode: 'load' });
    expect(bundle).not.toBeNull();
    expect(refusals(diagnostics)).toEqual([]);
    expect(bundle!.absent.map((a) => a.kind)).toEqual(['file', 'world']);
    expect(
      warnings(diagnostics).some((d) => d.message.includes('has no `world` declaration')),
    ).toBe(true);
  });
});

describe('a world’s actors: what its visitors are made of, and its NPCs', () => {
  it('accepts an NPC with no place among what holds it, and one inside what holds no people', () => {
    // The world here holds things and not people, so the ghost stands in
    // no place; the cat is in a basket in the hall. Where an actor may be
    // moved is a matter for moving it, and declaring one is accepted.
    const files = [
      file(
        'world.sprout',
        [
          'world printers_shop: sprout.World { visitors are Visitor visitors arrive at hall }',
          VISITOR,
          'kind Basket { contains }',
          'object hall: sprout.Place in printers_shop',
          'object ghost: Visitor in printers_shop',
          'object basket: Basket in hall',
          'object cat: Visitor in hall.basket',
        ].join('\n'),
      ),
    ];
    const { bundle, diagnostics } = compileBundle(world({ files }));
    expect(diagnostics).toEqual([]);
    expect(bundle!.world!.containsActors).toBe(false);
    const npcs = bundle!.objects.filter((o) => isNpc(o.kind, bundle!.visitor!));
    expect(npcs.map((o) => o.path)).toEqual([['ghost'], ['hall', 'basket', 'cat']]);
  });

  it('refuses a visitor kind that is not an actor in either mode, since nothing is missing', () => {
    const files = [
      file(
        'world.sprout',
        'world printers_shop: sprout.World { contains actors visitors are Basket visitors arrive at printers_shop }\nkind Basket { contains }',
      ),
    ];
    for (const mode of ['publish', 'load'] as const) {
      const { bundle, diagnostics } = compileBundle(world({ files }), { mode });
      expect(bundle, mode).toBeNull();
      expect(
        refusals(diagnostics).map((d) => d.message),
        mode,
      ).toEqual(["`Basket` is not an actor, and a world's visitors are made of one."]);
    }
  });

  it('runs a world whose visitor kind is absent at load, admitting no one', () => {
    const files = [file('world.sprout', WORLD_LINE), file('people.sprout', VISITOR)];
    const { bundle, diagnostics } = compileBundle(world({ files, withheld: ['people.sprout'] }), {
      mode: 'load',
    });
    expect(refusals(diagnostics)).toEqual([]);
    expect(bundle!.visitor).toBeNull();
    expect(bundle!.world).not.toBeNull();
    expect(bundle!.absent.map((a) => [a.what, a.kind])).toEqual([
      ['people.sprout', 'file'],
      ['Visitor', 'world'],
    ]);
  });
});
