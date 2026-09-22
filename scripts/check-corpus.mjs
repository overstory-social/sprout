// `npm run check`: `sprout check` over the corpus. Every world under
// corpus/good passes; every world under corpus/bad fails with exactly the
// page its expected.txt holds, so the compiler's words to an author cannot
// drift without a test noticing. `--write` regenerates the expected pages;
// review the diff like any other change.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const write = process.argv.includes('--write');
const cli = join('cli', 'bin', 'sprout.js');
const check = (dir) => {
  try {
    return { code: 0, out: execFileSync('node', [cli, 'check', dir], { encoding: 'utf8' }) };
  } catch (err) {
    return { code: err.status, out: String(err.stdout) + String(err.stderr) };
  }
};
const dirs = (root) => (existsSync(root) ? readdirSync(root).map((d) => join(root, d)) : []);

let failed = 0;
for (const dir of dirs('corpus/good')) {
  const { code, out } = check(dir);
  if (code !== 0) {
    failed++;
    console.error(`✗ ${dir}: expected to pass\n${out}`);
  } else console.log(`✓ ${dir} passes`);
}
for (const dir of dirs('corpus/bad')) {
  const { code, out } = check(dir);
  const expectedFile = join(dir, 'expected.txt');
  if (write) {
    writeFileSync(expectedFile, out);
    console.log(`wrote ${expectedFile}`);
    continue;
  }
  if (code !== 1) {
    failed++;
    console.error(`✗ ${dir}: expected to fail`);
    continue;
  }
  const expected = existsSync(expectedFile) ? readFileSync(expectedFile, 'utf8') : '';
  if (expected !== out) {
    failed++;
    console.error(`✗ ${dir}: the page changed\n--- expected\n${expected}--- actual\n${out}`);
  } else console.log(`✓ ${dir} fails as expected`);
}
if (failed > 0) {
  console.error(`✗ ${failed} world(s) did not do what the corpus says`);
  process.exit(1);
}
console.log('✓ corpus: every good world passes, every bad one fails as expected');
