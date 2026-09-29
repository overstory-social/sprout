import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { STANDARD_LIBRARY } from '@overstory/sprout/lang';
import { describe, expect, it } from 'vitest';

import { copiedWorld, corpusWorld } from './fixtures/worlds.js';
import { checkWorld, rangeOf, worldFolderOf } from './world.js';

const IMPORTS = corpusWorld('imports');
const CHEST = join(IMPORTS, 'things', 'chest.sprout');

describe('worldFolderOf', () => {
  it('finds the nearest folder holding a manifest at or above a file', () => {
    expect(worldFolderOf(CHEST)).toBe(IMPORTS);
    expect(worldFolderOf(join(IMPORTS, 'imports.sprout'))).toBe(IMPORTS);
  });

  it('finds none for a file in no world', () => {
    expect(worldFolderOf(join(mkdtempSync(join(tmpdir(), 'sprout-ls-')), 'loose.sprout'))).toBe(
      null,
    );
  });
});

describe('checkWorld', () => {
  it('checks a world that compiles to nothing to say, and indexes its declarations', () => {
    const checked = checkWorld(IMPORTS, new Map());
    expect(checked.diagnostics).toEqual([]);
    expect(checked.index.declared.some((one) => one.name === 'Chest')).toBe(true);
  });

  it('checks the unsaved text in place of the file, and puts each refusal on its file, 0-based, with its remedy', () => {
    const text = readFileSync(CHEST, 'utf8').replace('is Container', 'is Contaner');
    const [refusal, ...rest] = checkWorld(IMPORTS, new Map([[CHEST, text]])).diagnostics;
    expect(rest).toEqual([]);
    // `kind Chest is Contaner {` is the file's third line; the name starts at its fifteenth column.
    expect(refusal).toEqual({
      path: CHEST,
      start: { line: 2, character: 14 },
      end: { line: 2, character: 22 },
      severity: 'refusal',
      message:
        'Nothing here is a `Contaner`. Did you mean `Container`?\nWrite `Container`, or declare `Contaner` with `kind Contaner { … }`.',
    });
  });

  it('checks a folder whose manifest is gone as nothing, rather than throwing', () => {
    const root = copiedWorld('imports');
    rmSync(join(root, 'sprout.json'));
    expect(checkWorld(root, new Map())).toEqual({
      root,
      diagnostics: [],
      index: { declared: [], imports: [] },
    });
  });

  it('puts a manifest that does not read on the manifest, with nothing indexed', () => {
    const checked = checkWorld(IMPORTS, new Map([[join(IMPORTS, 'sprout.json'), '{ not json']]));
    expect(checked.diagnostics.map((one) => one.path)).toEqual([join(IMPORTS, 'sprout.json')]);
    expect(checked.index.declared).toEqual([]);
  });
});

describe('rangeOf', () => {
  it('counts lines and characters from 0, in code units, as the protocol does', () => {
    const file = STANDARD_LIBRARY.files[0]!;
    const offset = file.text.indexOf('\n') + 3;
    expect(rangeOf(file.span(offset, offset + 2))).toEqual({
      start: { line: 1, character: 2 },
      end: { line: 1, character: 4 },
    });
  });
});
