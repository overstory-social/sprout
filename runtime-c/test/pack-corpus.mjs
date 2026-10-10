// Packs every `corpus/good` world into a cartridge under the folder named on
// the command line, for the C tests that load them. The CLI is the built one,
// run in this process; a world that does not pack fails the setup with the
// words `sprout pack` printed.
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '../../..');
const out = process.argv[2];
if (out === undefined) {
  console.error('usage: node pack-corpus.mjs <folder>');
  process.exit(2);
}

const { main } = await import(pathToFileURL(join(root, 'cli/dist/cli.js')).href);
mkdirSync(out, { recursive: true });

let said = '';
const quiet = { write: (text) => ((said += text), true) };
let packed = 0;
for (const name of readdirSync(join(root, 'corpus/good')).sort()) {
  said = '';
  const code = await main(['pack', join(root, 'corpus/good', name), '-o', join(out, `${name}.sproutworld`)], {
    stdout: quiet,
    stderr: quiet,
    stdin: process.stdin,
  });
  if (code !== 0) {
    console.error(`${name} did not pack:\n${said}`);
    process.exit(1);
  }
  packed++;
}
console.log(`packed ${packed} worlds into ${out}`);
