// `npm run check`: `sprout check --json` over the examples and the corpus.
// Everything under corpus/good and sprout/examples passes; everything under
// corpus/bad fails with exactly the problems its expect.json names. The
// expect files are written by `node scripts/check-corpus.mjs --write` and
// reviewed like any other change: the compiler's words to a builder are
// part of the contract.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const write = process.argv.includes('--write');
const cli = join('cli', 'bin', 'sprout.js');
const check = (dir) => {
  try {
    return {
      code: 0,
      json: JSON.parse(execFileSync('node', [cli, 'check', dir, '--json'], { encoding: 'utf8' })),
    };
  } catch (err) {
    return { code: err.status, json: JSON.parse(String(err.stdout)) };
  }
};
const dirs = (root) => readdirSync(root).map((d) => join(root, d));

let failed = 0;
// Every example world is a directory holding a sprout.json; one fenced under
// sprout/examples/legacy/ (CLAUDE.md, The legacy fence) is not an example.
const EXAMPLES = readdirSync(join('sprout', 'examples'))
  .map((d) => join('sprout', 'examples', d))
  .filter((d) => existsSync(join(d, 'sprout.json')));
for (const dir of [...EXAMPLES, ...dirs('corpus/good')]) {
  const { code, json } = check(dir);
  if (code !== 0 || !json.ok) {
    failed++;
    console.error(`✗ ${dir}: expected to pass\n${JSON.stringify(json.problems, null, 2)}`);
  } else console.log(`✓ ${dir} passes`);
}
for (const dir of dirs('corpus/bad')) {
  const { code, json } = check(dir);
  const expectFile = join(dir, 'expect.json');
  if (write) {
    writeFileSync(expectFile, `${JSON.stringify(json.problems, null, 2)}\n`);
    console.log(`wrote ${expectFile}`);
    continue;
  }
  if (code !== 1 || json.ok) {
    failed++;
    console.error(`✗ ${dir}: expected to fail`);
    continue;
  }
  const expected = existsSync(expectFile) ? readFileSync(expectFile, 'utf8') : '';
  const actual = `${JSON.stringify(json.problems, null, 2)}\n`;
  if (expected !== actual) {
    failed++;
    console.error(`✗ ${dir}: the problems changed\n--- expected\n${expected}--- actual\n${actual}`);
  } else console.log(`✓ ${dir} fails as expected (${json.problems.length})`);
}
if (failed > 0) {
  console.error(`✗ ${failed} archive(s) did not do what the corpus says`);
  process.exit(1);
}
console.log('✓ corpus: every good archive passes, every bad one fails as expected');
