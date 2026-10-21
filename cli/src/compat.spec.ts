import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { emitCartridge } from '@overstory/sprout/lang';

import { checkWorld } from './check.js';
import { cartridgeBuild, compareBuilds, readBuild, type Build } from './compat.js';

const COMPAT = join(fileURLToPath(import.meta.url), '../../../corpus/compat');

/** A build of a corpus/compat pair, read from its folder; the page said on the way. */
function build(pair: string, which: 'old' | 'new'): Build {
  let said = '';
  const read = readBuild(join(COMPAT, pair, which), (text) => (said += text));
  if (read === null) throw new Error(said);
  return read;
}

/** `build` with its version said otherwise. */
const at = (one: Build, version: string): Build => ({ ...one, version });

describe('compareBuilds', () => {
  it('lets a compatible version stand where nothing breaks a save, and says so', () => {
    const compared = compareBuilds(
      build('accepted/added-room', 'old'),
      build('accepted/added-room', 'new'),
    );
    expect(compared).toEqual({
      ok: true,
      page: 'lamplight 0.1.0 → 0.1.1: nothing breaks a save of 0.1.0, so it opens in 0.1.1.\n',
    });
  });

  it('refuses a compatible version over a change that breaks a save, naming it and the breaking version', () => {
    const compared = compareBuilds(
      build('refused/renamed-room', 'old'),
      build('refused/renamed-room', 'new'),
    );
    expect(compared.ok).toBe(false);
    expect(compared.page).toContain(
      'lamplight.sprout:16:3 in 0.1.0: `cellar` is not declared there any more',
    );
    expect(compared.page).toContain(
      'refused: put it right, or make this a breaking version, 0.2.0.\n',
    );
  });

  it('lets a breaking version stand over the same change, listing it without a remedy', () => {
    const old = build('refused/renamed-room', 'old');
    const next = at(build('refused/renamed-room', 'new'), '0.2.0');
    const compared = compareBuilds(old, next);
    expect(compared.ok).toBe(true);
    expect(compared.page).toContain('0.2.0 is a breaking version');
    expect(compared.page).not.toContain('Declare it again');
  });

  it('holds an unchanged version to what a compatible one is held to', () => {
    const old = build('refused/property-type', 'old');
    const compared = compareBuilds(old, at(build('refused/property-type', 'new'), '0.1.0'));
    expect(compared.ok).toBe(false);
    expect(compared.page).toContain('`:oil` of `Lamp`');
  });

  it('refuses a version earlier than the old, and one that is not a version', () => {
    const old = build('accepted/added-room', 'old');
    expect(compareBuilds(old, at(old, '0.0.9'))).toEqual({
      ok: false,
      page: "lamplight 0.1.0 → 0.0.9: 0.0.9 is earlier than 0.1.0. Give the new build a version after the old one's.\n",
    });
    expect(compareBuilds(old, at(old, 'one')).ok).toBe(false);
  });

  it('says a breaking version that breaks nothing is one', () => {
    const old = build('accepted/added-room', 'old');
    expect(compareBuilds(old, at(old, '1.0.0'))).toEqual({
      ok: true,
      page: 'lamplight 0.1.0 → 1.0.0: 1.0.0 is a breaking version, so a save of 0.1.0 starts again, though nothing here breaks it.\n',
    });
  });
});

describe('readBuild', () => {
  it('reads a cartridge as its folder reads, and says what is wrong with one that is not', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sprout-compat-'));
    const file = join(dir, 'old.sproutworld');
    writeFileSync(
      file,
      emitCartridge(checkWorld(join(COMPAT, 'refused/property-type/old')).bundle!),
    );
    const fromCartridge = cartridgeBuild(readFileSync(file));
    expect([fromCartridge.name, fromCartridge.version]).toEqual(['lamplight', '0.1.0']);
    const compared = compareBuilds(fromCartridge, build('refused/property-type', 'new'));
    expect(compared.page).toContain('lamp.sprout:9:3: `:oil` of `Lamp`');

    const broken = join(dir, 'broken.sproutworld');
    writeFileSync(broken, 'not a cartridge');
    let said = '';
    expect(readBuild(broken, (text) => (said += text))).toBeNull();
    expect(said).toMatch(/^.*broken\.sproutworld: /);
  });

  it('says the check page of a folder that does not compile', () => {
    let said = '';
    expect(readBuild(join(COMPAT, '../bad/act-as-value'), (text) => (said += text))).toBeNull();
    expect(said).toContain('refused: 1 problem');
  });
});
