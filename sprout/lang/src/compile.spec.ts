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

describe('publishing is strict: any problem is a refusal', () => {
  it('is what a compile does when nothing says otherwise', () => {
    expect(compileBundle(world({ libraries: [] })).bundle).toBeNull();
    expect(compileBundle(world({ libraries: [] }), { mode: 'publish' }).bundle).toBeNull();
  });

  it('refuses a world with a file held back, because a world is not published in pieces', () => {
    const source = { ...world(), withheld: ['world.sprout'] };
    const { bundle, diagnostics } = compileBundle(source, { mode: 'publish' });
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

  it('says so, so the gap is visible rather than swallowed', () => {
    const { diagnostics } = compileBundle(world({ libraries: [] }), load);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.severity).toBe('warning');
    expect(diagnostics[0]!.message).toContain('reads as absent');
  });

  it('runs a world with a file withheld, and keeps the objects’ state', () => {
    const source = { ...world(), withheld: ['world.sprout'] };
    const { bundle } = compileBundle(source, load);
    expect(bundle).not.toBeNull();
    expect(bundle!.absent[0]).toMatchObject({ what: 'world.sprout', reason: 'withheld' });
    expect(bundle!.absent[0]!.consequence).toContain('keep their state');
  });

  it('runs a world one of whose files does not compile, and names the file', () => {
    const broken = world({ files: [file('world.sprout', 'world x { }'), file('b.sprout', '%')] });
    const { bundle, diagnostics } = compileBundle(broken, load);
    expect(bundle).not.toBeNull();
    expect(bundle!.absent).toHaveLength(1);
    expect(bundle!.absent[0]).toMatchObject({ what: 'b.sprout', kind: 'file', reason: 'broken' });
    expect(locationOf(bundle!.absent[0]!.at!)).toBe('b.sprout:1:1');
    expect(refusals(diagnostics)).toEqual([]);
  });

  it('keeps what a broken file had to say, as warnings, so a moderator sees why', () => {
    const broken = world({ files: [file('b.sprout', '% ; %')] });
    const { diagnostics } = compileBundle(broken, load);
    expect(diagnostics.filter((d) => d.severity === 'warning')).toHaveLength(3);
    expect(diagnostics.every((d) => d.severity === 'warning')).toBe(true);
  });

  it('leaves the files that do compile alone', () => {
    const mixed = world({
      files: [file('good.sprout', 'object kiln { }'), file('bad.sprout', '%')],
    });
    const { bundle } = compileBundle(mixed, load);
    expect(bundle!.absent.map((a) => a.what)).toEqual(['bad.sprout']);
  });

  it('reads a broken library file as absent too, because they compile together', () => {
    const broken: LibrarySource = { ...SPROUT, files: [file('actor.sprout', 'kind Actor { % }')] };
    const { bundle } = compileBundle(world({ libraries: [broken] }), load);
    expect(bundle).not.toBeNull();
    expect(bundle!.absent[0]).toMatchObject({ what: 'actor.sprout', reason: 'broken' });
  });

  it('warns rather than refuses past a cap, since the world was accepted once', () => {
    const limits = limitsFrom({ caps: { sourceBytes: 40 } });
    const { bundle, diagnostics } = compileBundle(world(), { ...load, limits });
    expect(bundle).not.toBeNull();
    expect(diagnostics.filter((d) => d.severity === 'warning')[0]!.message).toContain(
      'bytes of source',
    );
  });

  it('still refuses text newer than the compiler, because it cannot read it', () => {
    const { bundle } = compileBundle(world({ manifest: { level: 4 } }), {
      ...load,
      compilerLevel: 2,
    });
    expect(bundle).toBeNull();
  });

  it('still refuses what was never allowable, such as a world with no name', () => {
    expect(compileBundle(world({ manifest: { world: 'Shop' } }), load).bundle).toBeNull();
  });

  it('hashes the source that actually arrived, a withheld file not among it', () => {
    const whole = compileBundle(world(), load).bundle!;
    const held = compileBundle({ ...world(), withheld: ['world.sprout'] }, load).bundle!;
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
    const { diagnostics } = compileBundle(
      { ...world(), withheld: ['world.sprout'] },
      {
        mode: 'load',
      },
    );
    expect(diagnostics[0]!.remedy).toContain('Restore it');
  });
});
