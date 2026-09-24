import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  checkShape,
  compileBundle,
  libraryHash,
  SourceFile,
  STANDARD_LIBRARY,
} from '@overstory/sprout/lang';
import { describe, expect, it } from 'vitest';

import { initWorld } from './init.js';
import { runTests, testFiles } from './test.js';
import { readWorld } from './world.js';

describe('initWorld', () => {
  it('writes a manifest, a world, its visitors’ kind, a first test and a README, named for the folder', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'sprout-init-')), 'Paper Store');
    expect(initWorld(dir, 'marta')).toEqual([
      'sprout.json',
      'paper_store.sprout',
      'person.sprout',
      'tests/arrival.txt',
      'README.md',
    ]);
    const manifest = JSON.parse(readFileSync(join(dir, 'sprout.json'), 'utf8'));
    expect(manifest).toEqual({
      name: 'paper_store',
      version: '0.1.0',
      author: 'marta',
      license: 'MIT',
      level: 1,
      extensions: [],
      libraries: [{ name: 'sprout', version: '0.1.0', sha: libraryHash(STANDARD_LIBRARY) }],
      files: ['paper_store.sprout', 'person.sprout'],
    });
    expect(readFileSync(join(dir, 'paper_store.sprout'), 'utf8')).toContain(
      'world paper_store is sprout.World {',
    );
  });

  it('writes a world that composes `sprout.World`, as every world does', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'sprout-init-')), 'Kiln Yard');
    initWorld(dir, 'marta');
    const written = readFileSync(join(dir, 'kiln_yard.sprout'), 'utf8');
    expect(written).toContain('world kiln_yard is sprout.World {');
    // What a beginner is handed is what the compiler takes.
    expect(checkShape(new SourceFile('kiln_yard.sprout', written)).diagnostics).toEqual([]);
  });

  it('writes the place visitors arrive at, written in the world’s body, holding actors', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'sprout-init-')), 'Kiln Yard');
    initWorld(dir, 'marta');
    const written = readFileSync(join(dir, 'kiln_yard.sprout'), 'utf8');
    expect(written).toContain('  visitors arrive at hall\n');
    expect(written).toMatch(
      /world kiln_yard is sprout.World \{[^}]*\n {2}object hall is sprout.Place\n\}/,
    );
    const source = readWorld(dir).source!;
    const { bundle, diagnostics } = compileBundle(source);
    expect(diagnostics.filter((d) => d.severity === 'refusal')).toEqual([]);
    expect(bundle!.arrival).toEqual(['hall']);
    expect(bundle!.size.places).toBe(1);
  });

  it('writes the kind visitors are made of: the world’s own, composing `sprout.Visitor`, in the file named for it', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'sprout-init-')), 'Kiln Yard');
    initWorld(dir, 'marta');
    expect(readFileSync(join(dir, 'kiln_yard.sprout'), 'utf8')).toContain(
      '  visitors are Person\n',
    );
    const person = readFileSync(join(dir, 'person.sprout'), 'utf8');
    expect(person).toBe('kind Person is sprout.Visitor { }\n');
    expect(checkShape(new SourceFile('person.sprout', person)).diagnostics).toEqual([]);
    const { bundle, diagnostics } = compileBundle(readWorld(dir).source!);
    // Not even a warning: a `Visitor` of the world's own would hide `sprout.Visitor`.
    expect(diagnostics).toEqual([]);
    expect(bundle!.visitor!.library).toBe('kiln_yard');
    expect(bundle!.visitor!.name).toBe('Person');
    expect(bundle!.visitor!.composes.has('sprout.Visitor')).toBe(true);
    expect(bundle!.visitor!.composes.has('sprout.Actor')).toBe(true);
    expect(bundle!.world!.composes.has('sprout.World')).toBe(true);
  });

  it('makes the visitors of a world called `person` of `Guest`, since the world holds `person.sprout`', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'sprout-init-')), 'person');
    expect(initWorld(dir, 'marta')).toEqual([
      'sprout.json',
      'person.sprout',
      'guest.sprout',
      'tests/arrival.txt',
      'README.md',
    ]);
    expect(readFileSync(join(dir, 'person.sprout'), 'utf8')).toContain('  visitors are Guest\n');
    expect(readFileSync(join(dir, 'guest.sprout'), 'utf8')).toBe(
      'kind Guest is sprout.Visitor { }\n',
    );
    expect(compileBundle(readWorld(dir).source!).diagnostics).toEqual([]);
  });

  it('writes a first test the world it wrote passes', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'sprout-init-')), 'shed');
    initWorld(dir, 'marta');
    const bundle = compileBundle(readWorld(dir).source!).bundle!;
    expect(runTests(bundle, testFiles(dir, []))).toEqual({
      ok: true,
      page: 'arrival.txt: passed, 1 expected line said\n\n1 test: passed\n',
    });
  });

  it('refuses a folder that already has something in it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sprout-init-'));
    writeFileSync(join(dir, 'notes.txt'), 'x');
    expect(() => initWorld(dir, 'marta')).toThrow('not empty');
  });
});
