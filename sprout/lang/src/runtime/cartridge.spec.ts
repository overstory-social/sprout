import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { emitCartridge, readCartridge } from '../bundle/cartridge.js';
import { type Bundle } from '../bundle/bundle.js';
import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { MANIFEST_FILE } from '../bundle/manifest.js';
import { typedWords } from '../declare/addressing.js';
import { kindName } from '../declare/kinds.js';
import { compiledWorld } from '../fixtures/bundle.js';
import { compiledCorpus } from '../fixtures/corpus.js';
import { dumpCatalogue } from '../fixtures/catalogue-dump.js';
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
  return compiledCorpus({
    manifest: readFileSync(join(root, MANIFEST_FILE), 'utf8'),
    files: Object.fromEntries(
      filesUnder(root).map((path) => [
        relative(root, path).split('\\').join('/'),
        readFileSync(path, 'utf8'),
      ]),
    ),
  });
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

describe('the catalogue of every corpus world, as the C runtime reads it from the cartridge', () => {
  const file = join(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../corpus/goldens/catalogues.json',
  );

  /** One line per world, so a change to one world is one changed line. */
  const dumps = (): string => {
    const lines = WORLDS.map((name) => {
      const bundle = compiled(name);
      const bytes = emitCartridge(bundle);
      const recorded = readCartridge(bytes).caps;
      const made = dumpCatalogue(catalogueOf(bundle, DEFAULT_LIMITS.caps), recorded);
      const loaded = dumpCatalogue(loadCartridge(bytes, { caps: DEFAULT_LIMITS.caps }), recorded);
      // A cartridge writes each verb's synonyms out as the phrases they give, after its own.
      expect({ ...loaded, verbs: [] }, name).toEqual({ ...made, verbs: [] });
      expect(
        loaded.verbs.map((verb) => ({ ...verb, phrases: [] })),
        name,
      ).toEqual(made.verbs.map((verb) => ({ ...verb, phrases: [] })));
      loaded.verbs.forEach((verb, i) =>
        expect(verb.phrases.slice(0, made.verbs[i]!.phrases.length), name).toEqual(
          made.verbs[i]!.phrases,
        ),
      );
      return `${JSON.stringify(name)}:${JSON.stringify({ level: bundle.level, ...loaded })}`;
    });
    return `{\n${lines.join(',\n')}\n}\n`;
  };

  it('is the golden: regenerate with SPROUT_WRITE_GOLDENS=1 and read the diff', () => {
    const text = dumps();
    if (process.env['SPROUT_WRITE_GOLDENS'] === '1') writeFileSync(file, text);
    expect(text).toBe(readFileSync(file, 'utf8'));
  }, 60_000);

  it('carries the words of every phrase final, as the tokeniser reads a typed line', () => {
    // A reader in another language compares bytes: lower case in every script, split on every
    // Unicode space, each comma a word of its own, single spaces between.
    const names = [...WORLDS, 'unicode'];
    for (const name of names) {
      const bundle =
        name === 'unicode'
          ? compiledWorld('unicode', {
              'unicode.sprout': `world unicode is sprout.World {
  visitors are Person
  visitors arrive at room
  object room is sprout.Place { grammar { link back "To the Café\u00a0DE LA Gare" } }
}
verb peer { role target  "Peer\u00a0AT [target],  ÉMILE   now" }
`,
              'person.sprout': 'kind Person is sprout.Visitor { }\n',
            })
          : compiled(name);
      const catalogue = loadCartridge(emitCartridge(bundle), { caps: DEFAULT_LIMITS.caps });
      const written = [
        ...catalogue.verbs.all().flatMap((verb) => verb.phrases),
        ...catalogue.intentPhrases.flatMap(({ intent }) => intent.phrases),
      ].flatMap((phrase) => phrase.parts.flatMap((part) => (part.part === 'words' ? [part.text] : [])));
      expect(
        written.filter((text) => text !== typedWords(text).join(' ')),
        name,
      ).toEqual([]);
      if (name === 'unicode') expect(written).toContain('peer at');
      if (name === 'unicode') expect(written).toContain(', émile now');
    }
  }, 60_000);
});
