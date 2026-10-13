// The goldens the C parser is held to before it reads a line, written here with
// `SPROUT_WRITE_GOLDENS=1` and otherwise checked whole: the parser's word lists
// (`corpus/goldens/parser-words.json`), and what a visitor arriving in every corpus world may name
// and how each live thing there is addressed (`corpus/goldens/addresses.json`). The dumps are in
// `fixtures/address-dump.ts`.

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { MANIFEST_FILE } from '../../bundle/manifest.js';
import { addressGoldens, addressText, parserWords } from '../../fixtures/address-dump.js';
import { compiledCorpus } from '../../fixtures/corpus.js';

const GOLDENS = fileURLToPath(new URL('../../../../../corpus/goldens', import.meta.url));
const CORPUS = fileURLToPath(new URL('../../../../../corpus/good', import.meta.url));

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

const worlds = readdirSync(CORPUS)
  .sort()
  .map((name) => {
    const root = join(CORPUS, name);
    const bundle = compiledCorpus({
      manifest: readFileSync(join(root, MANIFEST_FILE), 'utf8'),
      files: Object.fromEntries(
        filesUnder(root).map((path) => [
          relative(root, path).split('\\').join('/'),
          readFileSync(path, 'utf8'),
        ]),
      ),
    });
    return [name, bundle] as const;
  });

const words = `${JSON.stringify(parserWords(), null, 1)}\n`;
const addresses = addressText(addressGoldens(worlds));
if (process.env['SPROUT_WRITE_GOLDENS'] === '1') {
  writeFileSync(join(GOLDENS, 'parser-words.json'), words);
  writeFileSync(join(GOLDENS, 'addresses.json'), addresses);
}

describe('the parser goldens', () => {
  // The files are formatted by prettier after they are written, so they are compared as data.
  it('hold the parser’s word lists', () => {
    expect(JSON.parse(words)).toEqual(
      JSON.parse(readFileSync(join(GOLDENS, 'parser-words.json'), 'utf8')),
    );
  });

  it('hold every corpus world’s addresses and what an arriving visitor may name', () => {
    expect(JSON.parse(addresses)).toEqual(
      JSON.parse(readFileSync(join(GOLDENS, 'addresses.json'), 'utf8')),
    );
  });

  it('name the visitor first among what they may name, in every world', () => {
    for (const one of JSON.parse(addresses) as {
      visit: string;
      candidates: unknown[][];
      state: string;
    }[]) {
      const instance = (
        JSON.parse(one.state) as { instances: { id: string; made: { from: string } }[] }
      ).instances.find((i) => i.made.from === 'visitor');
      expect(one.candidates[0]?.[0]).toBe(instance?.id);
    }
  });
});
