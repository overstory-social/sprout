// `npm run check`, its last part: the corpus worlds' own tests. Every
// `corpus/good/<world>` with a `tests/` folder is run by `sprout test` as
// an author runs it, and must pass; its page is printed where it does not.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const cli = join('cli', 'bin', 'sprout.js');
let failed = 0;
let run = 0;
for (const name of readdirSync('corpus/good').sort()) {
  const world = join('corpus/good', name);
  if (!existsSync(join(world, 'tests'))) continue;
  run++;
  try {
    execFileSync('node', [cli, 'test', world], { encoding: 'utf8' });
    console.log(`✓ ${world}: its tests pass`);
  } catch (err) {
    failed++;
    console.error(`✗ ${world}: its tests did not pass\n${String(err.stdout)}${String(err.stderr)}`);
  }
}
if (failed > 0) {
  console.error(`✗ ${failed} world(s) failed their own tests`);
  process.exit(1);
}
console.log(`✓ tests: all ${run} world(s) pass their own tests`);
