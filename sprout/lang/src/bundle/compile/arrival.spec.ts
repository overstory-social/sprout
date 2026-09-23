// Where visitors arrive, as `compileBundle` records it from the world's one
// declaration (the spec's The world model › Visitors), and what is said when
// the place is missing, unknown or not a place.

import { describe, expect, it } from 'vitest';

import type { Declaration, WorldDeclaration } from '../../syntax/ast.js';
import { resolveDeclarations } from '../declarations.js';
import { STANDARD_LIBRARY } from '../standard-library.js';
import { Diagnostics } from '../../source/diagnostics.js';
import { parseDeclarations } from '../../syntax/parse.js';
import { locationOf, SourceFile } from '../../source/source.js';
import { arrivalPlace } from './arrival.js';
import { compileBundle } from './compile.js';
import { Report } from './report.js';
import { file, refusals, ROOT, VISITOR, warnings, world } from '../../fixtures/compile.js';

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
  it('is the path of a place, and never the world itself', () => {
    expect(arriving(at('hall')).path).toEqual(['hall']);
    for (const mode of ['publish', 'load'] as const) {
      const itself = arriving(at('shop').replace('{', '{ contains actors'), mode);
      expect(itself.path, mode).toBeNull();
      expect(itself.said, mode).toEqual([
        'world.sprout:1:63 `shop` is the world itself, and visitors arrive in a place inside it.',
      ]);
      expect(itself.absent, mode).toEqual([]);
    }
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

// The same rule through a whole compile: the bundle's own `arrival`, read
// from `printers_shop`'s one `world` declaration.

describe('the bundle knows where visitors arrive, read from the world’s one declaration', () => {
  const load = { mode: 'load' } as const;
  /** The world arriving at `at`, with a hall and a bench in it and `more` after. */
  const worldArrivingAt = (at: string, more = '') => [
    file(
      'world.sprout',
      `world printers_shop: sprout.World { visitors arrive at ${at} visitors are Visitor }\nkind Room { contains actors }\nkind Bench { contains }\nobject hall: Room in printers_shop\nobject bench: Bench in hall\n${VISITOR}\n${more}`,
    ),
  ];

  it('carries the place’s path, deeper by its dotted path', () => {
    const shallow = compileBundle(world({ files: worldArrivingAt('hall') }));
    expect(refusals(shallow.diagnostics)).toEqual([]);
    expect(shallow.bundle!.arrival).toEqual(['hall']);

    const deeper = compileBundle(
      world({ files: worldArrivingAt('hall.nook', 'object nook: Room in hall\n') }),
    );
    expect(refusals(deeper.diagnostics)).toEqual([]);
    expect(deeper.bundle!.arrival).toEqual(['hall', 'nook']);
  });

  it('refuses a place nothing answers to at publish, in the words an `in` gets', () => {
    const { bundle, diagnostics } = compileBundle(world({ files: worldArrivingAt('hal') }));
    expect(bundle).toBeNull();
    expect(refusals(diagnostics).map((d) => [locationOf(d.at), d.message, d.remedy])).toEqual([
      [
        'world.sprout:1:56',
        'Nothing here is called `hal`. Did you mean `hall`?',
        'Write `visitors arrive at hall`, or declare an object called `hal`.',
      ],
    ]);
  });

  it('records the `place-of-arrival` gap at load, and admits no one', () => {
    const { bundle, diagnostics } = compileBundle(world({ files: worldArrivingAt('hal') }), load);
    expect(refusals(diagnostics)).toEqual([]);
    expect(bundle!.arrival).toBeNull();
    expect(bundle!.absent.map((a) => [a.what, a.kind, a.reason, locationOf(a.at!)])).toEqual([
      ['hal', 'place-of-arrival', 'missing', 'world.sprout:1:56'],
    ]);
    expect(warnings(diagnostics).map((d) => d.message)).toEqual([
      'Nothing here is called `hal`. Did you mean `hall`? The world does not admit anyone; entry fails as a host matter, the way a crash does, and the host says so outside the world.',
    ]);
  });

  it('refuses something that is not a place in either mode, since nothing is missing', () => {
    for (const mode of ['publish', 'load'] as const) {
      const { bundle, diagnostics } = compileBundle(
        world({ files: worldArrivingAt('hall.bench') }),
        {
          mode,
        },
      );
      expect(bundle, mode).toBeNull();
      expect(
        refusals(diagnostics).map((d) => d.message),
        mode,
      ).toEqual(['`bench` is not a place, and visitors arrive in one.']);
    }
  });

  it('refuses the world as where visitors arrive in either mode, even one that holds actors', () => {
    const files = [
      file(
        'world.sprout',
        `world printers_shop: sprout.World { contains actors visitors are Visitor visitors arrive at printers_shop }\nkind Room { contains actors }\nobject hall: Room in printers_shop\n${VISITOR}`,
      ),
    ];
    for (const mode of ['publish', 'load'] as const) {
      const { bundle, diagnostics } = compileBundle(world({ files }), { mode });
      expect(bundle, mode).toBeNull();
      expect(
        refusals(diagnostics).map((d) => [locationOf(d.at), d.message, d.remedy]),
        mode,
      ).toEqual([
        [
          'world.sprout:1:93',
          '`printers_shop` is the world itself, and visitors arrive in a place inside it.',
          'Name a place in the world, as in `visitors arrive at hall`.',
        ],
      ]);
    }
  });

  it('says once that a world does not say where visitors arrive', () => {
    const files = [
      file(
        'world.sprout',
        `world printers_shop: sprout.World { contains actors visitors are Visitor } ${VISITOR}`,
      ),
    ];
    for (const mode of ['publish', 'load'] as const) {
      const { bundle, diagnostics } = compileBundle(world({ files }), { mode });
      expect(bundle, mode).toBeNull();
      expect(
        refusals(diagnostics).map((d) => d.message),
        mode,
      ).toEqual(['`printers_shop` does not say where a visitor arrives.']);
    }
  });

  it('says nothing about arrival for a world misnamed or doubled, which has been said', () => {
    const misnamed = [
      file('world.sprout', 'world shop: sprout.World { visitors arrive at nowhere }'),
    ];
    expect(refusals(compileBundle(world({ files: misnamed })).diagnostics)).toHaveLength(1);
    const doubled = [file('world.sprout', `${ROOT}\nworld printers_shop: sprout.World { }`)];
    const loaded = compileBundle(world({ files: doubled }), load);
    expect(loaded.bundle!.absent.map((a) => a.kind)).toEqual(['world']);
    expect(loaded.bundle!.arrival).toBeNull();
  });

  it('does not say the place is absent at publish when an own file was refused, as for the world', () => {
    // The refused file may be where the place was declared.
    const files = [
      ...worldArrivingAt('yard'),
      file('yard.sprout', 'object yard: Room in printers_shop {'),
    ];
    const published = compileBundle(world({ files }));
    expect(published.bundle).toBeNull();
    expect(refusals(published.diagnostics).map((d) => locationOf(d.at))).not.toContain(
      'world.sprout:1:56',
    );
    expect(refusals(published.diagnostics).every((d) => locationOf(d.at).startsWith('yard'))).toBe(
      true,
    );
    // At load the file is absent, and so is the place.
    const loaded = compileBundle(world({ files }), load);
    expect(loaded.bundle!.absent.map((a) => a.kind)).toEqual(['file', 'place-of-arrival']);
  });

  it('tells an absent place once at publish, through what left it absent, and records both at load', () => {
    const files = worldArrivingAt('yard', 'object yard: Nope in printers_shop\n');
    const published = compileBundle(world({ files }));
    expect(refusals(published.diagnostics).map((d) => d.message)).toEqual([
      'Nothing here is a `Nope`.',
    ]);
    const loaded = compileBundle(world({ files }), load);
    expect(loaded.bundle!.arrival).toBeNull();
    expect(loaded.bundle!.absent.map((a) => [a.what, a.kind])).toEqual([
      ['Nope', 'kind-in-composition'],
      ['yard', 'place-of-arrival'],
    ]);
    expect(warnings(loaded.diagnostics).map((d) => d.message)).toContain(
      '`yard` is absent, so visitors have nowhere to arrive. The world does not admit anyone; entry fails as a host matter, the way a crash does, and the host says so outside the world.',
    );
  });
});
