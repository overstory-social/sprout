import { describe, expect, it } from 'vitest';

import { LANGUAGE_LEVEL, libraryHash, type LibrarySource, type Manifest } from './bundle.js';
import { checkShape, compileBundle, type CompileOptions } from './compile.js';
import { limitsFrom } from './limits.js';
import { locationOf, SourceFile } from '../source/source.js';
import type { Diagnostic } from '../source/diagnostics.js';

const file = (name: string, text: string): SourceFile => new SourceFile(name, text);

const SPROUT: LibrarySource = {
  name: 'sprout',
  version: '1.0.0',
  level: 1,
  files: [
    file('ward.sprout', 'enum Ward { oak, silver }'),
    file('glaze.sprout', 'enum Glaze { none, shino, tenmoku }'),
  ],
};
const SPROUT_SHA = libraryHash(SPROUT);

const MANIFEST = [
  '{',
  '  "name": "printers_shop",',
  '  "version": "0.3.1",',
  '  "author": "Eric Eslinger",',
  '  "license": "MIT",',
  '  "level": 1,',
  '  "extensions": [{ "name": "media", "major": 2 }],',
  `  "libraries": [{ "name": "sprout", "version": "1.0.0", "sha": "${SPROUT_SHA}" }],`,
  '  "files": ["world.sprout"]',
  '}',
  '',
].join('\n');

const WORLD_TEXT =
  'world printers_shop: sprout.World {}\nenum Season { spring, summer, autumn, winter }';
/** Exactly the world's own source: blessed fits, unblessed does not. */
const OWN_BYTES = WORLD_TEXT.length;

/** A world as it arrives, with whatever this suite wants to move about it. */
function world(
  overrides: {
    manifest?: Partial<Manifest>;
    manifestText?: string;
    files?: SourceFile[];
    libraries?: LibrarySource[];
    withheld?: string[];
  } = {},
) {
  const manifest: Manifest = {
    name: 'printers_shop',
    namespace: 'printers_shop',
    version: '0.3.1',
    author: 'Eric Eslinger',
    license: 'MIT',
    level: 1,
    extensions: [{ name: 'media', major: 2 }],
    libraries: [{ name: 'sprout', version: '1.0.0', sha: SPROUT_SHA }],
    files: overrides.files?.map((f) => f.name) ?? ['world.sprout'],
    ...overrides.manifest,
  };
  return {
    manifestFile: file('sprout.json', overrides.manifestText ?? MANIFEST),
    manifest,
    files: overrides.files ?? [file('world.sprout', WORLD_TEXT)],
    libraries: overrides.libraries ?? [SPROUT],
    ...(overrides.withheld === undefined ? {} : { withheld: overrides.withheld }),
  };
}

const refusals = (diagnostics: readonly Diagnostic[]): Diagnostic[] =>
  diagnostics.filter((d) => d.severity === 'refusal');
const warnings = (diagnostics: readonly Diagnostic[]): Diagnostic[] =>
  diagnostics.filter((d) => d.severity === 'warning');

describe('the first tier reads one file alone, for its shape', () => {
  it('gives back the file’s declarations and nothing to say about a clean one', () => {
    const { declarations, diagnostics } = checkShape(file('ward.sprout', 'enum Ward { oak }'));
    expect(diagnostics).toEqual([]);
    expect(declarations).toHaveLength(1);
    expect(declarations[0]!.kind).toBe('enum');
  });

  it('names the line and column of what it refuses', () => {
    const { diagnostics } = checkShape(file('ward.sprout', 'enum Ward {\n  oak % silver\n}'));
    // Exactly one: the lexer steps the character over and the parser
    // does not report the gap it left as a missing comma.
    expect(diagnostics).toHaveLength(1);
    expect(locationOf(diagnostics[0]!.at)).toBe('ward.sprout:2:7');
  });

  it('checks a declaration against itself, which is all the first tier can see', () => {
    const { diagnostics } = checkShape(file('ward.sprout', 'enum Ward { oak, oak }'));
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.message).toContain('twice');
  });

  it('refuses a world that does not write `sprout.World`', () => {
    // One declaration answers this on its own — nothing has to be
    // resolved — so it belongs to the tier an editor runs on each
    // keystroke.
    const { diagnostics } = checkShape(
      file('world.sprout', 'world shop {\n  visitors are Creature\n}\n'),
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.message).toBe('`shop` does not compose `sprout.World`.');
    expect(locationOf(diagnostics[0]!.at)).toBe('world.sprout:1:7');
  });

  it('takes the world that writes it', () => {
    const { declarations, diagnostics } = checkShape(
      file('world.sprout', 'world shop: sprout.World {\n  visitors are Creature\n}\n'),
    );
    expect(diagnostics).toEqual([]);
    expect(declarations.map((d) => d.kind)).toEqual(['world']);
  });

  it('leaves a .prose file to B29 rather than reading it as code', () => {
    const { declarations, diagnostics } = checkShape(
      file('mirror.prose', 'You see yourself, and % is not a problem here.'),
    );
    expect(diagnostics).toEqual([]);
    expect(declarations).toEqual([]);
  });
});

