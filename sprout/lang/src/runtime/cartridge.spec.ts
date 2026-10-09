import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DEFAULT_BLESSED } from '../bundle/blessed.js';
import { emitCartridge, readCartridge } from '../bundle/cartridge.js';
import { compileBundle } from '../bundle/compile/compile.js';
import { type Bundle } from '../bundle/bundle.js';
import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { MANIFEST_FILE, parseManifest } from '../bundle/manifest.js';
import { STANDARD_LIBRARY } from '../bundle/standard-library.js';
import { Diagnostics } from '../source/diagnostics.js';
import { SourceFile } from '../source/source.js';
import { kindName } from '../declare/kinds.js';
import { catalogueOf } from './catalogue.js';
import { loadCartridge } from './cartridge.js';

const CORPUS = join(dirname(fileURLToPath(import.meta.url)), '../../../../corpus/good');

function filesUnder(root: string, dir = root): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    if (entry.startsWith('.')) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...filesUnder(root, path));
    else if (entry.endsWith('.sprout') || entry.endsWith('.prose')) out.push(path);
  }
  return out;
}

/** A corpus world, compiled as publishing compiles it. */
function compiled(name: string): Bundle {
  const root = join(CORPUS, name);
  const diagnostics = new Diagnostics();
  const manifestFile = new SourceFile(
    MANIFEST_FILE,
    readFileSync(join(root, MANIFEST_FILE), 'utf8'),
  );
  const manifest = parseManifest(manifestFile, diagnostics)!;
  const files = filesUnder(root).map(
    (path) =>
      new SourceFile(relative(root, path).split('\\').join('/'), readFileSync(path, 'utf8')),
  );
  const usesStandard = manifest.libraries.some((pin) => pin.name === STANDARD_LIBRARY.name);
  const { bundle } = compileBundle(
    { manifestFile, manifest, files, libraries: usesStandard ? [STANDARD_LIBRARY] : [] },
    { mode: 'publish', blessed: DEFAULT_BLESSED },
  );
  return bundle!;
}

const WORLDS = readdirSync(CORPUS).sort();

describe('a cartridge runs under the host’s caps, not the ones it recorded', () => {
  it('reads the caps the host gives, while the cartridge keeps what it was checked against', () => {
    const bundle = compiled('act');
    const bytes = emitCartridge(bundle);
    const host = { ...DEFAULT_LIMITS.caps, listElements: DEFAULT_LIMITS.caps.listElements - 1 };
    expect(loadCartridge(bytes, { caps: host }).caps).toEqual(host);
    expect(readCartridge(bytes).caps).toEqual(bundle.caps);
  });
});

describe('a cartridge loads to the catalogue compiling the source makes', () => {
  it('has worlds to load', () => expect(WORLDS.length).toBeGreaterThan(40));

  for (const name of WORLDS) {
    it(name, () => {
      const bundle = compiled(name);
      const made = catalogueOf(bundle, DEFAULT_LIMITS.caps);
      const loaded = loadCartridge(emitCartridge(bundle), { caps: DEFAULT_LIMITS.caps });
      expect(loaded.world).toBe(made.world);
      expect([...loaded.declared.keys()]).toEqual([...made.declared.keys()]);
      expect([...loaded.declared.values()].map((one) => [one.container, one.rank])).toEqual(
        [...made.declared.values()].map((one) => [one.container, one.rank]),
      );
      expect(loaded.arrival).toBe(made.arrival);
      expect([...loaded.kinds.keys()]).toEqual([...made.kinds.keys()]);
      expect(loaded.lookup.all().map(kindName)).toEqual(made.lookup.all().map(kindName));
      expect(loaded.verbs.all().map((v) => `${v.library}.${v.name}`)).toEqual(
        made.verbs.all().map((v) => `${v.library}.${v.name}`),
      );
      expect(loaded.messages.all().map((m) => `${m.library}.${m.name}`)).toEqual(
        made.messages.all().map((m) => `${m.library}.${m.name}`),
      );
      expect(loaded.phrases.map((p) => [p.verb.name, p.parts, p.only])).toEqual(
        made.phrases.map((p) => [p.verb.name, p.parts, p.only]),
      );
      expect(loaded.intentPhrases.map((p) => [p.intent.name, p.parts])).toEqual(
        made.intentPhrases.map((p) => [p.intent.name, p.parts]),
      );
      expect([...loaded.words]).toEqual([...made.words]);
      expect(loaded.caps).toEqual(made.caps);
      expect(loaded.names.size).toBe(made.names.size);
      expect(loaded.optionSlots.size).toBe(made.optionSlots.size);
    });
  }
});
