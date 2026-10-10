// `npm run check`, its second half: the golden transcripts. Every
// `corpus/good/<world>/transcripts/*.json` is a script `sprout play` plays
// through real turns, each step expecting all it made, and is also what
// playing it prints, so a transcript that plays back other than as written
// is a changed behaviour. Each is played twice, from the world's folder and
// from the cartridge `sprout pack` makes of it, and the two must print the
// same: a cartridge is complete when it plays what the source plays.
// `--write` replays each from the folder and writes what it printed; review
// the diff like any other change.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const write = process.argv.includes('--write');
const cli = join('cli', 'bin', 'sprout.js');
const play = (world, script) => {
  try {
    return {
      code: 0,
      out: execFileSync('node', [cli, 'play', world, script], { encoding: 'utf8' }),
    };
  } catch (err) {
    return { code: err.status, out: String(err.stdout) + String(err.stderr) };
  }
};

const scratch = mkdtempSync(join(tmpdir(), 'sprout-cartridges-'));
let failed = 0;
let played = 0;
for (const name of readdirSync('corpus/good').sort()) {
  const world = join('corpus/good', name);
  const folder = join(world, 'transcripts');
  if (!existsSync(folder)) continue;
  const cartridge = join(scratch, `${name}.sproutworld`);
  if (!write) {
    try {
      execFileSync('node', [cli, 'pack', world, '-o', cartridge], { encoding: 'utf8' });
    } catch (err) {
      failed++;
      console.error(`✗ ${world}: did not pack\n${String(err.stdout)}${String(err.stderr)}`);
      continue;
    }
  }
  for (const file of readdirSync(folder)
    .filter((f) => f.endsWith('.json'))
    .sort()) {
    const script = join(folder, file);
    const { code, out } = play(world, script);
    played++;
    if (code !== 0) {
      failed++;
      console.error(`✗ ${script}: did not play\n${out}`);
      continue;
    }
    if (write) {
      writeFileSync(script, out);
      console.log(`wrote ${script}`);
      continue;
    }
    const expected = readFileSync(script, 'utf8');
    if (expected !== out) {
      failed++;
      console.error(
        `✗ ${script}: the transcript changed\n--- expected\n${expected}--- actual\n${out}`,
      );
      continue;
    }
    const packed = play(cartridge, script);
    if (packed.code !== 0 || packed.out !== out) {
      failed++;
      console.error(
        `✗ ${script}: the cartridge plays it differently\n--- from the folder\n${out}--- from the cartridge\n${packed.out}`,
      );
      continue;
    }
    console.log(`✓ ${script} plays as written, from the folder and from its cartridge`);
  }
}
rmSync(scratch, { recursive: true, force: true });
if (failed > 0) {
  console.error(`✗ ${failed} transcript(s) did not play as written`);
  process.exit(1);
}
console.log(`✓ transcripts: all ${played} play as written`);