describe('what a manifest says about the world', () => {
  it('compiles a world whose manifest agrees with what travelled', () => {
    const { bundle, diagnostics } = compileBundle(world());
    expect(refusals(diagnostics)).toEqual([]);
    expect(bundle).not.toBeNull();
    expect(bundle!.manifest.name).toBe('printers_shop');
  });

  it('carries the whole manifest into the bundle', () => {
    expect(compileBundle(world()).bundle!.manifest).toMatchObject({
      name: 'printers_shop',
      version: '0.3.1',
      author: 'Eric Eslinger',
      license: 'MIT',
      level: 1,
    });
  });

  it('refuses a world name that is not a name', () => {
    for (const name of ['Printers Shop', '', 'Shop', '2shop', 'shop.two']) {
      expect(compileBundle(world({ manifest: { name } })).bundle, name).toBeNull();
    }
  });

  it('refuses an empty version, author or licence, and points at the key', () => {
    for (const [key, line] of [
      ['version', 3],
      ['author', 4],
      ['license', 5],
    ] as const) {
      const { bundle, diagnostics } = compileBundle(world({ manifest: { [key]: '   ' } }));
      expect(bundle, key).toBeNull();
      const problem = refusals(diagnostics).find((d) => d.message.includes(key))!;
      expect(problem.message).toContain('is empty');
      expect(locationOf(problem.at)).toBe(`sprout.json:${line}:3`);
    }
  });

  it('accepts a semver version with a pre-release and build tag', () => {
    const { bundle, diagnostics } = compileBundle(
      world({ manifest: { version: '1.2.3-beta.1+build.5' } }),
    );
    expect(refusals(diagnostics)).toEqual([]);
    expect(bundle!.manifest.version).toBe('1.2.3-beta.1+build.5');
  });

  it('refuses a version that is not semver, and points at the key', () => {
    for (const version of ['1.0', 'v1.0.0', '1.0.0.0', 'latest']) {
      const { bundle, diagnostics } = compileBundle(world({ manifest: { version } }));
      expect(bundle, version).toBeNull();
      const problem = refusals(diagnostics).find((d) => d.message.includes('is not a version'))!;
      expect(problem, version).toBeDefined();
      expect(problem.message).toBe(`"${version}" is not a version.`);
      expect(problem.remedy).toBe(
        'A version is three numbers with dots, as in 0.1.0; a pre-release or build tag may follow, as in 1.2.0-beta.1.',
      );
      expect(locationOf(problem.at)).toBe('sprout.json:3:3');
    }
  });

  it('says a version is empty rather than not-semver when it is empty', () => {
    const { diagnostics } = compileBundle(world({ manifest: { version: '   ' } }));
    const problems = refusals(diagnostics).filter((d) => d.message.includes('version'));
    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toBe("This world's version is empty.");
  });

  it('says what to write for a licence, which is the one a person will not guess', () => {
    const { diagnostics } = compileBundle(world({ manifest: { license: '' } }));
    expect(refusals(diagnostics).find((d) => d.message.includes('license'))!.remedy).toContain(
      'MIT',
    );
  });

  it('refuses a level that is not a whole number from 1 up', () => {
    expect(compileBundle(world({ manifest: { level: 0 } })).bundle).toBeNull();
    expect(compileBundle(world({ manifest: { level: 1.5 } })).bundle).toBeNull();
  });

  it('refuses an extension pinned to a major version that is not one', () => {
    expect(
      compileBundle(world({ manifest: { extensions: [{ name: 'media', major: -1 }] } })).bundle,
    ).toBeNull();
  });

  it('carries the extensions it pins into the bundle', () => {
    expect(compileBundle(world()).bundle!.extensions).toEqual([{ name: 'media', major: 2 }]);
  });
});

