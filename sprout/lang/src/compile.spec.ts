import { describe, expect, it } from 'vitest';

import { LANGUAGE_LEVEL, libraryHash, type LibrarySource, type Manifest } from './bundle.js';
import { checkShape, compileBundle, type BundleOptions } from './compile.js';
import { limitsFrom } from './limits.js';
import { locationOf, SourceFile } from './source.js';
import type { Diagnostic } from './diagnostics.js';

const file = (name: string, text: string): SourceFile => new SourceFile(name, text);

const SPROUT: LibrarySource = {
  name: 'sprout',
  level: 1,
  files: [
    file('actor.sprout', 'kind Actor { :capacity 4 }'),
    file('place.sprout', 'kind Place { contains actors }'),
  ],
};

const MANIFEST = [
  '{',
  '  "world": "printers_shop",',
  '  "level": 1,',
  '  "extensions": [{ "name": "media", "major": 2 }],',
  '  "libraries": ["sprout"]',
  '}',
  '',
].join('\n');

/** A world as it arrives, with whatever this suite wants to move about it. */
function world(
  overrides: {
    manifest?: Partial<Manifest>;
    manifestText?: string;
    files?: SourceFile[];
    libraries?: LibrarySource[];
  } = {},
) {
  const manifest: Manifest = {
    world: 'printers_shop',
    level: 1,
    extensions: [{ name: 'media', major: 2 }],
    libraries: ['sprout'],
    ...overrides.manifest,
  };
  return {
    manifestFile: file('sprout.json', overrides.manifestText ?? MANIFEST),
    manifest,
    files: overrides.files ?? [file('world.sprout', 'world printers_shop { contains }')],
    libraries: overrides.libraries ?? [SPROUT],
  };
}

const refusals = (diagnostics: readonly Diagnostic[]): Diagnostic[] =>
  diagnostics.filter((d) => d.severity === 'refusal');

describe('the first tier reads one file alone, for its shape', () => {
  it('gives back the file’s tokens and nothing to say about a clean one', () => {
    const { tokens, diagnostics } = checkShape(file('kiln.sprout', 'object kiln { :door open }'));
    expect(diagnostics).toEqual([]);
    expect(tokens.map((t) => t.text)).toEqual(['object', 'kiln', '{', 'door', 'open', '}', '']);
  });

  it('names the line and column of what it refuses', () => {
    const { diagnostics } = checkShape(file('kiln.sprout', 'object kiln {\n  :door % open\n}'));
    expect(diagnostics).toHaveLength(1);
    expect(locationOf(diagnostics[0]!.at)).toBe('kiln.sprout:2:9');
  });

  it('leaves a .prose file to B29 rather than reading it as code', () => {
    const { tokens, diagnostics } = checkShape(
      file('mirror.prose', 'You see yourself, and % is not a problem here.'),
    );
    expect(diagnostics).toEqual([]);
    expect(tokens).toEqual([]);
  });
});

