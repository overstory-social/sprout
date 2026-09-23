import { describe, expect, it } from 'vitest';

import { libraryHash, type Manifest, type MicroworldSource } from '../bundle.js';
import { limitsFrom, type StaticCaps } from '../limits.js';
import { STANDARD_LIBRARY } from '../standard-library.js';
import { locationOf, SourceFile } from '../../source/source.js';
import { checkLibraries } from './libraries.js';
import { Report } from './report.js';
import { weighBundle } from './weight.js';

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