describe('the manifest enumerates the world’s own files', () => {
  it('refuses a file it names that did not travel, naming it in the manifest', () => {
    const { bundle, diagnostics } = compileBundle(
      world({ manifest: { files: ['world.sprout', 'kiln.prose'] } }),
    );
    expect(bundle).toBeNull();
    const problem = refusals(diagnostics).find((d) => d.message.includes('kiln.prose'))!;
    expect(problem.message).toContain('did not travel');
    expect(locationOf(problem.at)).toBe('sprout.json:9:3');
  });

  it('refuses a file that travelled and the manifest does not name', () => {
    const { bundle, diagnostics } = compileBundle(
      world({
        files: [file('world.sprout', WORLD_TEXT), file('kiln.sprout', 'enum Kiln { cold }')],
        manifest: { files: ['world.sprout'] },
      }),
    );
    expect(bundle).toBeNull();
    expect(refusals(diagnostics)[0]!.message).toContain('does not name it');
    expect(locationOf(refusals(diagnostics)[0]!.at)).toBe('kiln.sprout:1:1');
  });

  it('refuses a name that is not a sprout or prose file', () => {
    const { bundle, diagnostics } = compileBundle(
      world({ manifest: { files: ['world.sprout', 'notes.txt'] } }),
    );
    expect(bundle).toBeNull();
    expect(refusals(diagnostics).some((d) => d.message.includes('notes.txt'))).toBe(true);
  });

  it('takes a .prose file as readily as a .sprout one', () => {
    const files = [file('world.sprout', WORLD_TEXT), file('kiln.prose', 'Warm brick.')];
    expect(compileBundle(world({ files })).bundle).not.toBeNull();
  });

  it('refuses the same file named twice', () => {
    expect(
      compileBundle(world({ manifest: { files: ['world.sprout', 'world.sprout'] } })).bundle,
    ).toBeNull();
  });

  it('refuses two files of one name arriving', () => {
    expect(
      compileBundle(
        world({ files: [file('a.sprout', 'enum A { a }'), file('a.sprout', 'enum B { b }')] }),
      ).bundle,
    ).toBeNull();
  });
});

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
    const files = [
      file(
        'world.sprout',
        'world printers_shop: sprout.World {}\nworld printers_shop: sprout.World {}',
      ),
    ];
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
      ...SPROUT,
      files: [...SPROUT.files, file('root.sprout', 'world sprout: sprout.World {}')],
    };
    const { bundle, diagnostics } = compileBundle(
      world({
        libraries: [withWorld],
        manifest: {
          libraries: [{ name: 'sprout', version: '1.0.0', sha: libraryHash(withWorld) }],
        },
      }),
    );
    expect(bundle).toBeNull();
    const problem = refusals(diagnostics).find((d) => d.message.includes('does not declare'))!;
    expect(problem).toBeDefined();
    expect(problem.message).toContain('A library does not declare a world.');
    expect(locationOf(problem.at)).toBe('root.sprout:1:7');
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
    const files = [
      file(
        'world.sprout',
        'world printers_shop: sprout.World {}\nworld printers_shop: sprout.World {}',
      ),
    ];
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

