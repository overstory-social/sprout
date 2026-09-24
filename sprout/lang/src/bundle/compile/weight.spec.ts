// What a bundle weighs against the host's limits and which level it is
// accepted at (the spec's Limits): blessed library source costs the author
// nothing, a fork costs them everything, and the level is the highest of
// any part's.

import { describe, expect, it } from 'vitest';

import {
  LANGUAGE_LEVEL,
  libraryHash,
  type LibrarySource,
  type Manifest,
  type MicroworldSource,
} from '../bundle.js';
import { limitsFrom, type StaticCaps } from '../limits.js';
import { STANDARD_LIBRARY } from '../standard-library.js';
import { locationOf, SourceFile } from '../../source/source.js';
import { checkLibraries } from './libraries.js';
import { compileBundle, type CompileOptions } from './compile.js';
import { Report } from './report.js';
import { weighBundle } from './weight.js';
import {
  file,
  OWN_BYTES,
  refusals,
  SPROUT_SHA,
  world,
  WORLD_LINE,
  worldFiles,
} from '../../fixtures/compile.js';

const OWN = 'enum Season { spring }\n';

/** Weigh a world of two files, `kiln.sprout` withheld, at the manifest's `level`. */
function weighed(
  options: {
    blessed?: boolean;
    level?: number;
    libraryLevel?: number;
    caps?: Partial<StaticCaps>;
    compilerLevel?: number;
  } = {},
) {
  const library = { ...STANDARD_LIBRARY, level: options.libraryLevel ?? 1 };
  const sha = libraryHash(library);
  const manifest = {
    level: options.level ?? 1,
    libraries: [{ name: 'sprout', version: '0.1.0', sha }],
  } as unknown as Manifest;
  const source: MicroworldSource = {
    manifestFile: new SourceFile(
      'sprout.json',
      '{\n  "name": "w",\n  "level": 1,\n  "libraries": []\n}',
    ),
    manifest,
    files: [
      new SourceFile('world.sprout', OWN),
      new SourceFile('kiln.sprout', 'enum Kiln { cold }'),
    ],
    libraries: [library],
  };
  const report = new Report('publish', source.manifestFile.span(0, 0));
  const usable = checkLibraries(
    source,
    options.blessed === true ? new Set([sha]) : new Set(),
    report,
  );
  const weight = weighBundle(
    source,
    usable,
    new Set(['kiln.sprout']),
    limitsFrom({ caps: options.caps ?? {} }).caps,
    options.compilerLevel ?? 1,
    report,
  );
  return { weight, said: report.diagnostics.all.map((d) => `${locationOf(d.at)} ${d.message}`) };
}

describe('what a bundle weighs', () => {
  it('counts the world’s own files that arrived, and an unblessed library as its own', () => {
    const { weight, said } = weighed();
    expect(said).toEqual([]);
    expect(weight.arrived.map((file) => file.name)).toEqual(['world.sprout']);
    expect(weight.charged.map((one) => one.name)).toEqual(['sprout']);
    expect(weight.files).toBe(1 + STANDARD_LIBRARY.files.length);
    expect(weight.sourceBytes).toBeGreaterThan(OWN.length);
    expect(weight.exemptBytes).toBe(0);
  });

  it('charges nothing for a library the host blessed', () => {
    const { weight } = weighed({ blessed: true });
    expect(weight.charged).toEqual([]);
    expect(weight.files).toBe(1);
    expect(weight.sourceBytes).toBe(OWN.length);
    expect(weight.exemptBytes).toBeGreaterThan(0);
  });

  it('refuses a world past the host’s source or file cap, at the manifest’s name', () => {
    expect(weighed({ caps: { files: 1 } }).said).toEqual([
      `sprout.json:2:3 This world is ${1 + STANDARD_LIBRARY.files.length} files, and 1 is as many as it may have.`,
    ]);
    expect(weighed({ blessed: true, caps: { sourceBytes: 4 } }).said).toEqual([
      `sprout.json:2:3 This world is ${OWN.length} bytes of source, and 4 is as much as it may be.`,
    ]);
  });

  it('is at the level of its newest part, and refused past the compiler’s', () => {
    expect(weighed({ libraryLevel: 2, compilerLevel: 2 }).weight.level).toBe(2);
    expect(weighed({ libraryLevel: 2 }).said).toEqual([
      'sprout.json:4:3 This world needs Sprout level 2, and this one understands level 1.',
    ]);
    expect(weighed({ level: 3 }).said).toEqual([
      'sprout.json:3:3 This world needs Sprout level 3, and this one understands level 1.',
    ]);
  });
});

// The same weighing through a whole compile: what a blessed library costs
// the author, and the level the bundle is accepted at.

describe('blessed library source costs the author nothing, and a fork costs them everything', () => {
  const libraryBytes = STANDARD_LIBRARY.files.reduce((n, f) => n + f.text.length, 0);

  it('leaves a blessed library out of the source the caps count', () => {
    const { bundle } = compileBundle(world(), { blessed: new Set([SPROUT_SHA]) });
    expect(bundle!.size.exemptBytes).toBe(libraryBytes);
    expect(bundle!.size.sourceBytes).toBe(OWN_BYTES);
    expect(bundle!.size.files).toBe(2);
  });

  it('counts an unblessed library as the author’s own source', () => {
    const { bundle } = compileBundle(world(), { blessed: new Set() });
    expect(bundle!.size.exemptBytes).toBe(0);
    expect(bundle!.size.sourceBytes).toBe(OWN_BYTES + libraryBytes);
    expect(bundle!.size.files).toBe(2 + STANDARD_LIBRARY.files.length);
  });

  it('refuses a world past the host’s source cap, and says what to do', () => {
    const limits = limitsFrom({ caps: { sourceBytes: OWN_BYTES } });
    const { bundle, diagnostics } = compileBundle(world(), { limits, blessed: new Set() });
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
    expect(compileBundle(world(), { limits, blessed: new Set() }).bundle).toBeNull();
    expect(
      compileBundle(world(), { limits, blessed: new Set([SPROUT_SHA]) }).bundle,
    ).not.toBeNull();
  });

  it('bounds nothing the host did not bound', () => {
    // One passage, because a megabyte of source would be a megabyte of
    // parse errors and this test is about the cap, not the parser.
    const big = file('big.prose', `passage big { ${'x'.repeat(1_000_000)} }`);
    const files = [big, ...worldFiles(WORLD_LINE)];
    expect(compileBundle(world({ files })).bundle).not.toBeNull();
  });
});

describe('a bundle’s level is the highest of any of its parts', () => {
  const atLevel = (n: number): CompileOptions => ({ compilerLevel: n });
  const at = (level: number): LibrarySource => ({ ...STANDARD_LIBRARY, level });

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

describe('the level a world was accepted at is the bundle’s, not the manifest’s', () => {
  // `softenPolicy` is given the bundle's level, which is the highest of
  // any of its parts. A world whose manifest says 1 and which vendors a
  // level-2 library was accepted at 2, so a refusal introduced at 2
  // applies to it as an error rather than being softened away. Nothing
  // carries a `since` yet, so this pins the number the threshold is
  // taken from rather than the softening itself.
  it('is the highest of any part, even when the manifest asks for less', () => {
    const newer: LibrarySource = { ...STANDARD_LIBRARY, level: 2 };
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