describe('a bundle is closed: everything it uses travels with it', () => {
  it('compiles a world whose libraries all travelled', () => {
    const { bundle, diagnostics } = compileBundle(world());
    expect(refusals(diagnostics)).toEqual([]);
    expect(bundle).not.toBeNull();
    expect(bundle!.world).toBe('printers_shop');
  });

  it('refuses a world that uses a library whose source did not travel', () => {
    const { bundle, diagnostics } = compileBundle(world({ libraries: [] }));
    expect(bundle).toBeNull();
    expect(refusals(diagnostics)[0]!.message).toContain('"sprout"');
    expect(refusals(diagnostics)[0]!.message).toContain('did not travel');
  });

  it('points a manifest problem at the key in the manifest, not at line 1', () => {
    const { diagnostics } = compileBundle(world({ libraries: [] }));
    expect(locationOf(refusals(diagnostics)[0]!.at)).toBe('sprout.json:5:3');
  });

  it('warns about a library that travelled and is not used', () => {
    const spare: LibrarySource = {
      name: 'ericworld',
      level: 1,
      files: [file('a.sprout', 'kind A')],
    };
    const { bundle, diagnostics } = compileBundle(world({ libraries: [SPROUT, spare] }));
    expect(bundle).not.toBeNull();
    const warnings = diagnostics.filter((d) => d.severity === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toContain('"ericworld"');
  });

  it('refuses two libraries of one name, and two files of one name', () => {
    expect(compileBundle(world({ libraries: [SPROUT, SPROUT] })).bundle).toBeNull();
    expect(
      compileBundle(world({ files: [file('a.sprout', 'x'), file('a.sprout', 'y')] })).bundle,
    ).toBeNull();
  });

  it('lets a library and the world share a file name, since they are different source', () => {
    const { bundle } = compileBundle(world({ files: [file('actor.sprout', 'object a { }')] }));
    expect(bundle).not.toBeNull();
  });
});

describe('the bundle carries every library’s hash, and whether the host blessed it', () => {
  it('hashes each one', () => {
    const { bundle } = compileBundle(world());
    expect(bundle!.libraries[0]!.hash).toBe(libraryHash(SPROUT));
    expect(bundle!.libraries[0]!.blessed).toBe(false);
  });

  it('records the blessing the host granted at publish', () => {
    const blessed = new Set([libraryHash(SPROUT)]);
    const { bundle } = compileBundle(world(), { blessed });
    expect(bundle!.libraries[0]!.blessed).toBe(true);
  });

  it('does not bless a modified copy, whatever it is called', () => {
    const blessed = new Set([libraryHash(SPROUT)]);
    const fork: LibrarySource = {
      ...SPROUT,
      files: [SPROUT.files[0]!, file('place.sprout', 'kind Place { contains }')],
    };
    const { bundle } = compileBundle(world({ libraries: [fork] }), { blessed });
    expect(bundle!.libraries[0]!.blessed).toBe(false);
  });
});

describe('blessed library source costs the author nothing, and a fork costs them everything', () => {
  const libraryBytes = SPROUT.files.reduce((n, f) => n + f.text.length, 0);

  it('leaves a blessed library out of the source the caps count', () => {
    const { bundle } = compileBundle(world(), { blessed: new Set([libraryHash(SPROUT)]) });
    expect(bundle!.size.exemptBytes).toBe(libraryBytes);
    expect(bundle!.size.sourceBytes).toBe('world printers_shop { contains }'.length);
    expect(bundle!.size.files).toBe(1);
  });

  it('counts an unblessed library as the author’s own source', () => {
    const { bundle } = compileBundle(world());
    expect(bundle!.size.exemptBytes).toBe(0);
    expect(bundle!.size.sourceBytes).toBe('world printers_shop { contains }'.length + libraryBytes);
    expect(bundle!.size.files).toBe(3);
  });

  it('refuses a world past the host’s source cap, and says what to do', () => {
    const limits = limitsFrom({ caps: { sourceBytes: 40 } });
    const { bundle, diagnostics } = compileBundle(world(), { limits });
    expect(bundle).toBeNull();
    expect(refusals(diagnostics)[0]!.message).toContain('bytes of source');
    expect(refusals(diagnostics)[0]!.remedy).toContain('blessed');
  });

  it('lets the same world through once its library is blessed', () => {
    const limits = limitsFrom({ caps: { sourceBytes: 40 } });
    const blessed = new Set([libraryHash(SPROUT)]);
    expect(compileBundle(world(), { limits, blessed }).bundle).not.toBeNull();
  });

  it('refuses a world past the host’s file cap', () => {
    const limits = limitsFrom({ caps: { files: 2 } });
    expect(compileBundle(world(), { limits }).bundle).toBeNull();
    expect(
      compileBundle(world(), { limits, blessed: new Set([libraryHash(SPROUT)]) }).bundle,
    ).not.toBeNull();
  });

  it('bounds nothing the host did not bound', () => {
    const big = file('big.sprout', 'x'.repeat(1_000_000));
    expect(compileBundle(world({ files: [big] })).bundle).not.toBeNull();
  });
});

describe('a bundle’s level is the highest of any of its parts', () => {
  const atLevel = (n: number): BundleOptions => ({ compilerLevel: n });

  it('is the world’s own when nothing it uses is newer', () => {
    expect(compileBundle(world()).bundle!.level).toBe(1);
  });

  it('takes a library’s level when the library is newer', () => {
    const newer = { ...SPROUT, level: 2 };
    const { bundle } = compileBundle(world({ libraries: [newer] }), atLevel(2));
    expect(bundle!.level).toBe(2);
  });

  it('refuses text newer than the compiler, and names the part that is newer', () => {
    const newer = { ...SPROUT, level: 3 };
    const { bundle, diagnostics } = compileBundle(world({ libraries: [newer] }), atLevel(2));
    expect(bundle).toBeNull();
    expect(refusals(diagnostics)[0]!.message).toContain('needs Sprout level 3');
    expect(refusals(diagnostics)[0]!.remedy).toContain('"sprout"');
  });

  it('refuses a world written for a newer level than the compiler', () => {
    const { bundle, diagnostics } = compileBundle(world({ manifest: { level: 4 } }), atLevel(2));
    expect(bundle).toBeNull();
    expect(locationOf(refusals(diagnostics)[0]!.at)).toBe('sprout.json:3:3');
  });

  it('understands its own level by default', () => {
    expect(compileBundle(world({ manifest: { level: LANGUAGE_LEVEL } })).bundle).not.toBeNull();
  });

  it('refuses a level that is not a whole number from 1 up', () => {
    expect(compileBundle(world({ manifest: { level: 0 } })).bundle).toBeNull();
    expect(compileBundle(world({ manifest: { level: 1.5 } })).bundle).toBeNull();
  });
});

describe('what a manifest may say', () => {
  it('refuses a world name that is not a name', () => {
    for (const name of ['Printers Shop', '', 'Shop', '2shop', 'shop.two']) {
      expect(compileBundle(world({ manifest: { world: name } })).bundle, name).toBeNull();
    }
  });

  it('refuses a library name that is not a name', () => {
    const odd: LibrarySource = { ...SPROUT, name: 'Sprout' };
    expect(
      compileBundle(world({ manifest: { libraries: ['Sprout'] }, libraries: [odd] })).bundle,
    ).toBeNull();
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

describe('the whole bundle is read, the world’s files and its libraries alike', () => {
  it('refuses a syntax problem in the world’s own source, naming the file', () => {
    const { bundle, diagnostics } = compileBundle(
      world({ files: [file('world.sprout', 'world printers_shop {\n  % \n}')] }),
    );
    expect(bundle).toBeNull();
    expect(locationOf(refusals(diagnostics)[0]!.at)).toBe('world.sprout:2:3');
  });

  it('refuses a syntax problem in a vendored library too, because they compile together', () => {
    const broken: LibrarySource = { ...SPROUT, files: [file('actor.sprout', 'kind Actor { % }')] };
    const { bundle, diagnostics } = compileBundle(world({ libraries: [broken] }));
    expect(bundle).toBeNull();
    expect(locationOf(refusals(diagnostics)[0]!.at)).toBe('actor.sprout:1:14');
  });

  it('gives every problem in reading order, not the first', () => {
    const { diagnostics } = compileBundle(
      world({ files: [file('a.sprout', '% ; %'), file('b.sprout', '%')] }),
    );
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
    const limits = limitsFrom({ caps: { nesting: 12, places: 40 } });
    expect(compileBundle(world(), { limits }).bundle!.caps).toEqual(limits.caps);
  });

  it('carries a hash, which is what the log records beside a publish', () => {
    expect(bundle!.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(compileBundle(world()).bundle!.hash).toBe(bundle!.hash);
  });

  it('hashes differently once anything about the world changes', () => {
    const changed = world({ files: [file('world.sprout', 'world printers_shop { }')] });
    expect(compileBundle(changed).bundle!.hash).not.toBe(bundle!.hash);
  });

  it('carries no definitions and no word set yet, because nothing parses yet', () => {
    // B05–B19 fill the definitions; B27 fills the word set.
    expect(bundle!.definitions).toEqual([]);
    expect(bundle!.words).toEqual([]);
  });
});