describe('the manifest records every library by version and by the hash of its source', () => {
  it('compiles when the source that travelled is the source recorded', () => {
    const { bundle } = compileBundle(world());
    expect(bundle!.libraries[0]!.hash).toBe(SPROUT_SHA);
  });

  it('refuses a library whose source did not travel', () => {
    const { bundle, diagnostics } = compileBundle(world({ libraries: [] }));
    expect(bundle).toBeNull();
    expect(refusals(diagnostics)[0]!.message).toContain('did not travel');
    expect(locationOf(refusals(diagnostics)[0]!.at)).toBe('sprout.json:8:27');
  });

  it('refuses a library whose source is not the source the manifest recorded', () => {
    const fork: LibrarySource = {
      ...SPROUT,
      files: [SPROUT.files[0]!, file('glaze.sprout', 'enum Glaze { none }')],
    };
    const { bundle, diagnostics } = compileBundle(world({ libraries: [fork] }));
    expect(bundle).toBeNull();
    expect(refusals(diagnostics)[0]!.message).toContain('is not the source the manifest recorded');
    expect(refusals(diagnostics)[0]!.remedy).toContain('Vendor the library again');
  });

  it('refuses a version the manifest records that the source does not agree with', () => {
    const renamed: LibrarySource = { ...SPROUT, version: '2.0.0' };
    const { bundle, diagnostics } = compileBundle(world({ libraries: [renamed] }));
    expect(bundle).toBeNull();
    expect(refusals(diagnostics)[0]!.message).toContain('version 1.0.0');
    expect(refusals(diagnostics)[0]!.message).toContain('says 2.0.0');
  });

  it('refuses a library name that is not a name', () => {
    const odd: LibrarySource = { ...SPROUT, name: 'Sprout' };
    expect(
      compileBundle(
        world({
          manifest: { libraries: [{ name: 'Sprout', version: '1.0.0', sha: libraryHash(odd) }] },
          libraries: [odd],
        }),
      ).bundle,
    ).toBeNull();
  });

  it('refuses the same library used twice, or vendored twice', () => {
    const pin = { name: 'sprout', version: '1.0.0', sha: SPROUT_SHA };
    expect(compileBundle(world({ manifest: { libraries: [pin, pin] } })).bundle).toBeNull();
    expect(compileBundle(world({ libraries: [SPROUT, SPROUT] })).bundle).toBeNull();
  });

  it('warns about a library that travelled and is not used', () => {
    const spare: LibrarySource = {
      name: 'ericworld',
      version: '0.1.0',
      level: 1,
      files: [file('a.sprout', 'enum Spare { one }')],
    };
    const { bundle, diagnostics } = compileBundle(world({ libraries: [SPROUT, spare] }));
    expect(bundle).not.toBeNull();
    expect(warnings(diagnostics)).toHaveLength(1);
    expect(warnings(diagnostics)[0]!.message).toContain('"ericworld"');
  });

  it('lets a library and the world share a file name, since they are different source', () => {
    const files = [file('ward.sprout', 'world printers_shop: sprout.World {}\nenum Mine { one }')];
    expect(compileBundle(world({ files })).bundle).not.toBeNull();
  });
});

describe('the bundle records whether the host blessed each library’s hash', () => {
  it('records the blessing the host granted at publish', () => {
    const { bundle } = compileBundle(world(), { blessed: new Set([SPROUT_SHA]) });
    expect(bundle!.libraries[0]!.blessed).toBe(true);
  });

  it('does not bless a library the host has not', () => {
    expect(compileBundle(world()).bundle!.libraries[0]!.blessed).toBe(false);
  });
});

