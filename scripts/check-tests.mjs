// `npm run check`, its last part: the corpus worlds' own tests. Every
// `corpus/good/<world>` with a `tests/` folder is run by `sprout test` as
// an author runs it, and must pass; its page is printed where it does not.
// The same tests are then run against the world's cartridge, and must print
// the same page.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cli = join('cli', 'bin', 'sprout.js');
const scratch = mkdtempSync(join(tmpdir(), 'sprout-cartridges-'));
let failed = 0;
let run = 0;
for (const name of readdirSync('corpus/good').sort()) {
  const world = join('corpus/good', name);
  if (!existsSync(join(world, 'tests'))) continue;
  run++;
  try {
    const page = execFileSync('node', [cli, 'test', world], { encoding: 'utf8' });
    const cartridge = join(scratch, `${name}.sproutworld`);
    execFileSync('node', [cli, 'pack', world, '-o', cartridge], { encoding: 'utf8' });
    const scripts = readdirSync(join(world, 'tests'))
      .filter((file) => file.endsWith('.json'))
      .sort()
      .map((file) => join(world, 'tests', file));
    const packed = execFileSync('node', [cli, 'test', cartridge, ...scripts], { encoding: 'utf8' });
    if (packed !== page) {
      throw Object.assign(new Error('the cartridge ran its tests differently'), {
        stdout: `--- from the folder\n${page}--- from the cartridge\n${packed}`,
        stderr: '',
      });
    }
    console.log(`✓ ${world}: its tests pass, from the folder and from its cartridge`);
  } catch (err) {
    failed++;
    console.error(`✗ ${world}: its tests did not pass\n${String(err.stdout)}${String(err.stderr)}`);
  }
}
rmSync(scratch, { recursive: true, force: true });
if (failed > 0) {
  console.error(`✗ ${failed} world(s) failed their own tests`);
  process.exit(1);
}
console.log(`✓ tests: all ${run} world(s) pass their own tests`);
