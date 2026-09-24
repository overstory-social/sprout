// `npm run check`: `sprout check` over the corpus. Every world under
// corpus/good passes; every world under corpus/bad fails with exactly the
// page its expected.txt holds, so the compiler's words to an author cannot
// drift without a test noticing. `sprout skill` prints exactly
// corpus/skill/SKILL.md, so a change to any table the skill is generated
// from shows as a diff of it. `--write` regenerates the expected pages and
// the skill; review the diff like any other change.
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
  const expectedFile = join(dir, 'expected.txt');
  const hasExpected = existsSync(expectedFile);
  if (code !== 0) {
    failed++;
    console.error(`✗ ${dir}: expected to pass\n${out}`);
    continue;
  }
  if (write && hasExpected) {
    writeFileSync(expectedFile, out);
    console.log(`wrote ${expectedFile}`);
    continue;
  }
  if (hasExpected) {
    const expected = readFileSync(expectedFile, 'utf8');
    if (expected !== out) {
      failed++;
      console.error(`✗ ${dir}: the page changed\n--- expected\n${expected}--- actual\n${out}`);
      continue;
    }
  }
  console.log(`✓ ${dir} passes`);
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
const skillFile = join('corpus', 'skill', 'SKILL.md');
const skill = execFileSync('node', [cli, 'skill'], { encoding: 'utf8' });
if (write) {
  writeFileSync(skillFile, skill);
  console.log(`wrote ${skillFile}`);
} else if (!existsSync(skillFile) || readFileSync(skillFile, 'utf8') !== skill) {
  failed++;
  console.error(`✗ ${skillFile}: \`sprout skill\` prints something else; run with --write and read the diff`);
} else console.log(`✓ ${skillFile} is what \`sprout skill\` prints`);
if (failed > 0) {
  console.error(`✗ ${failed} world(s) did not do what the corpus says`);
  process.exit(1);
}
console.log('✓ corpus: every good world passes, every bad one fails as expected, and the skill is current');