describe('blessed library source costs the author nothing, and a fork costs them everything', () => {
  const libraryBytes = SPROUT.files.reduce((n, f) => n + f.text.length, 0);

  it('leaves a blessed library out of the source the caps count', () => {
    const { bundle } = compileBundle(world(), { blessed: new Set([SPROUT_SHA]) });
    expect(bundle!.size.exemptBytes).toBe(libraryBytes);
    expect(bundle!.size.sourceBytes).toBe(WORLD_TEXT.length);
    expect(bundle!.size.files).toBe(1);
  });

  it('counts an unblessed library as the author’s own source', () => {
    const { bundle } = compileBundle(world());
    expect(bundle!.size.exemptBytes).toBe(0);
    expect(bundle!.size.sourceBytes).toBe(WORLD_TEXT.length + libraryBytes);
    expect(bundle!.size.files).toBe(3);
  });

  it('refuses a world past the host’s source cap, and says what to do', () => {
    const limits = limitsFrom({ caps: { sourceBytes: OWN_BYTES } });
    const { bundle, diagnostics } = compileBundle(world(), { limits });
    expect(bundle).toBeNull();
    expect(refusals(diagnostics)[0]!.message).toContain('bytes of source');
    expect(refusals(diagnostics)[0]!.remedy).toContain('blessed');
  });

  it('lets the same world through once its library is blessed', () => {
    const limits = limitsFrom({ caps: { sourceBytes: OWN_BYTES } });
    expect(
      compileBundle(world(), { limits, blessed: new Set([SPROUT_SHA]) }).bundle,
    ).not.toBeNull();
  });

  it('refuses a world past the host’s file cap', () => {
    const limits = limitsFrom({ caps: { files: 2 } });
    expect(compileBundle(world(), { limits }).bundle).toBeNull();
    expect(
      compileBundle(world(), { limits, blessed: new Set([SPROUT_SHA]) }).bundle,
    ).not.toBeNull();
  });

  it('bounds nothing the host did not bound', () => {
    // A .prose file, because a megabyte of source would be a megabyte
    // of parse errors and this test is about the cap, not the parser.
    const big = file('big.prose', 'x'.repeat(1_000_000));
    const files = [big, file('world.sprout', 'world printers_shop: sprout.World {}')];
    expect(compileBundle(world({ files })).bundle).not.toBeNull();
  });
});

describe('a bundle’s level is the highest of any of its parts', () => {
  const atLevel = (n: number): CompileOptions => ({ compilerLevel: n });
  const at = (level: number): LibrarySource => ({ ...SPROUT, level });

  it('is the world’s own when nothing it uses is newer', () => {
    expect(compileBundle(world()).bundle!.level).toBe(1);
  });

  it('takes a library’s level when the library is newer', () => {
    const { bundle } = compileBundle(world({ libraries: [at(2)] }), atLevel(2));
    expect(bundle!.level).toBe(2);
  });

  it('refuses text newer than the compiler, and names the part that is newer', () => {
    const { bundle, diagnostics } = compileBundle(world({ libraries: [at(3)] }), atLevel(2));
    expect(bundle).toBeNull();
    expect(refusals(diagnostics)[0]!.message).toContain('needs Sprout level 3');
    expect(refusals(diagnostics)[0]!.remedy).toContain('"sprout"');
  });

  it('refuses a world written for a newer level than the compiler', () => {
    const { bundle, diagnostics } = compileBundle(world({ manifest: { level: 4 } }), atLevel(2));
    expect(bundle).toBeNull();
    expect(locationOf(refusals(diagnostics)[0]!.at)).toBe('sprout.json:6:3');
  });

  it('understands its own level by default', () => {
    expect(compileBundle(world({ manifest: { level: LANGUAGE_LEVEL } })).bundle).not.toBeNull();
  });
});

describe('the whole bundle is read, the world’s files and its libraries alike', () => {
  it('refuses a syntax problem in the world’s own source, naming the file', () => {
    const files = [
      file('other.sprout', 'world printers_shop: sprout.World {}'),
      file('world.sprout', 'enum Season { spring }\n%\n'),
    ];
    const { bundle, diagnostics } = compileBundle(world({ files }));
    expect(bundle).toBeNull();
    expect(locationOf(refusals(diagnostics)[0]!.at)).toBe('world.sprout:2:1');
  });

  it('refuses a syntax problem in a vendored library too, because they compile together', () => {
    const broken: LibrarySource = {
      ...SPROUT,
      files: [file('ward.sprout', 'enum Ward { oak }\n%\n')],
    };
    const { bundle, diagnostics } = compileBundle(
      world({
        libraries: [broken],
        manifest: { libraries: [{ name: 'sprout', version: '1.0.0', sha: libraryHash(broken) }] },
      }),
    );
    expect(bundle).toBeNull();
    expect(locationOf(refusals(diagnostics)[0]!.at)).toBe('ward.sprout:2:1');
  });

  it('gives every problem in reading order, not the first', () => {
    const files = [
      file('a.sprout', '% ; %'),
      file('b.sprout', '%'),
      file('world.sprout', 'world printers_shop: sprout.World {}'),
    ];
    const { diagnostics } = compileBundle(world({ files }));
    expect(refusals(diagnostics)).toHaveLength(4);
    expect(refusals(diagnostics).map((d) => locationOf(d.at))).toEqual([
      'a.sprout:1:1',
      'a.sprout:1:3',
      'a.sprout:1:5',
      'b.sprout:1:1',
    ]);
  });
});

