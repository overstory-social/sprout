// The one `world` declaration a bundle holds, named as the manifest, and
// what the world and its visitors are made of (the spec's The world model,
// Actors and visitors).

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
import { isActor, isVisitorKind } from '../../declare/actors.js';
import { parseDeclarations } from '../../syntax/parse.js';
import { kindName } from '../../declare/kinds.js';
import { locationOf, SourceFile } from '../../source/source.js';
import { compileBundle } from './compile.js';
import { Report } from './report.js';
import { oneWorld, worldKinds } from './world.js';
import { file, HALL, refusals, ROOT, warnings, WORLD_LINE, world } from '../../fixtures/compile.js';

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

const WORLD = 'world shop is sprout.World { visitors are Person visitors arrive at shop }';
const VISITOR = 'kind Person is sprout.Visitor { }';

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
    expect(one('world yard is sprout.World { }').said).toEqual([
      "world.sprout:1:7 `yard` is not this world's name.",
    ]);
  });

  it('refuses a world declared in a library, and says nothing more of what it holds', () => {
    const { said } = one(
      WORLD,
      'publish',
      false,
      'world v is sprout.World {\n  object lamp is Voice\n}\n',
    );
    expect(said).toEqual(['v.sprout:1:7 A library does not declare a world.']);
  });
});

