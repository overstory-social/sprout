import { describe, expect, it } from 'vitest';

import {
  BENCH,
  compileExample,
  compileSnippet,
  manifestOf,
  manifestText,
  onTheBench,
} from './bench.js';
import { libraryHash, LANGUAGE_LEVEL } from '../bundle.js';
import { STANDARD_LIBRARY } from '../standard-library.js';

describe('the bench the skill’s examples are compiled on', () => {
  it('is a world that compiles with nothing to say, one place and a visitor kind', () => {
    const { bundle, diagnostics } = compileSnippet({});
    expect(diagnostics).toEqual([]);
    expect(bundle!.manifest.name).toBe(BENCH);
    expect(bundle!.arrival).not.toBeNull();
  });

  it('writes a snippet’s lines into its place and its files beside its own', () => {
    const world = onTheBench({
      hall: '    object lamp is Lamp',
      files: { 'lamp.sprout': 'kind Lamp { }\n' },
    });
    expect(Object.keys(world.files)).toEqual([`${BENCH}.sprout`, 'person.sprout', 'lamp.sprout']);
    expect(world.files[`${BENCH}.sprout`]).toContain(
      '  object hall is sprout.Place {\n    object lamp is Lamp\n  }',
    );
    expect(compileExample(world).diagnostics).toEqual([]);
  });

  it('compiles strictly: a snippet with a problem is refused, and says where', () => {
    const { bundle, diagnostics } = compileSnippet({ hall: '    object lamp is Lantern' });
    expect(bundle).toBeNull();
    expect(diagnostics.map((d) => d.at.source.name)).toEqual([`${BENCH}.sprout`]);
  });

  it('pins the standard library by hash, names every file and is written as an author writes it', () => {
    const world = onTheBench({ files: { 'lamp.sprout': 'kind Lamp { }\n' } });
    const manifest = manifestOf(world);
    expect(manifest.files).toEqual(Object.keys(world.files));
    expect(manifest.level).toBe(LANGUAGE_LEVEL);
    expect(manifest.libraries).toEqual([
      { name: 'sprout', version: STANDARD_LIBRARY.version, sha: libraryHash(STANDARD_LIBRARY) },
    ]);
    const written = JSON.parse(manifestText(world)) as Record<string, unknown>;
    expect(written).not.toHaveProperty('namespace');
    expect(written['name']).toBe(BENCH);
  });
});