describe('what a compiled bundle carries', () => {
  const { bundle } = compileBundle(world());

  it('records the caps it was checked against, for a host that loads it later to decide', () => {
    const limits = limitsFrom({ caps: { optionsPerEnum: 12, places: 40 } });
    expect(compileBundle(world(), { limits }).bundle!.caps).toEqual(limits.caps);
    // And nothing about nesting: the parser's bound is its own, and a
    // host loading this has nothing to decide about it.
    expect(bundle!.caps).not.toHaveProperty('nesting');
  });

  it('carries a hash, which is what the log records beside a publish', () => {
    expect(bundle!.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(compileBundle(world()).bundle!.hash).toBe(bundle!.hash);
  });

  it('hashes differently once anything about the world changes', () => {
    const changed = world({
      files: [file('world.sprout', 'world printers_shop: sprout.World {}\nenum Season { spring }')],
    });
    expect(compileBundle(changed).bundle!.hash).not.toBe(bundle!.hash);
  });

  it('carries the declarations it read, the world’s and its libraries’ alike', () => {
    // The union grows as the syntax lands; B27 fills the word set.
    expect(bundle!.definitions.map((d) => d.name.text)).toEqual([
      'printers_shop',
      'Season',
      'Ward',
      'Glaze',
    ]);
    expect(bundle!.words).toEqual([]);
  });
});

describe('publishing is strict: any problem is a refusal', () => {
  it('is what a compile does when nothing says otherwise', () => {
    expect(compileBundle(world({ libraries: [] })).bundle).toBeNull();
    expect(compileBundle(world({ libraries: [] }), { mode: 'publish' }).bundle).toBeNull();
  });

  it('refuses a world with a file held back, because a world is not published in pieces', () => {
    const files = [file('world.sprout', WORLD_TEXT), file('kiln.sprout', 'enum Kiln { cold }')];
    const { bundle, diagnostics } = compileBundle(world({ files, withheld: ['kiln.sprout'] }), {
      mode: 'publish',
    });
    expect(bundle).toBeNull();
    expect(refusals(diagnostics)[0]!.message).toContain('withheld');
  });

  it('records no gaps, since a published world has none', () => {
    expect(compileBundle(world()).bundle!.absent).toEqual([]);
  });
});

describe('loading is lenient: what is missing reads as absent and the rest runs', () => {
  const load = { mode: 'load' } as const;

  it('runs a world whose library did not travel, and records the gap', () => {
    const { bundle, diagnostics } = compileBundle(world({ libraries: [] }), load);
    expect(bundle).not.toBeNull();
    expect(refusals(diagnostics)).toEqual([]);
    expect(bundle!.absent).toEqual([
      {
        what: 'sprout',
        kind: 'library',
        reason: 'missing',
        at: expect.anything(),
        consequence: 'every kind, enum, verb and message it holds reads as absent',
      },
    ]);
  });

  it('runs a world whose library is not the source recorded, and does not use that library', () => {
    const fork: LibrarySource = { ...SPROUT, files: [file('ward.sprout', 'enum Ward { oak }')] };
    const { bundle } = compileBundle(world({ libraries: [fork] }), load);
    expect(bundle).not.toBeNull();
    expect(bundle!.absent[0]).toMatchObject({ what: 'sprout', reason: 'mismatched' });
    expect(bundle!.libraries).toEqual([]);
    expect(bundle!.size.sourceBytes).toBe(WORLD_TEXT.length);
  });

  it('says so, so the gap is visible rather than swallowed', () => {
    const { diagnostics } = compileBundle(world({ libraries: [] }), load);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.severity).toBe('warning');
    expect(diagnostics[0]!.message).toContain('reads as absent');
  });

  it('runs a world with a file withheld, and keeps the objects’ state', () => {
    const files = [file('world.sprout', WORLD_TEXT), file('kiln.sprout', 'enum Kiln { cold }')];
    const { bundle } = compileBundle(world({ files, withheld: ['kiln.sprout'] }), load);
    expect(bundle).not.toBeNull();
    expect(bundle!.absent[0]).toMatchObject({ what: 'kiln.sprout', reason: 'withheld' });
    expect(bundle!.absent[0]!.consequence).toContain('keep their state');
  });

  it('does not call a withheld file missing as well, since it is one gap and not two', () => {
    const files = [file('world.sprout', WORLD_TEXT), file('kiln.sprout', 'enum Kiln { cold }')];
    const { bundle } = compileBundle(world({ files, withheld: ['kiln.sprout'] }), load);
    expect(bundle!.absent.map((a) => a.reason)).toEqual(['withheld']);
  });

  it('runs a world a file of which the manifest names and did not arrive', () => {
    const { bundle } = compileBundle(
      world({ manifest: { files: ['world.sprout', 'kiln.prose'] } }),
      load,
    );
    expect(bundle).not.toBeNull();
    expect(bundle!.absent[0]).toMatchObject({ what: 'kiln.prose', reason: 'missing' });
  });

  it('runs a world one of whose files does not compile, and names the file', () => {
    const files = [file('world.sprout', WORLD_TEXT), file('b.sprout', '%')];
    const { bundle, diagnostics } = compileBundle(world({ files }), load);
    expect(bundle).not.toBeNull();
    expect(bundle!.absent).toHaveLength(1);
    expect(bundle!.absent[0]).toMatchObject({ what: 'b.sprout', kind: 'file', reason: 'broken' });
    expect(locationOf(bundle!.absent[0]!.at!)).toBe('b.sprout:1:1');
    expect(refusals(diagnostics)).toEqual([]);
  });

  it('keeps what a broken file had to say, as warnings, so a moderator sees why', () => {
    const files = [
      file('b.sprout', '% ; %'),
      file('world.sprout', 'world printers_shop: sprout.World {}'),
    ];
    const { diagnostics } = compileBundle(world({ files }), load);
    expect(warnings(diagnostics)).toHaveLength(3);
    expect(diagnostics.every((d) => d.severity === 'warning')).toBe(true);
  });

  it('leaves the files that do compile alone', () => {
    const files = [
      file('good.sprout', 'world printers_shop: sprout.World {}\nenum Good { yes }'),
      file('bad.sprout', '%'),
    ];
    const { bundle } = compileBundle(world({ files }), load);
    expect(bundle!.absent.map((a) => a.what)).toEqual(['bad.sprout']);
  });

  it('still refuses a world past the host’s source cap, since no exception is recorded for it', () => {
    const limits = limitsFrom({ caps: { sourceBytes: OWN_BYTES } });
    const { bundle, diagnostics } = compileBundle(world(), { ...load, limits });
    expect(bundle).toBeNull();
    expect(locationOf(refusals(diagnostics)[0]!.at)).toBe('sprout.json:2:3');
    expect(refusals(diagnostics)[0]!.message).toContain('bytes of source');
  });

  it('still refuses a world past the host’s file cap, since no exception is recorded for it', () => {
    const limits = limitsFrom({ caps: { files: 2 } });
    const { bundle, diagnostics } = compileBundle(world(), { ...load, limits });
    expect(bundle).toBeNull();
    expect(locationOf(refusals(diagnostics)[0]!.at)).toBe('sprout.json:2:3');
    expect(refusals(diagnostics)[0]!.message).toContain('files');
  });

  it('warns rather than refuses about a file the manifest does not name', () => {
    const files = [file('world.sprout', WORLD_TEXT), file('kiln.sprout', 'enum Kiln { cold }')];
    const { bundle } = compileBundle(world({ files, manifest: { files: ['world.sprout'] } }), load);
    expect(bundle).not.toBeNull();
  });

  it('still refuses text newer than the compiler, because it cannot read it', () => {
    const { bundle } = compileBundle(world({ manifest: { level: 4 } }), {
      ...load,
      compilerLevel: 2,
    });
    expect(bundle).toBeNull();
  });

  it('still refuses what was never allowable, such as a world with no name', () => {
    expect(compileBundle(world({ manifest: { name: 'Shop' } }), load).bundle).toBeNull();
    expect(compileBundle(world({ manifest: { license: '' } }), load).bundle).toBeNull();
  });

  it('hashes the source that actually arrived, a withheld file not among it', () => {
    const files = [file('world.sprout', WORLD_TEXT), file('kiln.sprout', 'enum Kiln { cold }')];
    const whole = compileBundle(world({ files }), load).bundle!;
    const held = compileBundle(world({ files, withheld: ['kiln.sprout'] }), load).bundle!;
    expect(held.hash).not.toBe(whole.hash);
  });

  it('has nothing to soften yet, since no policy has been tightened since level 1', () => {
    // `softenPolicy` is wired into the load path; the first refusal
    // carrying a `since` will be the first to exercise it end to end.
    const { diagnostics } = compileBundle(world(), load);
    expect(diagnostics.filter((d) => d.since !== undefined)).toEqual([]);
  });
});