describe('what the world and its visitors are made of', () => {
  it('is the world composed, and the world’s own kind composing `sprout.Actor`', () => {
    const { world, visitor, said } = kinds(`${WORLD}\n${VISITOR}`);
    expect(said).toEqual([]);
    expect(world!.order).toEqual(['sprout.World', 'shop.shop']);
    expect(kindName(visitor!)).toBe('shop.Person');
  });

  it('refuses a kind the world composes that nothing declares at publish, and at load admits no one', () => {
    const text = `world shop is sprout.World, Voice { visitors are Person }\n${VISITOR}`;
    expect(kinds(text).said).toEqual(['world.sprout:1:29 Nothing here is a `Voice`.']);
    const loaded = kinds(text, 'load');
    expect(loaded.world).toBeNull();
    expect(loaded.visitor).not.toBeNull();
    expect(loaded.absent).toEqual([['Voice', 'world']]);
  });

  it('records the world absent at load when a kind it composes could not be made', () => {
    const text = `world shop is sprout.World, Lamp { visitors are Person }\nkind Lamp is Nope { }\n${VISITOR}`;
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
    const text = 'world shop is sprout.World { visitors are Person }';
    expect(kinds(text).said).toEqual(['world.sprout:1:43 Nothing here is a `Person`.']);
    const loaded = kinds(text, 'load');
    expect(loaded.visitor).toBeNull();
    expect(loaded.world).not.toBeNull();
    expect(loaded.absent).toEqual([['Person', 'visitor-kind']]);
  });

  it('does not say the visitor kind is missing at publish while an own file was refused', () => {
    expect(
      kinds('world shop is sprout.World { visitors are Person }', 'publish', true).said,
    ).toEqual([]);
  });

  it('refuses a visitor kind that is not for a person in either mode, since nothing is missing', () => {
    for (const mode of ['publish', 'load'] as const) {
      const found = kinds(
        'world shop is sprout.World { visitors are Hall }\nkind Hall is sprout.Place { }',
        mode,
      );
      expect(found.visitor, mode).toBeNull();
      expect(found.absent, mode).toEqual([]);
      expect(found.said, mode).toEqual([
        "world.sprout:1:43 `Hall` does not compose `sprout.Visitor`, and a world's visitors are made of a kind that does.",
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
      'Write one, in one of its files: `world printers_shop is sprout.World { … }`.',
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
    const files = [file('world.sprout', 'world shop is sprout.World {}')];
    const { bundle, diagnostics } = compileBundle(world({ files }));
    expect(bundle).toBeNull();
    const problem = refusals(diagnostics)[0]!;
    expect(problem.message).toBe("`shop` is not this world's name.");
    expect(problem.remedy).toBe(
      'The manifest names it `printers_shop`; write `world printers_shop is sprout.World { … }`, ' +
        'or change the manifest.',
    );
    expect(locationOf(problem.at)).toBe('world.sprout:1:7');
  });

  it('refuses a `world` declaration in a vendored library’s files', () => {
    const withWorld: LibrarySource = {
      ...STANDARD_LIBRARY,
      files: [...STANDARD_LIBRARY.files, file('root.sprout', 'world sprout is sprout.World {}')],
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

  it('refuses an `object` at the top of a vendored library’s file, as of any file', () => {
    // The corpus vendors only the standard library the CLI carries, so this is pinned here.
    const withObject: LibrarySource = {
      ...STANDARD_LIBRARY,
      files: [...STANDARD_LIBRARY.files, file('box.sprout', 'kind Box { }\nobject box is Box')],
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
        'box.sprout:2:1',
        '`box` is written outside the world, and an object is written inside what holds it.',
        'Move `object box …` into the braces of the world, `world <name> is sprout.World { … }`, or of the object that holds it.',
      ],
    ]);
    // A file that does not compile reads as absent at load, and the world runs without it.
    expect(compiled('load').bundle!.absent.map((a) => [a.what, a.kind])).toEqual([
      ['box.sprout', 'file'],
    ]);
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
    const files = [file('world.sprout', 'world shop is sprout.World {}')];
    expect(compileBundle(world({ files }), { mode: 'load' }).bundle).toBeNull();
  });

  it('does not also say the world is missing when its only file is refused for its own defect', () => {
    // `checkShape` still returns the `world` declaration it parsed
    // alongside the refusal about the malformed list — a value inside a
    // property recovers without discarding the world around it — and
    // publish is about to refuse the bundle for that defect regardless.
    // Saying the world also has none would be the same mistake said
    // twice.
    const files = [file('world.sprout', 'world printers_shop is sprout.World {\n  :x [-]\n}')];
    const { bundle, diagnostics } = compileBundle(world({ files }));
    expect(bundle).toBeNull();
    expect(refusals(diagnostics)).toHaveLength(1);
    expect(refusals(diagnostics)[0]!.message).not.toContain('has no `world` declaration');
  });

  it('reads the same broken file as absent at load, and still gives the missing-world gap', () => {
    // At load the broken file itself is a gap (its declarations, world
    // included, are not in `byLibrary`), so the world genuinely has none
    // among what is usable, and that gap stands beside the file's.
    const files = [file('world.sprout', 'world printers_shop is sprout.World {\n  :x [-]\n}')];
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
  it('accepts an NPC in a place, and one in a place inside a place, sharing a kind with the visitors', () => {
    const files = [
      file(
        'world.sprout',
        [
          'world printers_shop is sprout.World {',
          '  visitors are Person',
          '  visitors arrive at hall',
          '  object hall is sprout.Place {',
          '    object nook is sprout.Place { object cat is Cat }',
          '    object ghost is Creature',
          '  }',
          '}',
          'kind Creature is sprout.Actor { }',
          'kind Person is Creature, sprout.Visitor { }',
          'kind Cat is Creature { }',
        ].join('\n'),
      ),
    ];
    const { bundle, diagnostics } = compileBundle(world({ files }));
    expect(diagnostics).toEqual([]);
    // Every actor declared is an NPC, and composes what the visitor kind shares with it.
    const actors = bundle!.objects.filter((o) => isActor(o.kind));
    expect(actors.map((o) => o.path)).toEqual([
      ['hall', 'nook', 'cat'],
      ['hall', 'ghost'],
    ]);
    for (const actor of actors) {
      expect(isVisitorKind(actor.kind)).toBe(false);
      expect(actor.kind.composes.has('printers_shop.Creature')).toBe(true);
    }
    expect(bundle!.visitor!.composes.has('printers_shop.Creature')).toBe(true);
  });

  it('refuses a visitor kind that is not for a person in either mode, since nothing is missing', () => {
    const files = [
      file(
        'world.sprout',
        `world printers_shop is sprout.World { visitors are Basket visitors arrive at hall ${HALL} }\nkind Basket { contains }`,
      ),
    ];
    for (const mode of ['publish', 'load'] as const) {
      const { bundle, diagnostics } = compileBundle(world({ files }), { mode });
      expect(bundle, mode).toBeNull();
      expect(
        refusals(diagnostics).map((d) => d.message),
        mode,
      ).toEqual([
        "`Basket` does not compose `sprout.Visitor`, and a world's visitors are made of a kind that does.",
      ]);
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
      ['Person', 'visitor-kind'],
    ]);
  });
});
