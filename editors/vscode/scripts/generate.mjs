// `npm run generate -w editors/vscode`: writes both grammars from
// src/sprout.ts and src/prose.ts into syntaxes/, formatted as the
// repository formats JSON. The grammars' spec fails while what is written
// there differs from what those modules build; read the diff before
// committing it.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { proseGrammar } from '../src/prose.ts';
import { sproutGrammar } from '../src/sprout.ts';

const syntaxes = join(dirname(fileURLToPath(import.meta.url)), '..', 'syntaxes');
for (const [file, grammar] of [
  ['sprout.tmLanguage.json', sproutGrammar()],
  ['sprout-prose.tmLanguage.json', proseGrammar()],
]) {
  const path = join(syntaxes, file);
  const options = (await resolveConfig(path)) ?? {};
  writeFileSync(path, await format(JSON.stringify(grammar), { ...options, filepath: path }));
  console.log(`wrote ${path}`);
}