describe('a gap is said in whole sentences, and still says what to do about it', () => {
  it('starts the consequence with a capital, since it is a sentence and not a table cell', () => {
    const { diagnostics } = compileBundle(world({ libraries: [] }), { mode: 'load' });
    expect(diagnostics[0]!.message).toBe(
      'This world uses the library "sprout", and its source did not travel with it. ' +
        'Every kind, enum, verb and message it holds reads as absent.',
    );
  });

  it('keeps the remedy, which a moderator reading a withheld world still needs', () => {
    const files = [file('world.sprout', WORLD_TEXT), file('kiln.sprout', 'enum Kiln { cold }')];
    const { diagnostics } = compileBundle(world({ files, withheld: ['kiln.sprout'] }), {
      mode: 'load',
    });
    expect(diagnostics[0]!.remedy).toContain('Restore it');
  });
});

describe('the level a world was accepted at is the bundle’s, not the manifest’s', () => {
  // `softenPolicy` is given the bundle's level, which is the highest of
  // any of its parts. A world whose manifest says 1 and which vendors a
  // level-2 library was accepted at 2, so a refusal introduced at 2
  // applies to it as an error rather than being softened away. Nothing
  // carries a `since` yet, so this pins the number the threshold is
  // taken from rather than the softening itself.
  it('is the highest of any part, even when the manifest asks for less', () => {
    const newer: LibrarySource = { ...SPROUT, level: 2 };
    const { bundle } = compileBundle(world({ libraries: [newer] }), {
      compilerLevel: 2,
      mode: 'load',
    });
    expect(bundle!.manifest.level).toBe(1);
    expect(bundle!.level).toBe(2);
  });

  it('is the manifest’s when nothing it vendors is newer', () => {
    const { bundle } = compileBundle(world(), { mode: 'load' });
    expect(bundle!.level).toBe(bundle!.manifest.level);
  });
});

describe('a library’s own file reads as absent when it will not compile', () => {
  // The tier-one pass walks the world's files and every usable library's
  // alike, with no branch between them; this is the library half of the
  // world-file case above, kept because the two are only obviously the
  // same path if you have read the loop.
  const broken: LibrarySource = {
    ...SPROUT,
    files: [file('ward.sprout', 'enum Ward { oak }\n%\n')],
  };
  const withBroken = () =>
    world({
      libraries: [broken],
      manifest: { libraries: [{ name: 'sprout', version: '1.0.0', sha: libraryHash(broken) }] },
    });

  it('refuses it at publish', () => {
    expect(compileBundle(withBroken()).bundle).toBeNull();
  });

  it('reads it as absent at load, and keeps the rest of the world running', () => {
    const { bundle, diagnostics } = compileBundle(withBroken(), { mode: 'load' });
    expect(bundle).not.toBeNull();
    expect(bundle!.absent).toHaveLength(1);
    expect(bundle!.absent[0]).toMatchObject({
      what: 'ward.sprout',
      kind: 'file',
      reason: 'broken',
    });
    expect(refusals(diagnostics)).toEqual([]);
  });
});
